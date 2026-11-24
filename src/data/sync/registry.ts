import { SyncTableName } from '../db/types';

export type ConflictPolicy =
  | 'ledger_field_merge'
  | 'mutable_field_merge'
  | 'server_wins';

export type RoleScope = 'own' | 'shared';

export interface SyncEntityConfig {
  table: SyncTableName;
  /** Lower number pushes first so parent rows exist before dependent children. */
  pushOrder: number;
  /** Standard user scope (admin always pulls all rows). */
  userScope: RoleScope;
  conflictPolicy: ConflictPolicy;
  /** Columns stored in local SQLite & exchanged with Supabase. */
  columns: readonly string[];
  /** Columns serialized as JSON strings in SQLite and JSONB in Postgres. */
  jsonColumns?: readonly string[];
  /** Columns stored as 0/1 in SQLite and boolean in Postgres. */
  booleanColumns?: readonly string[];
}

const SYNC_COMMON_COLS = [
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'updated_by',
  'version',
] as const;

/**
 * Registry-driven sync configuration.
 * Adding a new synced entity only requires adding a single descriptor here —
 * pull, push, upsert, and conflict orchestration read from this registry dynamically.
 */
export const SYNC_REGISTRY: readonly SyncEntityConfig[] = [
  {
    table: 'org_settings',
    pushOrder: 1,
    userScope: 'shared',
    conflictPolicy: 'server_wins',
    columns: [
      ...SYNC_COMMON_COLS,
      'org_name',
      'org_name_ur',
      'logo',
      'fiscal_year_start_month',
      'cycle',
      'currency',
      'grace_days',
    ],
  },
  {
    table: 'tiers',
    pushOrder: 2,
    userScope: 'shared',
    conflictPolicy: 'server_wins',
    columns: [...SYNC_COMMON_COLS, 'code', 'name', 'name_ur', 'min_amount', 'is_active'],
    booleanColumns: ['is_active'],
  },
  {
    table: 'tier_rates',
    pushOrder: 3,
    userScope: 'shared',
    conflictPolicy: 'server_wins',
    columns: [...SYNC_COMMON_COLS, 'tier_id', 'min_amount', 'effective_from'],
  },
  {
    table: 'fiscal_years',
    pushOrder: 4,
    userScope: 'shared',
    conflictPolicy: 'server_wins',
    columns: [
      ...SYNC_COMMON_COLS,
      'label',
      'start_date',
      'end_date',
      'status',
      'closed_by',
      'closed_at',
      'reopen_reason',
    ],
  },
  {
    table: 'zakat_settings',
    pushOrder: 5,
    userScope: 'shared',
    conflictPolicy: 'server_wins',
    columns: [
      ...SYNC_COMMON_COLS,
      'year',
      'nisab_amount',
      'rate_bps',
      'basis_note',
      'per_person_amount',
    ],
  },
  {
    table: 'profiles',
    pushOrder: 6,
    userScope: 'own',
    conflictPolicy: 'mutable_field_merge',
    columns: [
      ...SYNC_COMMON_COLS,
      'member_no',
      'full_name',
      'full_name_ur',
      'phone',
      'designation',
      'tag',
      'status',
      'role',
      'personal_pledge',
      'joined_on',
      'notes',
    ],
  },
  {
    table: 'member_tiers',
    pushOrder: 7,
    userScope: 'own',
    conflictPolicy: 'mutable_field_merge',
    columns: [...SYNC_COMMON_COLS, 'member_id', 'tier_id', 'effective_from', 'reason'],
  },
  {
    table: 'contributions',
    pushOrder: 8,
    userScope: 'own',
    conflictPolicy: 'ledger_field_merge',
    columns: [
      ...SYNC_COMMON_COLS,
      'member_id',
      'amount',
      'period_start',
      'kind',
      'paid_on',
      'collected_by',
      'remark',
      'void_reason',
      'client_created_at',
    ],
  },
  {
    table: 'zakat_members',
    pushOrder: 9,
    userScope: 'shared',
    conflictPolicy: 'mutable_field_merge',
    columns: [
      ...SYNC_COMMON_COLS,
      'member_no',
      'payer_name',
      'khandan_name',
      'is_family',
      'family_count',
      'status',
      'notes',
    ],
    booleanColumns: ['is_family'],
  },
  {
    table: 'zakat_assessments',
    pushOrder: 10,
    userScope: 'own',
    conflictPolicy: 'mutable_field_merge',
    columns: [
      ...SYNC_COMMON_COLS,
      'member_id',
      'year',
      'assets',
      'liabilities',
      'net_zakatable',
      'nisab_used',
      'rate_bps',
      'due_amount',
      'assessed_by',
      'notes',
    ],
    jsonColumns: ['assets'],
  },
  {
    table: 'zakat_payments',
    pushOrder: 11,
    userScope: 'own',
    conflictPolicy: 'ledger_field_merge',
    columns: [
      ...SYNC_COMMON_COLS,
      'member_id',
      'zakat_member_id',
      'family_count_snapshot',
      'assessment_id',
      'year',
      'amount',
      'paid_on',
      'collected_by',
      'remark',
      'void_reason',
    ],
  },
] as const;

export const SYNC_REGISTRY_MAP: Record<SyncTableName, SyncEntityConfig> =
  SYNC_REGISTRY.reduce(
    (acc, item) => {
      acc[item.table] = item;
      return acc;
    },
    {} as Record<SyncTableName, SyncEntityConfig>,
  );

export const ALL_SYNC_TABLES: SyncTableName[] = SYNC_REGISTRY.map((e) => e.table);

export function getEntityConfig(table: SyncTableName): SyncEntityConfig {
  const cfg = SYNC_REGISTRY_MAP[table];
  if (!cfg) {
    throw new Error(`Sync entity not registered: ${table}`);
  }
  return cfg;
}
