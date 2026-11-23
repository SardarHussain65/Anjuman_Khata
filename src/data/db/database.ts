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
}

export async function getLocalDb(): Promise<LocalDbAdapter> {
  if (activeAdapter) return activeAdapter;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const rawDb = await SQLite.openDatabaseAsync(DB_NAME);
    const adapter = new ExpoSqliteAdapter(rawDb);
    for (const stmt of LOCAL_SCHEMA_SQL) {
      await adapter.exec(stmt);
    }
    await adapter.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('schema_version', ?)`,
      [String(LOCAL_SCHEMA_VERSION)],
    );
    activeAdapter = adapter;
    return adapter;
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

  const tableKey = tables.join(',');
  const depsKey = JSON.stringify(deps);

  const runQuery = useCallback(async () => {
    try {
      const db = await getLocalDb();
      const result = await queryRef.current(db);
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Local query failed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const watched = tableKey.split(',') as (SyncTableName | 'sync_outbox' | 'sync_quarantine' | 'sync_state')[];
    const execute = () => {
      if (!active) return;
      void runQuery();
    };
    execute();
    const unsub = subscribeToTables(watched, execute);
    return () => {
      active = false;
      unsub();
    };
  }, [runQuery, tableKey, depsKey]);

  return { data, isLoading, error, refresh: runQuery };
}
