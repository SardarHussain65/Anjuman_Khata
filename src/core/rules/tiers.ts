import { toMonthStart } from '../dates';
import { MemberTierRow, TierRateRow, TierRow } from '@/data/db/types';

export interface EffectiveTier {
  tierId: string;
  tierCode: string;
  tierName: string;
  tierNameUr: string;
  minAmount: number;
  effectiveFrom: string;
}

/**
 * Resolves the effective tier AND non-retroactive minimum amount in force for a member
 * in a specific calendar month (`periodStart`, YYYY-MM-01).
 *
 * Rules:
 * - Only assignments with `toMonthStart(effective_from) <= periodStart` apply.
 * - Changing a tier's minimum inserts a new `tier_rates` row with `effective_from`;
 *   past months always evaluate against the rate active in that month.
 */
export function resolveEffectiveTierForMonth(
  memberId: string,
  periodStart: string,
  memberTiers: readonly MemberTierRow[],
  tiers: readonly TierRow[],
  tierRates: readonly TierRateRow[],
): EffectiveTier | null {
  const targetMonth = toMonthStart(periodStart);

  const eligibleAssignments = memberTiers
    .filter(
      (mt) =>
        mt.member_id === memberId &&
        !mt.deleted_at &&
        toMonthStart(mt.effective_from) <= targetMonth,
    )
    .sort((a, b) => {
      const cmp = b.effective_from.localeCompare(a.effective_from);
      if (cmp !== 0) return cmp;
      return b.created_at.localeCompare(a.created_at);
    });

  const chosen = eligibleAssignments[0];
  if (!chosen) return null;

  const tier = tiers.find((t) => t.id === chosen.tier_id);
  if (!tier) return null;

  const eligibleRates = tierRates
    .filter(
      (tr) =>
        tr.tier_id === tier.id &&
        !tr.deleted_at &&
        toMonthStart(tr.effective_from) <= targetMonth,
    )
    .sort((a, b) => {
      const cmp = b.effective_from.localeCompare(a.effective_from);
      if (cmp !== 0) return cmp;
      return b.created_at.localeCompare(a.created_at);
    });

  const minAmount = eligibleRates[0]?.min_amount ?? tier.min_amount;

  return {
    tierId: tier.id,
    tierCode: tier.code,
    tierName: tier.name,
    tierNameUr: tier.name_ur,
    minAmount,
    effectiveFrom: chosen.effective_from,
  };
}

/** Returns chronological tier assignment history for a member (newest first). */
export function getMemberTierHistory(
  memberId: string,
  memberTiers: readonly MemberTierRow[],
  tiers: readonly TierRow[],
): (MemberTierRow & { tierName: string; tierNameUr: string; tierCode: string })[] {
  const tierMap = new Map(tiers.map((t) => [t.id, t]));
  return memberTiers
    .filter((mt) => mt.member_id === memberId && !mt.deleted_at)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    .map((mt) => {
      const t = tierMap.get(mt.tier_id);
      return {
        ...mt,
        tierName: t?.name ?? 'Unknown',
        tierNameUr: t?.name_ur ?? '',
        tierCode: t?.code ?? '',
      };
    });
}
