/**
 * Strongly-typed data models mirroring Postgres & local SQLite tables.
 * All PKR amounts are integer rupees; dates are ISO strings (YYYY-MM-DD);
 * timestamps are ISO-8601 UTC strings.
 */

export interface SyncBaseRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  updated_by: string | null;
  version: number;
}

export interface OrgSettingsRow extends SyncBaseRow {
  org_name: string;
  org_name_ur: string;
  logo: string | null;
  fiscal_year_start_month: number;
  cycle: 'monthly';
  currency: string;
  grace_days: number;
}

export type MemberStatus = 'active' | 'non_earning' | 'inactive';

export interface ProfileRow extends SyncBaseRow {
  member_no: number;
  full_name: string;
  full_name_ur: string | null;
  phone: string | null;
  designation: string | null;
  tag: string | null;
  status: MemberStatus;
  role: 'user' | 'admin' | 'super_admin';
  personal_pledge: number | null;
  joined_on: string;
  notes: string | null;
}

export interface TierRow extends SyncBaseRow {
  code: string;
  name: string;
  name_ur: string;
  min_amount: number;
  is_active: boolean | number;
}

export interface TierRateRow extends SyncBaseRow {
  tier_id: string;
  min_amount: number;
  effective_from: string;
}

export interface MemberTierRow extends SyncBaseRow {
  member_id: string;
  tier_id: string;
  effective_from: string;
  reason: string | null;
}

export type FiscalYearStatus = 'open' | 'closed';

export interface FiscalYearRow extends SyncBaseRow {
  label: string;
  start_date: string;
  end_date: string;
  status: FiscalYearStatus;
  closed_by: string | null;
  closed_at: string | null;
  reopen_reason: string | null;
}

export type ContributionKind = 'monthly' | 'special' | 'advance';

export interface ContributionRow extends SyncBaseRow {
  member_id: string;
  amount: number;
  period_start: string;
  kind: ContributionKind;
  paid_on: string;
  collected_by: string | null;
  remark: string | null;
  void_reason: string | null;
  client_created_at: string | null;
}

export interface ZakatSettingRow extends SyncBaseRow {
  year: number;
  nisab_amount: number;
  rate_bps: number;
  basis_note: string;
  per_person_amount: number;
}

export type ZakatMemberStatus = 'active' | 'inactive';

export interface ZakatMemberRow extends SyncBaseRow {
  member_no: number;
  payer_name: string;
  khandan_name: string;
  is_family: boolean | number;
  family_count: number;
  status: ZakatMemberStatus;
  notes: string | null;
}

export interface ZakatAssetsBreakdown {
  cash?: number;
  gold?: number;
  silver?: number;
  business_inventory?: number;
  receivables?: number;
  other?: number;
  [category: string]: number | undefined;
}

export interface ZakatAssessmentRow extends SyncBaseRow {
  member_id: string;
  year: number;
  assets: ZakatAssetsBreakdown;
  liabilities: number;
  net_zakatable: number;
  nisab_used: number;
  rate_bps: number;
  due_amount: number;
  assessed_by: string | null;
  notes: string | null;
}

export interface ZakatPaymentRow extends SyncBaseRow {
  member_id: string | null;
  zakat_member_id: string | null;
  family_count_snapshot: number | null;
  assessment_id: string | null;
  year: number;
  amount: number;
  paid_on: string;
  collected_by: string | null;
  remark: string | null;
  void_reason: string | null;
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  table_name: string;
  record_id: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

export type SyncTableName =
  | 'org_settings'
  | 'tiers'
  | 'tier_rates'
  | 'fiscal_years'
  | 'zakat_settings'
  | 'profiles'
  | 'member_tiers'
  | 'contributions'
  | 'zakat_members'
  | 'zakat_assessments'
  | 'zakat_payments';

export type SyncOp = 'insert' | 'update' | 'soft_delete';

export interface OutboxRow {
  outbox_id: string;
  table_name: SyncTableName;
  op: SyncOp;
  record_id: string;
  base_version: number;
  changed_fields: string; // JSON string[]
  payload: string; // JSON object
  created_at: string;
  attempts: number;
  last_error: string | null;
}

export interface QuarantineRow {
  id: string;
  outbox_id: string;
  table_name: SyncTableName;
  op: SyncOp;
  record_id: string;
  payload: string; // JSON object
  error_code: string;
  error_message: string;
  created_at: string;
}
