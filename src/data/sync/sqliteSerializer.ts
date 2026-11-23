import { BindParam, LocalDbAdapter } from '../db/database';
import { SyncTableName } from '../db/types';
import { getEntityConfig } from './registry';

/** Converts a Postgres JSON row into SQLite bind parameters ordered by registry columns. */
export function serializeRowForSqlite(
  table: SyncTableName,
  row: Record<string, unknown>,
): BindParam[] {
  const cfg = getEntityConfig(table);
  const jsonCols = new Set(cfg.jsonColumns ?? []);
  const boolCols = new Set(cfg.booleanColumns ?? []);

  return cfg.columns.map((col) => {
    const val = row[col];
    if (val === undefined || val === null) {
      return null;
    }
    if (jsonCols.has(col)) {
      return typeof val === 'string' ? val : JSON.stringify(val);
    }
    if (boolCols.has(col)) {
      return val === true || val === 1 ? 1 : 0;
    }
    if (typeof val === 'number' || typeof val === 'string') {
      return val;
    }
    return String(val);
  });
}

/** Converts a SQLite row back into typed JS values (parsing JSON & boolean columns). */
export function deserializeRowFromSqlite<T = Record<string, unknown>>(
  table: SyncTableName,
  row: Record<string, unknown>,
): T {
  const cfg = getEntityConfig(table);
  const jsonCols = new Set(cfg.jsonColumns ?? []);
  const boolCols = new Set(cfg.booleanColumns ?? []);
  const out: Record<string, unknown> = { ...row };

  for (const col of jsonCols) {
    if (typeof out[col] === 'string') {
      try {
        out[col] = JSON.parse(out[col] as string);
      } catch {
        out[col] = {};
      }
    }
  }
  for (const col of boolCols) {
    if (typeof out[col] === 'number') {
      out[col] = out[col] === 1;
    }
  }
  return out as T;
}

/** Upserts a single authoritative server row into local SQLite using registry metadata. */
export async function upsertServerRow(
  db: LocalDbAdapter,
  table: SyncTableName,
  row: Record<string, unknown>,
): Promise<void> {
  const cfg = getEntityConfig(table);
  const placeholders = cfg.columns.map(() => '?').join(', ');
  const colList = cfg.columns.join(', ');
  const params = serializeRowForSqlite(table, row);
  await db.run(
    `INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`,
    params,
  );
}
