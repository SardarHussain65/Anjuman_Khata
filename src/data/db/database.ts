import { useCallback, useEffect, useRef, useState } from 'react';
import * as SQLite from 'expo-sqlite';
import { LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION } from './schema';
import { SyncTableName } from './types';

export type BindParam = string | number | null | Uint8Array;

export interface LocalDbAdapter {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: BindParam[]): Promise<void>;
  getAll<T>(sql: string, params?: BindParam[]): Promise<T[]>;
  getFirst<T>(sql: string, params?: BindParam[]): Promise<T | null>;
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
}

const DB_NAME = 'anjuman_khata_v1.db';

let activeAdapter: LocalDbAdapter | null = null;
let initPromise: Promise<LocalDbAdapter> | null = null;
let upgradedSchemaVersion = 0;

async function ensureLocalSchemaUpgraded(adapter: LocalDbAdapter): Promise<void> {
  if (upgradedSchemaVersion >= LOCAL_SCHEMA_VERSION) return;

  for (const stmt of LOCAL_SCHEMA_SQL) {
    await adapter.exec(stmt);
  }

  // Safe idempotent v1 -> v2 upgrade for existing devices (adds per_person_amount & separate zakat_members support)
  const zSetCols = await adapter.getAll<{ name: string }>(`PRAGMA table_info(zakat_settings)`);
  if (!zSetCols.some((c) => c.name === 'per_person_amount')) {
    await adapter.exec(`ALTER TABLE zakat_settings ADD COLUMN per_person_amount INTEGER NOT NULL DEFAULT 0;`);
  }

  const zPayCols = await adapter.getAll<{ name: string; notnull: number }>(`PRAGMA table_info(zakat_payments)`);
  const memberIdNotNull = zPayCols.find((c) => c.name === 'member_id')?.notnull === 1;
  const hasZakatMemberId = zPayCols.some((c) => c.name === 'zakat_member_id');
  if (memberIdNotNull || !hasZakatMemberId) {
    await adapter.withTransaction(async () => {
      await adapter.exec(`DROP TABLE IF EXISTS zakat_payments_v2;`);
      await adapter.exec(`CREATE TABLE zakat_payments_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        member_id TEXT,
        zakat_member_id TEXT,
        family_count_snapshot INTEGER,
        assessment_id TEXT,
        year INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        paid_on TEXT NOT NULL,
        collected_by TEXT,
        remark TEXT,
        void_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        updated_by TEXT,
        version INTEGER NOT NULL DEFAULT 1
      );`);
      await adapter.exec(`INSERT OR IGNORE INTO zakat_payments_v2 (
        id, member_id, assessment_id, year, amount, paid_on, collected_by,
        remark, void_reason, created_at, updated_at, deleted_at, updated_by, version
      ) SELECT
        id, member_id, assessment_id, year, amount, paid_on, collected_by,
        remark, void_reason, created_at, updated_at, deleted_at, updated_by, version
      FROM zakat_payments;`);
      await adapter.exec(`DROP TABLE zakat_payments;`);
      await adapter.exec(`ALTER TABLE zakat_payments_v2 RENAME TO zakat_payments;`);
      await adapter.exec(`CREATE INDEX IF NOT EXISTS idx_local_zpay_updated ON zakat_payments (updated_at);`);
      await adapter.exec(`CREATE INDEX IF NOT EXISTS idx_local_zpay_member_year ON zakat_payments (member_id, year);`);
    });
  }

  await adapter.exec(`CREATE INDEX IF NOT EXISTS idx_local_zpay_zmem_year ON zakat_payments (zakat_member_id, year);`);
  await adapter.run(
    `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('schema_version', ?)`,
    [String(LOCAL_SCHEMA_VERSION)],
  );
  upgradedSchemaVersion = LOCAL_SCHEMA_VERSION;
}

type TableListener = () => void;
const listenersByTable = new Map<string, Set<TableListener>>();

export function notifyTablesChanged(tables: readonly (SyncTableName | 'sync_outbox' | 'sync_quarantine' | 'sync_state')[]): void {
  const notified = new Set<TableListener>();
  for (const table of tables) {
    const set = listenersByTable.get(table);
    if (!set) continue;
    for (const listener of set) {
      if (!notified.has(listener)) {
        notified.add(listener);
        listener();
      }
    }
  }
}

export function subscribeToTables(
  tables: readonly (SyncTableName | 'sync_outbox' | 'sync_quarantine' | 'sync_state')[],
  listener: TableListener,
): () => void {
  for (const table of tables) {
    let set = listenersByTable.get(table);
    if (!set) {
      set = new Set();
      listenersByTable.set(table, set);
    }
    set.add(listener);
  }
  return () => {
    for (const table of tables) {
      listenersByTable.get(table)?.delete(listener);
    }
  };
}

class ExpoSqliteAdapter implements LocalDbAdapter {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }

  async run(sql: string, params: BindParam[] = []): Promise<void> {
    await this.db.runAsync(sql, params);
  }

  async getAll<T>(sql: string, params: BindParam[] = []): Promise<T[]> {
    return await this.db.getAllAsync<T>(sql, params);
  }

  async getFirst<T>(sql: string, params: BindParam[] = []): Promise<T | null> {
    return await this.db.getFirstAsync<T>(sql, params);
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T;
    await this.db.withTransactionAsync(async () => {
      result = await fn();
    });
    return result;
  }
}

/** Allows injecting an in-memory adapter in unit tests. */
export function setLocalDbAdapterForTests(adapter: LocalDbAdapter | null): void {
  activeAdapter = adapter;
  initPromise = adapter ? Promise.resolve(adapter) : null;
  upgradedSchemaVersion = adapter ? LOCAL_SCHEMA_VERSION : 0;
}

export async function getLocalDb(): Promise<LocalDbAdapter> {
  if (activeAdapter) {
    if (upgradedSchemaVersion < LOCAL_SCHEMA_VERSION) {
      await ensureLocalSchemaUpgraded(activeAdapter);
    }
    return activeAdapter;
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const rawDb = await SQLite.openDatabaseAsync(DB_NAME);
      const adapter = new ExpoSqliteAdapter(rawDb);
      await ensureLocalSchemaUpgraded(adapter);
      activeAdapter = adapter;
      return adapter;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

/** Clears all local tables (used when switching accounts on sign-out). */
export async function resetLocalDatabase(): Promise<void> {
  const db = await getLocalDb();
  const tables = [
    'org_settings',
    'profiles',
    'tiers',
    'tier_rates',
    'member_tiers',
    'fiscal_years',
    'contributions',
    'zakat_settings',
    'zakat_members',
    'zakat_assessments',
    'zakat_payments',
    'sync_state',
    'sync_outbox',
    'sync_quarantine',
    'audit_log_cache',
  ];
  await db.withTransaction(async () => {
    for (const t of tables) {
      await db.run(`DELETE FROM ${t}`);
    }
  });
  notifyTablesChanged([
    'org_settings',
    'profiles',
    'tiers',
    'tier_rates',
    'member_tiers',
    'fiscal_years',
    'contributions',
    'zakat_settings',
    'zakat_members',
    'zakat_assessments',
    'zakat_payments',
    'sync_outbox',
    'sync_quarantine',
    'sync_state',
  ]);
}

/**
 * Reactive local SQLite hook (Watermelon-observable equivalent).
 * Re-runs query whenever any watched table mutates locally or via sync pull.
 */
export function useLocalQuery<T>(
  tables: readonly (SyncTableName | 'sync_outbox' | 'sync_quarantine' | 'sync_state')[],
  queryFn: (db: LocalDbAdapter) => Promise<T>,
  deps: readonly unknown[] = [],
): { data: T | null; isLoading: boolean; error: Error | null; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const queryRef = useRef(queryFn);

  useEffect(() => {
    queryRef.current = queryFn;
  });

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const tableKey = tables.join(',');
  const depsKey = JSON.stringify(deps);

  const runQuery = useCallback(async () => {
    try {
      const db = await getLocalDb();
      const result = await queryRef.current(db);
      if (!mountedRef.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e : new Error('Local query failed'));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
    const watched = tableKey.split(',') as (SyncTableName | 'sync_outbox' | 'sync_quarantine' | 'sync_state')[];

    const runNow = () => {
      if (!active) return;
      void runQuery();
    };

    // Coalesce burst table notifications (e.g. multi-month inserts / sync batches) into a single local read
    const scheduleRefresh = () => {
      if (!active) return;
      if (coalesceTimer) clearTimeout(coalesceTimer);
      coalesceTimer = setTimeout(() => {
        coalesceTimer = null;
        runNow();
      }, 30);
    };

    runNow();
    const unsub = subscribeToTables(watched, scheduleRefresh);
    return () => {
      active = false;
      if (coalesceTimer) clearTimeout(coalesceTimer);
      unsub();
    };
  }, [runQuery, tableKey, depsKey]);

  return { data, isLoading, error, refresh: runQuery };
}
