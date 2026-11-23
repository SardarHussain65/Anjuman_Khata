import { supabase } from './supabaseClient';
import { getLocalDb } from '../db/database';
import { AuditLogRow } from '../db/types';

async function cacheAuditRows(rows: AuditLogRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getLocalDb();
  await db.withTransaction(async () => {
    for (const r of rows) {
      await db.run(
        `INSERT OR REPLACE INTO audit_log_cache
          (id, actor_id, action, table_name, record_id, old_data, new_data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id,
          r.actor_id,
          r.action,
          r.table_name,
          r.record_id,
          r.old_data ? JSON.stringify(r.old_data) : null,
          r.new_data ? JSON.stringify(r.new_data) : null,
          r.created_at,
        ],
      );
    }
  });
}

async function readCachedAuditRows(recordId?: string): Promise<AuditLogRow[]> {
  const db = await getLocalDb();
  const rows = recordId
    ? await db.getAll<Record<string, unknown>>(
        `SELECT * FROM audit_log_cache WHERE record_id = ? ORDER BY created_at DESC LIMIT 100`,
        [recordId],
      )
    : await db.getAll<Record<string, unknown>>(
        `SELECT * FROM audit_log_cache ORDER BY created_at DESC LIMIT 200`,
      );

  return rows.map((r) => ({
    id: String(r.id),
    actor_id: r.actor_id ? String(r.actor_id) : null,
    action: String(r.action),
    table_name: String(r.table_name),
    record_id: String(r.record_id),
    old_data: typeof r.old_data === 'string' ? JSON.parse(r.old_data) : null,
    new_data: typeof r.new_data === 'string' ? JSON.parse(r.new_data) : null,
    created_at: String(r.created_at),
  }));
}

/** Fetches recent audit_log entries (online-first, falls back to local cache offline). */
export async function fetchAuditLog(limit = 150): Promise<{ rows: AuditLogRow[]; fromCache: boolean }> {
  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('id, actor_id, action, table_name, record_id, old_data, new_data, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return { rows: await readCachedAuditRows(), fromCache: true };
    }
    const rows = data as AuditLogRow[];
    await cacheAuditRows(rows).catch(() => {});
    return { rows, fromCache: false };
  } catch {
    return { rows: await readCachedAuditRows(), fromCache: true };
  }
}

/** Fetches change timeline for a specific record_id from audit_log. */
export async function fetchRecordAuditTimeline(
  recordId: string,
): Promise<{ rows: AuditLogRow[]; fromCache: boolean }> {
  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('id, actor_id, action, table_name, record_id, old_data, new_data, created_at')
      .eq('record_id', recordId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data) {
      return { rows: await readCachedAuditRows(recordId), fromCache: true };
    }
    const rows = data as AuditLogRow[];
    await cacheAuditRows(rows).catch(() => {});
    return { rows, fromCache: false };
  } catch {
    return { rows: await readCachedAuditRows(recordId), fromCache: true };
  }
}
