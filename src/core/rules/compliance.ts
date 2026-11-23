import { getKarachiCurrentMonthStart, toMonthStart } from '../dates';
import {
  ContributionRow,
  FiscalYearRow,
  MemberTierRow,
  ProfileRow,
  TierRateRow,
  TierRow,
} from '@/data/db/types';
import { ComplianceStatus } from '../ui/Badge';
import { EffectiveTier, resolveEffectiveTierForMonth } from './tiers';
import { getMonthsForFiscalYear, isPeriodInFiscalYear } from './fiscalYear';

export interface MonthComplianceResult {
  periodStart: string;
  status: ComplianceStatus;
  expectedMin: number;
  paidAmount: number;
  shortfall: number;
  surplus: number;
  effectiveTier: EffectiveTier | null;
  entries: ContributionRow[];
}

export interface MemberFiscalYearSummary {
  member: ProfileRow;
  fiscalYear: FiscalYearRow;
  months: MonthComplianceResult[];
  yearlyCharityTotal: number;
  expectedTotalToDate: number;
  arrearsTotal: number;
  metCount: number;
  shortCount: number;
  unpaidCount: number;
  advanceCount: number;
  exemptCount: number;
  currentMonthCompliance: MonthComplianceResult | null;
  isBelowMinimumCurrentCycle: boolean;
}

/**
 * Pure compliance rule for one member in one month.
 * - `non_earning` / `inactive` / no tier yet -> `exempt` (never flagged overdue/short, shortfall = 0)
 * - Future months (> Karachi current month) -> `advance` if paid > 0, else `exempt`
 * - Surplus stays on the paid month and never auto-carries to other months
 */
export function computeMemberMonthCompliance(params: {
  profile: Pick<ProfileRow, 'status'>;
  periodStart: string;
  currentMonthStart: string;
  paidAmount: number;
  effectiveTier: EffectiveTier | null;
  entries?: ContributionRow[];
}): MonthComplianceResult {
  const { profile, periodStart, currentMonthStart, paidAmount, effectiveTier, entries = [] } = params;
  const month = toMonthStart(periodStart);
  const current = toMonthStart(currentMonthStart);

  if (profile.status === 'non_earning' || profile.status === 'inactive' || !effectiveTier) {
    return {
      periodStart: month,
      status: 'exempt',
      expectedMin: 0,
      paidAmount,
      shortfall: 0,
      surplus: 0,
      effectiveTier,
      entries,
    };
  }

  if (month > current) {
    return {
      periodStart: month,
      status: paidAmount > 0 ? 'advance' : 'exempt',
      expectedMin: effectiveTier.minAmount,
      paidAmount,
      shortfall: 0,
      surplus: paidAmount > effectiveTier.minAmount ? paidAmount - effectiveTier.minAmount : 0,
      effectiveTier,
      entries,
    };
  }

  const expectedMin = effectiveTier.minAmount;
  if (paidAmount >= expectedMin) {
    return {
      periodStart: month,
      status: 'met',
      expectedMin,
      paidAmount,
      shortfall: 0,
      surplus: paidAmount - expectedMin,
      effectiveTier,
      entries,
    };
  }

  if (paidAmount > 0) {
    return {
      periodStart: month,
      status: 'short',
      expectedMin,
      paidAmount,
      shortfall: expectedMin - paidAmount,
      surplus: 0,
      effectiveTier,
      entries,
    };
  }

  return {
    periodStart: month,
    status: 'unpaid',
    expectedMin,
    paidAmount: 0,
    shortfall: expectedMin,
    surplus: 0,
    effectiveTier,
    entries,
  };
}

/**
 * Computes the complete 12-month grid row & arrears totals for a member within a fiscal year.
 * Strictly charity contributions only — Zakat is NEVER included here.
 */
export function computeMemberFiscalYearSummary(params: {
  profile: ProfileRow;
  fiscalYear: FiscalYearRow;
  contributions: readonly ContributionRow[];
  memberTiers: readonly MemberTierRow[];
  tiers: readonly TierRow[];
  tierRates: readonly TierRateRow[];
  currentMonthStart?: string;
}): MemberFiscalYearSummary {
  const {
    profile,
    fiscalYear,
    contributions,
    memberTiers,
    tiers,
    tierRates,
    currentMonthStart = getKarachiCurrentMonthStart(),
  } = params;

  const fyMonths = getMonthsForFiscalYear(fiscalYear);

  // Group active (non-voided) charity contributions for this member in this fiscal year by period_start
  const byMonth = new Map<string, ContributionRow[]>();
  for (const c of contributions) {
    if (c.member_id !== profile.id || c.deleted_at) continue;
    if (!isPeriodInFiscalYear(c.period_start, fiscalYear)) continue;
    const key = toMonthStart(c.period_start);
    const list = byMonth.get(key) ?? [];
    list.push(c);
    byMonth.set(key, list);
  }

  let yearlyCharityTotal = 0;
  let expectedTotalToDate = 0;
  let arrearsTotal = 0;
  let metCount = 0;
  let shortCount = 0;
  let unpaidCount = 0;
  let advanceCount = 0;
  let exemptCount = 0;

  const months: MonthComplianceResult[] = fyMonths.map((month) => {
    const entries = byMonth.get(month) ?? [];
    const paidAmount = entries.reduce((sum, item) => sum + item.amount, 0);
    const effectiveTier = resolveEffectiveTierForMonth(
      profile.id,
      month,
      memberTiers,
      tiers,
      tierRates,
    );

    const res = computeMemberMonthCompliance({
      profile,
      periodStart: month,
      currentMonthStart,
      paidAmount,
      effectiveTier,
      entries,
    });

    yearlyCharityTotal += paidAmount;
    if (res.status === 'met' || res.status === 'short' || res.status === 'unpaid') {
      expectedTotalToDate += res.expectedMin;
    }
    arrearsTotal += res.shortfall;

    if (res.status === 'met') metCount += 1;
    else if (res.status === 'short') shortCount += 1;
    else if (res.status === 'unpaid') unpaidCount += 1;
    else if (res.status === 'advance') advanceCount += 1;
    else exemptCount += 1;

    return res;
  });

  const currentMonthCompliance =
    months.find((m) => m.periodStart === toMonthStart(currentMonthStart)) ?? null;
  const isBelowMinimumCurrentCycle =
    currentMonthCompliance?.status === 'short' || currentMonthCompliance?.status === 'unpaid';

  return {
    member: profile,
    fiscalYear,
    months,
    yearlyCharityTotal,
    expectedTotalToDate,
    arrearsTotal,
    metCount,
    shortCount,
    unpaidCount,
    advanceCount,
    exemptCount,
    currentMonthCompliance,
    isBelowMinimumCurrentCycle,
  };
}

/** Computes lifetime non-voided charity total for a member (strictly excluding Zakat). */
export function computeLifetimeCharityTotal(
  memberId: string,
  contributions: readonly ContributionRow[],
): number {
  let total = 0;
  for (const c of contributions) {
    if (c.member_id === memberId && !c.deleted_at) {
      total += c.amount;
    }
  }
  return total;
}
