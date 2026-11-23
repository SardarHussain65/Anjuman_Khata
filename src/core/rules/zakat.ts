import { assertIntegerPKR } from '../money';
import {
  ZakatAssessmentRow,
  ZakatAssetsBreakdown,
  ZakatPaymentRow,
} from '@/data/db/types';

export const DEFAULT_ZAKAT_ASSET_CATEGORIES = [
  'cash',
  'gold',
  'silver',
  'business_inventory',
  'receivables',
  'other',
] as const;

export type ZakatAssetCategory = (typeof DEFAULT_ZAKAT_ASSET_CATEGORIES)[number];

/** Sums all eligible asset categories using strict non-negative integer PKR validation. */
export function sumZakatAssets(assets: ZakatAssetsBreakdown): number {
  let total = 0n;
  for (const [key, rawVal] of Object.entries(assets)) {
    if (rawVal == null) continue;
    const val = assertIntegerPKR(rawVal, `assets.${key}`);
    if (val < 0) {
      throw new Error(`assets.${key} cannot be negative`);
    }
    total += BigInt(val);
  }
  return Number(total);
}

/** Computes net_zakatable = max(0, eligible_assets_total - deductible_liabilities). */
export function computeNetZakatable(
  assets: ZakatAssetsBreakdown,
  liabilities: number,
): number {
  const validLiabilities = assertIntegerPKR(liabilities, 'liabilities');
  if (validLiabilities < 0) {
    throw new Error('liabilities cannot be negative');
  }
  const assetsTotal = sumZakatAssets(assets);
  return Math.max(0, assetsTotal - validLiabilities);
}

/**
 * Exact integer Zakat calculation matching Postgres `public.compute_zakat_due`.
 * Formula: if net_zakatable < nisab_amount -> 0, else floor((net * rate_bps + 5000) / 10000).
 * Uses BigInt to guarantee zero floating-point inaccuracy at any PKR scale.
 */
export function computeZakatDue(
  netZakatable: number,
  nisabAmount: number,
  rateBps: number,
): number {
  const net = assertIntegerPKR(netZakatable, 'netZakatable');
  const nisab = assertIntegerPKR(nisabAmount, 'nisabAmount');
  const rate = assertIntegerPKR(rateBps, 'rateBps');

  if (nisab < 0) throw new Error('nisabAmount cannot be negative');
  if (rate <= 0 || rate > 10000) throw new Error('rateBps must be between 1 and 10000');
  if (net <= 0 || net < nisab) return 0;

  const due = (BigInt(net) * BigInt(rate) + 5000n) / 10000n;
  return Number(due);
}

export interface ZakatCalculationPreview {
  assetsTotal: number;
  liabilities: number;
  netZakatable: number;
  nisabAmount: number;
  rateBps: number;
  meetsNisab: boolean;
  dueAmount: number;
}

export function previewZakatCalculation(params: {
  assets: ZakatAssetsBreakdown;
  liabilities: number;
  nisabAmount: number;
  rateBps: number;
}): ZakatCalculationPreview {
  const assetsTotal = sumZakatAssets(params.assets);
  const netZakatable = computeNetZakatable(params.assets, params.liabilities);
  const meetsNisab = netZakatable > 0 && netZakatable >= params.nisabAmount;
  const dueAmount = computeZakatDue(netZakatable, params.nisabAmount, params.rateBps);
  return {
    assetsTotal,
    liabilities: params.liabilities,
    netZakatable,
    nisabAmount: params.nisabAmount,
    rateBps: params.rateBps,
    meetsNisab,
    dueAmount,
  };
}

export interface MemberZakatYearSummary {
  memberId: string;
  year: number;
  dueAmount: number;
  paidAmount: number;
  balance: number;
  assessments: ZakatAssessmentRow[];
  payments: ZakatPaymentRow[];
}

/**
 * Computes a member's Zakat due, paid, and remaining balance for a given year.
 * Strictly isolated from regular charity contributions.
 */
export function computeMemberZakatYearSummary(
  memberId: string,
  year: number,
  assessments: readonly ZakatAssessmentRow[],
  payments: readonly ZakatPaymentRow[],
): MemberZakatYearSummary {
  const memberAssessments = assessments
    .filter((a) => a.member_id === memberId && a.year === year && !a.deleted_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const memberPayments = payments
    .filter((p) => p.member_id === memberId && p.year === year && !p.deleted_at)
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on));

  const dueAmount = memberAssessments.reduce((sum, a) => sum + a.due_amount, 0);
  const paidAmount = memberPayments.reduce((sum, p) => sum + p.amount, 0);

  return {
    memberId,
    year,
    dueAmount,
    paidAmount,
    balance: dueAmount - paidAmount,
    assessments: memberAssessments,
    payments: memberPayments,
  };
}
