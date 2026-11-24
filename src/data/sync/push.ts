import * as Crypto from 'expo-crypto';
import { LocalDbAdapter, notifyTablesChanged } from '../db/database';
import { OutboxRow, SyncTableName } from '../db/types';
import { getEntityConfig } from './registry';
import { getSyncTransport, PushMutationPayload } from '../api/syncRpc';
import { upsertServerRow } from './sqliteSerializer';

export interface PushBatchSummary {
  pushed: number;
  accepted: number;
  merged: number;
  serverWins: number;
  quarantined: number;
  serverTime: string | null;
}

/**
 * Pushes all pending local outbox mutations in ONE batch ordered by entity dependency
 * (e.g. tiers/profiles before contributions/member_tiers).
 * Rejected items (e.g. YEAR_CLOSED) move into sync_quarantine and NEVER block other writes.
 */
export async function pushPendingOutbox(db: LocalDbAdapter): Promise<PushBatchSummary> {
  const rows = await db.getAll<OutboxRow>(
    `SELECT * FROM sync_outbox ORDER BY created_at ASC`,
  );

  if (rows.length === 0) {
    return {
      pushed: 0,
      accepted: 0,
      merged: 0,
      serverWins: 0,
      quarantined: 0,
      serverTime: null,
    };
  }

  // Sort deterministically by registry dependency pushOrder, then created_at
  const ordered = [...rows].sort((a, b) => {
    const orderA = getEntityConfig(a.table_name).pushOrder;
    const orderB = getEntityConfig(b.table_name).pushOrder;
    if (orderA !== orderB) return orderA - orderB;
    return a.created_at.localeCompare(b.created_at);
  });

  const mutations: PushMutationPayload[] = ordered.map((item) => ({
    outbox_id: item.outbox_id,
    table: item.table_name,
    op: item.op,
    record_id: item.record_id,
    base_version: item.base_version,
    changed_fields: JSON.parse(item.changed_fields || '[]') as string[],
    payload: JSON.parse(item.payload || '{}') as Record<string, unknown>,
  }));

  const transport = getSyncTransport();
  const response = await transport.pushChanges(mutations);

  let accepted = 0;
  let merged = 0;
  let serverWins = 0;
  let quarantined = 0;
  const touchedTables = new Set<SyncTableName>();

  const byOutboxId = new Map(ordered.map((r) => [r.outbox_id, r]));

  await db.withTransaction(async () => {
    for (const res of response.results) {
      const original = byOutboxId.get(res.outbox_id);
      if (!original) continue;

      if (res.status === 'rejected') {
        const qId = Crypto.randomUUID();
        await db.run(
          `INSERT INTO sync_quarantine
            (id, outbox_id, table_name, op, record_id, payload, error_code, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            qId,
            original.outbox_id,
            original.table_name,
            original.op,
            original.record_id,
            original.payload,
            res.code ?? res.error_code ?? 'REJECTED',
            res.message ?? res.error_message ?? 'Rejected by server',
            new Date().toISOString(),
          ],
        );
        await db.run(`DELETE FROM sync_outbox WHERE outbox_id = ?`, [original.outbox_id]);
        quarantined += 1;
        continue;
      }

      // Accepted, conflict_merged, or conflict_server_wins -> upsert authoritative server record
      if (res.record) {
        await upsertServerRow(db, original.table_name, res.record);
        touchedTables.add(original.table_name);
      }
      await db.run(`DELETE FROM sync_outbox WHERE outbox_id = ?`, [original.outbox_id]);

      if (res.status === 'conflict_merged' || res.status === 'merged') merged += 1;
      else if (res.status === 'conflict_server_wins') serverWins += 1;
      else accepted += 1;
    }
  });

  notifyTablesChanged([...touchedTables, 'sync_outbox', 'sync_quarantine']);

  return {
    pushed: ordered.length,
    accepted,
    merged,
    serverWins,
    quarantined,
    serverTime: response.server_time,
  };
}
