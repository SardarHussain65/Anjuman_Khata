import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getLocalDb, LocalDbAdapter, notifyTablesChanged } from '../db/database';
import { OutboxRow, QuarantineRow } from '../db/types';

export async function getPendingOutboxRows(db?: LocalDbAdapter): Promise<OutboxRow[]> {
  const conn = db ?? (await getLocalDb());
  return conn.getAll<OutboxRow>(`SELECT * FROM sync_outbox ORDER BY created_at DESC`);
}

export async function getQuarantinedRows(db?: LocalDbAdapter): Promise<QuarantineRow[]> {
  const conn = db ?? (await getLocalDb());
  return conn.getAll<QuarantineRow>(`SELECT * FROM sync_quarantine ORDER BY created_at DESC`);
}

/**
 * Dismisses a quarantined mutation and cleans up any un-synced local insert row
 * so the local database stays consistent with the server.
 */
export async function dismissQuarantinedRow(
  quarantineId: string,
  db?: LocalDbAdapter,
): Promise<void> {
  const conn = db ?? (await getLocalDb());
  const item = await conn.getFirst<QuarantineRow>(
    `SELECT * FROM sync_quarantine WHERE id = ?`,
    [quarantineId],
  );
  if (!item) return;

  await conn.withTransaction(async () => {
    // If a rejected insert was never accepted by the server, remove the optimistic local row
    if (item.op === 'insert') {
      await conn.run(`DELETE FROM ${item.table_name} WHERE id = ? AND version <= 1`, [
        item.record_id,
      ]);
    }
    await conn.run(`DELETE FROM sync_quarantine WHERE id = ?`, [quarantineId]);
  });

  notifyTablesChanged([item.table_name, 'sync_quarantine']);
}

/** Exports pending outbox + quarantine queue as a JSON file and opens the native share sheet. */
export async function exportPendingQueueFile(): Promise<string> {
  const db = await getLocalDb();
  const [outbox, quarantine] = await Promise.all([
    getPendingOutboxRows(db),
    getQuarantinedRows(db),
  ]);

  const snapshot = {
    exported_at: new Date().toISOString(),
    pending_count: outbox.length,
    quarantined_count: quarantine.length,
    outbox: outbox.map((o) => ({
      ...o,
      changed_fields: JSON.parse(o.changed_fields || '[]'),
      payload: JSON.parse(o.payload || '{}'),
    })),
    quarantine: quarantine.map((q) => ({
      ...q,
      payload: JSON.parse(q.payload || '{}'),
    })),
  };

  const fileName = `anjuman-khata-queue-${Date.now()}.json`;
  const file = new File(Paths.cache, fileName);
  file.write(JSON.stringify(snapshot, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Export Pending Sync Queue',
    });
  }
  return file.uri;
}
