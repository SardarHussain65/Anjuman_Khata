/**
 * Local SQLite schema mirroring Postgres tables + offline outbox & quarantine queues.
 * Uses WAL journal mode and indexes matching Section 4 of the specification.
 */

export const LOCAL_SCHEMA_VERSION = 2;

export const LOCAL_SCHEMA_SQL: string[] = [
  `PRAGMA journal_mode = WAL;`,
  `PRAGMA foreign_keys = OFF;`,

  `CREATE TABLE IF NOT EXISTS org_settings (
    id TEXT PRIMARY KEY NOT NULL,
    org_name TEXT NOT NULL,
    org_name_ur TEXT NOT NULL DEFAULT '',
    logo TEXT,
    fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
    cycle TEXT NOT NULL DEFAULT 'monthly',
    currency TEXT NOT NULL DEFAULT 'PKR',
    grace_days INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY NOT NULL,
    member_no INTEGER NOT NULL,
    full_name TEXT NOT NULL,
    full_name_ur TEXT,
    phone TEXT,
    designation TEXT,
    tag TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    role TEXT NOT NULL DEFAULT 'user',
    personal_pledge INTEGER,
    joined_on TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS tiers (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ur TEXT NOT NULL DEFAULT '',
    min_amount INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS tier_rates (
    id TEXT PRIMARY KEY NOT NULL,
    tier_id TEXT NOT NULL,
    min_amount INTEGER NOT NULL,
    effective_from TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS member_tiers (
    id TEXT PRIMARY KEY NOT NULL,
    member_id TEXT NOT NULL,
    tier_id TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS fiscal_years (
    id TEXT PRIMARY KEY NOT NULL,
    label TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    closed_by TEXT,
    closed_at TEXT,
    reopen_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS contributions (
    id TEXT PRIMARY KEY NOT NULL,
    member_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    period_start TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'monthly',
    paid_on TEXT NOT NULL,
    collected_by TEXT,
    remark TEXT,
    void_reason TEXT,
    client_created_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS zakat_settings (
    id TEXT PRIMARY KEY NOT NULL,
    year INTEGER NOT NULL,
    nisab_amount INTEGER NOT NULL DEFAULT 0,
    rate_bps INTEGER NOT NULL DEFAULT 250,
    basis_note TEXT NOT NULL DEFAULT '',
    per_person_amount INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS zakat_members (
    id TEXT PRIMARY KEY NOT NULL,
    member_no INTEGER NOT NULL,
    payer_name TEXT NOT NULL,
    khandan_name TEXT NOT NULL DEFAULT '',
    is_family INTEGER NOT NULL DEFAULT 0,
    family_count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS zakat_assessments (
    id TEXT PRIMARY KEY NOT NULL,
    member_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    assets TEXT NOT NULL DEFAULT '{}',
    liabilities INTEGER NOT NULL DEFAULT 0,
    net_zakatable INTEGER NOT NULL DEFAULT 0,
    nisab_used INTEGER NOT NULL DEFAULT 0,
    rate_bps INTEGER NOT NULL DEFAULT 250,
    due_amount INTEGER NOT NULL DEFAULT 0,
    assessed_by TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );`,

  `CREATE TABLE IF NOT EXISTS zakat_payments (
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
  );`,

  // Local sync infrastructure tables
  `CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS sync_outbox (
    outbox_id TEXT PRIMARY KEY NOT NULL,
    table_name TEXT NOT NULL,
    op TEXT NOT NULL,
    record_id TEXT NOT NULL,
    base_version INTEGER NOT NULL DEFAULT 0,
    changed_fields TEXT NOT NULL DEFAULT '[]',
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS sync_quarantine (
    id TEXT PRIMARY KEY NOT NULL,
    outbox_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    op TEXT NOT NULL,
    record_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    error_code TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS audit_log_cache (
    id TEXT PRIMARY KEY NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    old_data TEXT,
    new_data TEXT,
    created_at TEXT NOT NULL
  );`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_local_org_updated ON org_settings (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_profiles_updated ON profiles (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_tiers_updated ON tiers (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_tier_rates_updated ON tier_rates (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_member_tiers_updated ON member_tiers (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_member_tiers_lookup ON member_tiers (member_id, effective_from);`,
  `CREATE INDEX IF NOT EXISTS idx_local_fy_updated ON fiscal_years (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_contrib_updated ON contributions (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_contrib_member_period ON contributions (member_id, period_start);`,
  `CREATE INDEX IF NOT EXISTS idx_local_contrib_period ON contributions (period_start);`,
  `CREATE INDEX IF NOT EXISTS idx_local_zset_updated ON zakat_settings (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_zmem_updated ON zakat_members (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_zass_updated ON zakat_assessments (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_zass_member_year ON zakat_assessments (member_id, year);`,
  `CREATE INDEX IF NOT EXISTS idx_local_zpay_updated ON zakat_payments (updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_local_zpay_member_year ON zakat_payments (member_id, year);`,
];
