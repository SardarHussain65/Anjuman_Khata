import { BindParam, LocalDbAdapter, setLocalDbAdapterForTests } from '../../db/database';
import { setSyncTransportForTests, SyncTransport } from '../../api/syncRpc';
import { resolveConflict, mapQuarantineErrorKey } from '../conflict';
import { ALL_SYNC_TABLES, SYNC_REGISTRY } from '../registry';
import { localInsert, localSoftDelete, localUpdate, runSync } from '../syncEngine';
import { dismissQuarantinedRow, getQuarantinedRows } from '../quarantine';
import { useSyncStatusStore } from '../statusStore';

jest.mock('expo-crypto', () => {
  let seq = 1;
  return {
    randomUUID: () => `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`,
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(async () => ({ isConnected: true })),
  addEventListener: jest.fn(() => jest.fn()),
}));

/**
 * Lightweight in-memory LocalDbAdapter supporting the SQL statements used by the sync engine.
 */
class InMemorySyncDb implements LocalDbAdapter {
  tables = new Map<string, Map<string, Record<string, unknown>>>();

  private getTable(name: string): Map<string, Record<string, unknown>> {
    let tbl = this.tables.get(name);
    if (!tbl) {
      tbl = new Map();
      this.tables.set(name, tbl);
    }
    return tbl;
  }

  private pkCol(table: string): string {
    if (table === 'sync_state') return 'key';
    if (table === 'sync_outbox') return 'outbox_id';
    return 'id';
  }

  async exec(): Promise<void> {}

  async run(sql: string, params: BindParam[] = []): Promise<void> {
    const trimmed = sql.trim().replace(/\s+/g, ' ');

    const insertMatch = trimmed.match(/^INSERT (?:OR REPLACE )?INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/i);
    if (insertMatch) {
      const table = insertMatch[1];
      const cols = insertMatch[2].split(',').map((c) => c.trim());
      const vals = insertMatch[3].split(',').map((v) => v.trim());
      const row: Record<string, unknown> = {};
      let pIdx = 0;
      cols.forEach((col, i) => {
        const token = vals[i];
        if (token === '?') {
          row[col] = params[pIdx++];
        } else if (token.startsWith("'") && token.endsWith("'")) {
          row[col] = token.slice(1, -1);
        } else {
          row[col] = Number(token);
        }
      });
      const pk = String(row[this.pkCol(table)]);
      this.getTable(table).set(pk, row);
      return;
    }

    const updateOutbox = trimmed.match(/^UPDATE sync_outbox SET (.+) WHERE outbox_id = \?$/i);
    if (updateOutbox) {
      const outboxId = String(params[params.length - 1]);
      const row = this.getTable('sync_outbox').get(outboxId);
      if (row) {
        const sets = updateOutbox[1].split(',').map((s) => s.trim());
        let pIdx = 0;
        for (const s of sets) {
          const [col, rhs] = s.split('=').map((x) => x.trim());
          if (rhs === '?') row[col] = params[pIdx++];
          else if (rhs.startsWith("'") && rhs.endsWith("'")) row[col] = rhs.slice(1, -1);
        }
      }
      return;
    }

    const delByPk = trimmed.match(/^DELETE FROM (\w+) WHERE (\w+) = \?(?: AND version <= 1)?$/i);
    if (delByPk) {
      const [, table, col] = delByPk;
      const val = String(params[0]);
      const tbl = this.getTable(table);
      for (const [k, r] of tbl.entries()) {
        if (String(r[col]) === val) {
          if (!trimmed.includes('version <= 1') || Number(r.version ?? 1) <= 1) {
            tbl.delete(k);
          }
        }
      }
    }
  }

  async getAll<T>(sql: string, params: BindParam[] = []): Promise<T[]> {
    const trimmed = sql.trim().replace(/\s+/g, ' ');
    const countMatch = trimmed.match(/^SELECT COUNT\(\*\) AS cnt FROM (\w+)$/i);
    if (countMatch) {
      return [{ cnt: this.getTable(countMatch[1]).size } as unknown as T];
    }
    const selMatch = trimmed.match(/^SELECT .+ FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY .+)?$/i);
    if (!selMatch) return [];
    const [, table, where] = selMatch;
    const rows = Array.from(this.getTable(table).values());
    if (!where) return rows as T[];
    const conds = where.split(' AND ').map((c) => c.trim());
    return rows.filter((r) => {
      return conds.every((cond, idx) => {
        const [col] = cond.split('=').map((s) => s.trim());
        return r[col] === params[idx];
      });
    }) as T[];
  }

  async getFirst<T>(sql: string, params: BindParam[] = []): Promise<T | null> {
    const all = await this.getAll<T>(sql, params);
    return all[0] ?? null;
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return await fn();
  }
}

describe('Sync Registry & Conflict Resolution', () => {
  it('registers all 11 synced tables in valid parent-first push order', () => {
    expect(ALL_SYNC_TABLES).toHaveLength(11);
    const byName = Object.fromEntries(SYNC_REGISTRY.map((e) => [e.table, e.pushOrder]));
    expect(byName.tiers).toBeLessThan(byName.tier_rates);
    expect(byName.profiles).toBeLessThan(byName.contributions);
    expect(byName.zakat_members).toBeLessThan(byName.zakat_payments);
    expect(byName.profiles).toBeLessThan(byName.member_tiers);
    expect(byName.zakat_assessments).toBeLessThan(byName.zakat_payments);
  });

  it('merges non-overlapping fields and logs loser on overlapping fields', () => {
    const res = resolveConflict({
      policy: 'ledger_field_merge',
      serverRecord: { id: 'c1', amount: 300, remark: 'Admin A note', version: 2, deleted_at: null },
      localPatch: { amount: 400 },
      changedFields: ['amount'],
      baseVersion: 1,
    });
    expect(res.resolution).toBe('conflict_merged');
    expect(res.merged.amount).toBe(400);
    expect(res.merged.remark).toBe('Admin A note');
    expect(res.loserFields).toEqual({ amount: 300 });
  });

  it('enforces soft-delete wins over concurrent edit', () => {
    const res = resolveConflict({
      policy: 'ledger_field_merge',
      serverRecord: {
        id: 'c1',
        amount: 300,
        version: 3,
        deleted_at: '2026-02-01T00:00:00Z',
      },
      localPatch: { amount: 900 },
      changedFields: ['amount'],
      baseVersion: 1,
    });
    expect(res.resolution).toBe('conflict_server_wins');
    expect(res.merged.amount).toBe(300);
    expect(res.merged.deleted_at).toBe('2026-02-01T00:00:00Z');
  });

  it('enforces server-wins on config tables', () => {
    const res = resolveConflict({
      policy: 'server_wins',
      serverRecord: { id: 't1', min_amount: 300, version: 2, deleted_at: null },
      localPatch: { min_amount: 250 },
      changedFields: ['min_amount'],
      baseVersion: 1,
    });
    expect(res.resolution).toBe('conflict_server_wins');
    expect(res.merged.min_amount).toBe(300);
    expect(mapQuarantineErrorKey('YEAR_CLOSED')).toBe('sync.reasonYearClosed');
  });
});

describe('Offline-First Sync Engine & Non-Blocking Quarantine', () => {
  let db: InMemorySyncDb;

  beforeEach(() => {
    db = new InMemorySyncDb();
    setLocalDbAdapterForTests(db);
    useSyncStatusStore.setState({
      status: 'idle',
      isOnline: true,
      pendingCount: 0,
      quarantinedCount: 0,
      lastError: null,
    });
  });

  afterEach(() => {
    setLocalDbAdapterForTests(null);
    setSyncTransportForTests(null);
  });

  it('queues offline writes optimistically, quarantines YEAR_CLOSED without blocking valid writes', async () => {
    // Offline insert 1: into closed year 2025
    const badRow = await localInsert(
      'contributions',
      {
        member_id: 'm1',
        amount: 200,
        period_start: '2025-05-01',
        kind: 'monthly',
        paid_on: '2025-05-02',
        remark: 'Late 2025',
      },
      { db, skipAutoSync: true },
    );

    // Offline insert 2: into open year 2026
    const goodRow = await localInsert(
      'contributions',
      {
        member_id: 'm1',
        amount: 500,
        period_start: '2026-02-01',
        kind: 'monthly',
        paid_on: '2026-02-05',
        remark: 'Feb cash',
      },
      { db, skipAutoSync: true },
    );

    expect(useSyncStatusStore.getState().pendingCount).toBe(2);

    const mockTransport: SyncTransport = {
      pushChanges: jest.fn(async (mutations) => ({
        server_time: '2026-02-05T10:00:00Z',
        results: mutations.map((m) =>
          m.record_id === badRow.id
            ? {
                outbox_id: m.outbox_id,
                table: m.table,
                record_id: m.record_id,
                status: 'rejected' as const,
                code: 'YEAR_CLOSED',
                message: 'YEAR_CLOSED: Fiscal year 2025 is closed',
              }
            : {
                outbox_id: m.outbox_id,
                table: m.table,
                record_id: m.record_id,
                status: 'accepted' as const,
                record: { ...m.payload, id: m.record_id, version: 1, updated_at: '2026-02-05T10:00:00Z' },
              },
        ),
      })),
      pullChanges: jest.fn(async () => ({
        server_time: '2026-02-05T10:00:01Z',
        changes: {},
      })),
    };
    setSyncTransportForTests(mockTransport);

    await runSync({ db, forceOfflineCheck: false });

    // Outbox is now empty; badRow is quarantined; goodRow persisted cleanly!
    expect(useSyncStatusStore.getState().pendingCount).toBe(0);
    expect(useSyncStatusStore.getState().quarantinedCount).toBe(1);

    const quarantined = await getQuarantinedRows(db);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].error_code).toBe('YEAR_CLOSED');
    expect(quarantined[0].record_id).toBe(badRow.id);

    // Dismissing quarantined insert cleans up optimistic local row while keeping goodRow
    await dismissQuarantinedRow(quarantined[0].id, db);
    expect(db.tables.get('contributions')?.has(badRow.id)).toBe(false);
    expect(db.tables.get('contributions')?.has(goodRow.id)).toBe(true);
  });

  it('coalesces offline update and soft-delete preserving base_version', async () => {
    // Seed an already-synced contribution (version 2)
    db.tables.set(
      'contributions',
      new Map([
        [
          'c-existing',
          {
            id: 'c-existing',
            member_id: 'm1',
            amount: 200,
            period_start: '2026-01-01',
            kind: 'monthly',
            paid_on: '2026-01-05',
            remark: 'orig',
            version: 2,
            created_at: '2026-01-05T00:00:00Z',
            updated_at: '2026-01-05T00:00:00Z',
            deleted_at: null,
          },
        ],
      ]),
    );

    await localUpdate('contributions', 'c-existing', { amount: 300 }, { db, skipAutoSync: true });
    await localUpdate('contributions', 'c-existing', { remark: 'edited offline' }, { db, skipAutoSync: true });

    const outboxAfterEdits = Array.from(db.tables.get('sync_outbox')?.values() ?? []);
    expect(outboxAfterEdits).toHaveLength(1);
    expect(outboxAfterEdits[0].base_version).toBe(2);
    expect(JSON.parse(String(outboxAfterEdits[0].changed_fields))).toEqual(['amount', 'remark']);

    // Now void offline
    await localSoftDelete('contributions', 'c-existing', 'Wrong month', { db, skipAutoSync: true });
    const outboxAfterVoid = Array.from(db.tables.get('sync_outbox')?.values() ?? []);
    expect(outboxAfterVoid).toHaveLength(1);
    expect(outboxAfterVoid[0].op).toBe('soft_delete');
    expect(db.tables.get('contributions')?.get('c-existing')?.void_reason).toBe('Wrong month');
  });
});
