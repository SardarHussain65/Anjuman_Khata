import { LocalDbAdapter, useLocalQuery } from './database';
import {
  ContributionRow,
  FiscalYearRow,
  MemberTierRow,
  OrgSettingsRow,
  ProfileRow,
  TierRateRow,
  TierRow,
  ZakatAssessmentRow,
  ZakatMemberRow,
  ZakatPaymentRow,
  ZakatSettingRow,
} from './types';
import { deserializeRowFromSqlite } from '../sync/sqliteSerializer';
import { ALL_SYNC_TABLES } from '../sync/registry';

export interface LocalRegisterSnapshot {
  orgSettings: OrgSettingsRow | null;
  profiles: ProfileRow[];
  tiers: TierRow[];
  tierRates: TierRateRow[];
  memberTiers: MemberTierRow[];
  fiscalYears: FiscalYearRow[];
  contributions: ContributionRow[];
  zakatSettings: ZakatSettingRow[];
  zakatMembers: ZakatMemberRow[];
  zakatAssessments: ZakatAssessmentRow[];
  zakatPayments: ZakatPaymentRow[];
}

export async function loadRegisterSnapshot(db: LocalDbAdapter): Promise<LocalRegisterSnapshot> {
  const [
    orgRows,
    profileRows,
    tierRows,
    tierRateRows,
    memberTierRows,
    fiscalYearRows,
    contributionRows,
    zakatSettingRows,
    zakatMemberRows,
    zakatAssessmentRows,
    zakatPaymentRows,
  ] = await Promise.all([
    db.getAll<Record<string, unknown>>(`SELECT * FROM org_settings WHERE deleted_at IS NULL LIMIT 1`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM profiles WHERE deleted_at IS NULL ORDER BY member_no ASC`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM tiers WHERE deleted_at IS NULL ORDER BY min_amount ASC`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM tier_rates WHERE deleted_at IS NULL ORDER BY effective_from DESC`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM member_tiers WHERE deleted_at IS NULL ORDER BY effective_from DESC`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM fiscal_years WHERE deleted_at IS NULL ORDER BY start_date DESC`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM contributions ORDER BY paid_on DESC, created_at DESC`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM zakat_settings WHERE deleted_at IS NULL ORDER BY year DESC`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM zakat_members WHERE deleted_at IS NULL ORDER BY member_no ASC`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM zakat_assessments ORDER BY year DESC, created_at DESC`),
    db.getAll<Record<string, unknown>>(`SELECT * FROM zakat_payments ORDER BY paid_on DESC, created_at DESC`),
  ]);

  return {
    orgSettings: orgRows[0] ? deserializeRowFromSqlite<OrgSettingsRow>('org_settings', orgRows[0]) : null,
    profiles: profileRows.map((r) => deserializeRowFromSqlite<ProfileRow>('profiles', r)),
    tiers: tierRows.map((r) => deserializeRowFromSqlite<TierRow>('tiers', r)),
    tierRates: tierRateRows.map((r) => deserializeRowFromSqlite<TierRateRow>('tier_rates', r)),
    memberTiers: memberTierRows.map((r) => deserializeRowFromSqlite<MemberTierRow>('member_tiers', r)),
    fiscalYears: fiscalYearRows.map((r) => deserializeRowFromSqlite<FiscalYearRow>('fiscal_years', r)),
    contributions: contributionRows.map((r) => deserializeRowFromSqlite<ContributionRow>('contributions', r)),
    zakatSettings: zakatSettingRows.map((r) => deserializeRowFromSqlite<ZakatSettingRow>('zakat_settings', r)),
    zakatMembers: zakatMemberRows.map((r) => deserializeRowFromSqlite<ZakatMemberRow>('zakat_members', r)),
    zakatAssessments: zakatAssessmentRows.map((r) => deserializeRowFromSqlite<ZakatAssessmentRow>('zakat_assessments', r)),
    zakatPayments: zakatPaymentRows.map((r) => deserializeRowFromSqlite<ZakatPaymentRow>('zakat_payments', r)),
  };
}

/** Reactive offline-first hook returning the full local register snapshot. */
export function useRegisterSnapshot() {
  return useLocalQuery<LocalRegisterSnapshot>(ALL_SYNC_TABLES, loadRegisterSnapshot, []);
}
