import { LocalDbAdapter, notifyTablesChanged } from '../db/database';
import { SyncTableName } from '../db/types';
import { ALL_SYNC_TABLES } from './registry';
import { getSyncTransport } from '../api/syncRpc';
import { upsertServerRow } from './sqliteSerializer';

const LAST_PULLED_KEY = 'last_pulled_at';

export async function getLastPulledAt(db: LocalDbAdapter): Promise<string | null> {
  const row = await db.getFirst<{ value: string }>(
    `SELECT value FROM sync_state WHERE key = ?`,
    [LAST_PULLED_KEY],
  );
  return row?.value ?? null;
}

export async function setLastPulledAt(db: LocalDbAdapter, serverTime: string): Promise<void> {
  await db.run(
    `INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`,
    [LAST_PULLED_KEY, serverTime],
  );
}

/**
 * Pulls incremental or full changes for all registered entities and upserts them
 * atomically into local SQLite while protecting rows with pending local outbox edits.
 */
export async function pullChangesIntoLocalDb(
  db: LocalDbAdapter,
  options?: {
    tables?: SyncTableName[];
    forceFull?: boolean;
    onTableProgress?: (done: number, total: number) => void;
  },
): Promise<{ serverTime: string; pulledCount: number }> {
  const transport = getSyncTransport();
  const tables = options?.tables ?? ALL_SYNC_TABLES;
  const tierCountRow = await db.getFirst<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM tiers`);
  const needsFullSeedPull = !options?.tables && (tierCountRow?.cnt ?? 0) === 0;
  const lastPulledAt =
    options?.forceFull || needsFullSeedPull ? null : await getLastPulledAt(db);

  // If full pull with progress callback, pull in small table batches so UI shows progress
  if (options?.onTableProgress) {
    let latestServerTime = new Date().toISOString();
    let totalPulled = 0;
    const touched = new Set<SyncTableName>();

    for (let i = 0; i < tables.length; i += 1) {
      const tbl = tables[i];
      let res;
      try {
        res = await transport.pullChanges(lastPulledAt, [tbl]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        // Allow older backend schemas to sync all other tables while a new migration is pending
        if (msg.includes('INVALID_TABLE')) {
          options.onTableProgress(i + 1, tables.length);
          continue;
        }
        throw err;
      }
      latestServerTime = res.server_time;
      const rows = res.changes?.[tbl] ?? [];
      if (rows.length > 0) {
        await db.withTransaction(async () => {
          for (const row of rows) {
            await upsertServerRow(db, tbl, row);
          }
        });
        totalPulled += rows.length;
        touched.add(tbl);
      }
      options.onTableProgress(i + 1, tables.length);
    }

    await setLastPulledAt(db, latestServerTime);
    if (touched.size > 0) {
      notifyTablesChanged([...touched, 'sync_state']);
    }
    return { serverTime: latestServerTime, pulledCount: totalPulled };
  }

  // Standard incremental pull (pass undefined when pulling all tables so server returns every table it supports)
  const response = await transport.pullChanges(lastPulledAt, options?.tables);

  // Protect any record currently waiting in sync_outbox from being overwritten before push
  const pendingRows = await db.getAll<{ table_name: SyncTableName; record_id: string }>(
    `SELECT table_name, record_id FROM sync_outbox`,
  );
  const pendingSet = new Set(pendingRows.map((p) => `${p.table_name}:${p.record_id}`));

  let pulledCount = 0;
  const touchedTables = new Set<SyncTableName>();

  await db.withTransaction(async () => {
    for (const table of tables) {
      const rows = response.changes?.[table] ?? [];
      for (const row of rows) {
        const id = String(row.id ?? '');
        if (!id || pendingSet.has(`${table}:${id}`)) {
          continue;
        }
        await upsertServerRow(db, table, row);
        pulledCount += 1;
        touchedTables.add(table);
      }
    }
    await setLastPulledAt(db, response.server_time);
  });

  if (touchedTables.size > 0) {
    notifyTablesChanged([...touchedTables, 'sync_state']);
  } else {
    notifyTablesChanged(['sync_state']);
  }

  return { serverTime: response.server_time, pulledCount };
}
