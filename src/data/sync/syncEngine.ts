import * as Crypto from 'expo-crypto';
import NetInfo from '@react-native-community/netinfo';
import { getLocalDb, LocalDbAdapter, notifyTablesChanged } from '../db/database';
import { OutboxRow, SyncTableName } from '../db/types';
import { ALL_SYNC_TABLES, getEntityConfig } from './registry';
import { upsertServerRow } from './sqliteSerializer';
import { pushPendingOutbox } from './push';
import { getLastPulledAt, pullChangesIntoLocalDb } from './pull';
import { useSyncStatusStore } from './statusStore';
import { useAuthStore } from '@/features/auth/store/authStore';

const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000] as const;

let activeSyncPromise: Promise<void> | null = null;
let followUpSyncNeeded = false;
let failureStreak = 0;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let writeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function refreshQueueCounts(db?: LocalDbAdapter): Promise<{
  pending: number;
  quarantined: number;
}> {
  const conn = db ?? (await getLocalDb());
  const [pRow, qRow] = await Promise.all([
    conn.getFirst<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM sync_outbox`),
    conn.getFirst<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM sync_quarantine`),
  ]);
  const pending = Number(pRow?.cnt ?? 0);
  const quarantined = Number(qRow?.cnt ?? 0);
  useSyncStatusStore.getState().setCounts(pending, quarantined);
  return { pending, quarantined };
}

function scheduleDebouncedSync(): void {
  if (writeDebounceTimer) clearTimeout(writeDebounceTimer);
  writeDebounceTimer = setTimeout(() => {
    runSync().catch(() => {});
  }, 1_500);
}

export function resetSyncBackoff(): void {
  failureStreak = 0;
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

/**
 * Optimistically inserts a new record into local SQLite with a client-generated UUIDv4
 * and queues it for server push. Works 100% offline.
 */
export async function localInsert<T extends Record<string, unknown>>(
  table: SyncTableName,
  fields: T,
  options?: { db?: LocalDbAdapter; actorId?: string | null; skipAutoSync?: boolean },
): Promise<T & { id: string; version: number; created_at: string; updated_at: string }> {
  const db = options?.db ?? (await getLocalDb());
  const now = new Date().toISOString();
  const id = (fields.id as string | undefined) ?? Crypto.randomUUID();
  const cfg = getEntityConfig(table);

  const row: Record<string, unknown> = {
    deleted_at: null,
    ...fields,
    id,
    created_at: (fields.created_at as string | undefined) ?? now,
    updated_at: now,
    updated_by: options?.actorId ?? (fields.updated_by as string | null | undefined) ?? null,
    version: 1,
  };

  if (table === 'contributions' && !row.client_created_at) {
    row.client_created_at = now;
  }

  const outboxId = Crypto.randomUUID();
  const changedFields = Object.keys(row).filter(
    (k) => cfg.columns.includes(k) && !['id', 'created_at', 'updated_at', 'updated_by', 'version'].includes(k),
  );

  await db.withTransaction(async () => {
    await upsertServerRow(db, table, row);
    await db.run(
      `INSERT INTO sync_outbox
        (outbox_id, table_name, op, record_id, base_version, changed_fields, payload, created_at)
       VALUES (?, ?, 'insert', ?, 0, ?, ?, ?)`,
      [outboxId, table, id, JSON.stringify(changedFields), JSON.stringify(row), now],
    );
  });

  await refreshQueueCounts(db);
  notifyTablesChanged([table, 'sync_outbox']);
  if (!options?.skipAutoSync) scheduleDebouncedSync();

  return row as T & { id: string; version: number; created_at: string; updated_at: string };
}

/**
 * Optimistically updates an existing local record, tracking exact changed_fields
 * and preserving the original server base_version for field-level conflict resolution.
 */
export async function localUpdate<T extends Record<string, unknown>>(
  table: SyncTableName,
  recordId: string,
  patch: Partial<T>,
  options?: { db?: LocalDbAdapter; actorId?: string | null; skipAutoSync?: boolean },
): Promise<void> {
  const db = options?.db ?? (await getLocalDb());
  const existing = await db.getFirst<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = ?`,
    [recordId],
  );
  if (!existing) {
    throw new Error(`Cannot update missing local record ${table}:${recordId}`);
  }

  const now = new Date().toISOString();
  const cfg = getEntityConfig(table);
  const changedFields = Object.keys(patch).filter(
    (k) => cfg.columns.includes(k) && !['id', 'created_at', 'updated_at', 'updated_by', 'version'].includes(k),
  );

  const mergedLocal: Record<string, unknown> = {
    ...existing,
    ...patch,
    updated_at: now,
    updated_by: options?.actorId ?? existing.updated_by ?? null,
  };

  await db.withTransaction(async () => {
    await upsertServerRow(db, table, mergedLocal);

    const existingOutbox = await db.getFirst<OutboxRow>(
      `SELECT * FROM sync_outbox WHERE table_name = ? AND record_id = ?`,
      [table, recordId],
    );

    if (existingOutbox) {
      const prevPayload = JSON.parse(existingOutbox.payload || '{}') as Record<string, unknown>;
      const prevFields = JSON.parse(existingOutbox.changed_fields || '[]') as string[];
      const unionFields = Array.from(new Set([...prevFields, ...changedFields]));
      const nextPayload = { ...prevPayload, ...patch };
      await db.run(
        `UPDATE sync_outbox SET changed_fields = ?, payload = ? WHERE outbox_id = ?`,
        [JSON.stringify(unionFields), JSON.stringify(nextPayload), existingOutbox.outbox_id],
      );
    } else {
      const outboxId = Crypto.randomUUID();
      const baseVersion = Number(existing.version ?? 1);
      await db.run(
        `INSERT INTO sync_outbox
          (outbox_id, table_name, op, record_id, base_version, changed_fields, payload, created_at)
         VALUES (?, ?, 'update', ?, ?, ?, ?, ?)`,
        [
          outboxId,
          table,
          recordId,
          baseVersion,
          JSON.stringify(changedFields),
          JSON.stringify(patch),
          now,
        ],
      );
    }
  });

  await refreshQueueCounts(db);
  notifyTablesChanged([table, 'sync_outbox']);
  if (!options?.skipAutoSync) scheduleDebouncedSync();
}

/**
 * Optimistically voids (soft-deletes) a local record with a required reason where applicable.
 * Never performs a hard delete.
 */
export async function localSoftDelete(
  table: SyncTableName,
  recordId: string,
  voidReason?: string,
  options?: { db?: LocalDbAdapter; actorId?: string | null; skipAutoSync?: boolean },
): Promise<void> {
  const db = options?.db ?? (await getLocalDb());
  const existing = await db.getFirst<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = ?`,
    [recordId],
  );
  if (!existing) {
    throw new Error(`Cannot void missing local record ${table}:${recordId}`);
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { deleted_at: now };
  const changedFields = ['deleted_at'];
  if (voidReason !== undefined) {
    patch.void_reason = voidReason.trim();
    changedFields.push('void_reason');
  }

  const mergedLocal: Record<string, unknown> = {
    ...existing,
    ...patch,
    updated_at: now,
    updated_by: options?.actorId ?? existing.updated_by ?? null,
  };

  await db.withTransaction(async () => {
    await upsertServerRow(db, table, mergedLocal);

    const existingOutbox = await db.getFirst<OutboxRow>(
      `SELECT * FROM sync_outbox WHERE table_name = ? AND record_id = ?`,
      [table, recordId],
    );

    if (existingOutbox && existingOutbox.op === 'insert') {
      // Unsynced local insert being voided before ever reaching server: push as insert with deleted_at + void_reason
      // so full audit history is preserved even for offline mistakes
      const prevPayload = JSON.parse(existingOutbox.payload || '{}') as Record<string, unknown>;
      await db.run(
        `UPDATE sync_outbox SET payload = ? WHERE outbox_id = ?`,
        [JSON.stringify({ ...prevPayload, ...patch }), existingOutbox.outbox_id],
      );
    } else if (existingOutbox) {
      const prevPayload = JSON.parse(existingOutbox.payload || '{}') as Record<string, unknown>;
      await db.run(
        `UPDATE sync_outbox SET op = 'soft_delete', changed_fields = ?, payload = ? WHERE outbox_id = ?`,
        [JSON.stringify(changedFields), JSON.stringify({ ...prevPayload, ...patch }), existingOutbox.outbox_id],
      );
    } else {
      const outboxId = Crypto.randomUUID();
      await db.run(
        `INSERT INTO sync_outbox
          (outbox_id, table_name, op, record_id, base_version, changed_fields, payload, created_at)
         VALUES (?, ?, 'soft_delete', ?, ?, ?, ?, ?)`,
        [
          outboxId,
          table,
          recordId,
          Number(existing.version ?? 1),
          JSON.stringify(changedFields),
          JSON.stringify(patch),
          now,
        ],
      );
    }
  });

  await refreshQueueCounts(db);
  notifyTablesChanged([table, 'sync_outbox']);
  if (!options?.skipAutoSync) scheduleDebouncedSync();
}

/** Runs a full push -> pull cycle with single-flight locking, follow-up coalescing & exponential backoff. */
export async function runSync(options?: {
  db?: LocalDbAdapter;
  forceOfflineCheck?: boolean;
  allowPush?: boolean;
}): Promise<void> {
  if (activeSyncPromise) {
    followUpSyncNeeded = true;
    return activeSyncPromise;
  }

  activeSyncPromise = (async () => {
    const store = useSyncStatusStore.getState();
    const db = options?.db ?? (await getLocalDb());

    if (options?.forceOfflineCheck !== false) {
      const net = await NetInfo.fetch().catch(() => ({ isConnected: true }));
      const online = net.isConnected !== false;
      store.setOnline(online);
      if (!online) {
        await refreshQueueCounts(db);
        return;
      }
    }

    // In passwordless read-only viewer mode (`anon`), skip pushing stale admin outbox items so pull never fails
    const authState = useAuthStore.getState();
    const isAdminSession = Boolean(authState.session && authState.profile?.role === 'admin');
    const shouldPush =
      options?.allowPush !== undefined
        ? options.allowPush
        : options?.db !== undefined || isAdminSession;

    store.setSyncing();
    try {
      if (shouldPush) {
        await pushPendingOutbox(db);
      }
      const pullRes = await pullChangesIntoLocalDb(db);
      await refreshQueueCounts(db);
      resetSyncBackoff();
      store.setSynced(pullRes.serverTime);
    } catch (err) {
      await refreshQueueCounts(db);
      const message = err instanceof Error ? err.message : 'Sync failed';
      store.setError(message);

      // Exponential backoff retry
      const delay = BACKOFF_MS[Math.min(failureStreak, BACKOFF_MS.length - 1)];
      failureStreak += 1;
      if (backoffTimer) clearTimeout(backoffTimer);
      backoffTimer = setTimeout(() => {
        if (useSyncStatusStore.getState().isOnline) {
          runSync().catch(() => {});
        }
      }, delay);
    } finally {
      activeSyncPromise = null;
      if (followUpSyncNeeded) {
        followUpSyncNeeded = false;
        runSync(options).catch(() => {});
      }
    }
  })();

  return activeSyncPromise;
}

/** Performs first-login full pull with visible progress if local DB has never synced yet. */
export async function runInitialPullIfNeeded(db?: LocalDbAdapter): Promise<void> {
  const conn = db ?? (await getLocalDb());
  const lastPulled = await getLastPulledAt(conn);
  if (lastPulled) {
    await refreshQueueCounts(conn);
    useSyncStatusStore.getState().setSynced(lastPulled);
    runSync({ db: conn }).catch(() => {});
    return;
  }

  const net = await NetInfo.fetch().catch(() => ({ isConnected: true }));
  if (net.isConnected === false) {
    useSyncStatusStore.getState().setOnline(false);
    return;
  }

  const store = useSyncStatusStore.getState();
  store.setInitialPullProgress(true, 0, ALL_SYNC_TABLES.length);
  store.setSyncing();
  try {
    const res = await pullChangesIntoLocalDb(conn, {
      forceFull: true,
      onTableProgress: (done, total) => {
        store.setInitialPullProgress(true, done, total);
      },
    });
    await refreshQueueCounts(conn);
    store.setSynced(res.serverTime);
  } catch (err) {
    store.setError(err instanceof Error ? err.message : 'Initial sync failed');
  } finally {
    store.setInitialPullProgress(false, 0, 0);
  }
}
