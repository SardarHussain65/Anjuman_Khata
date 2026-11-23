import { resolveEffectiveTierForMonth } from '../tiers';
import {
  computeLifetimeCharityTotal,
  computeMemberFiscalYearSummary,
  computeMemberMonthCompliance,
} from '../compliance';
import {
  computeMemberZakatYearSummary,
  computeNetZakatable,
  computeZakatDue,
  previewZakatCalculation,
} from '../zakat';
import {
  findClosedFiscalYearForDate,
  findClosedFiscalYearForZakat,
  getMonthsForFiscalYear,
} from '../fiscalYear';
import {
  ContributionRow,
  FiscalYearRow,
  MemberTierRow,
  ProfileRow,
  TierRateRow,
  TierRow,
  ZakatAssessmentRow,
  ZakatPaymentRow,
} from '@/data/db/types';

const BASE_META = {
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  updated_by: null,
  version: 1,
};

const TIER_SMALL: TierRow = {
  ...BASE_META,
  id: 'tier-small',
  code: 'small_business',
  name: 'Small Business',
  name_ur: 'چھوٹا کاروبار',
  min_amount: 200,
  is_active: true,
};

const TIER_EST: TierRow = {
  ...BASE_META,
  id: 'tier-est',
  code: 'established_business',
  name: 'Established Business',
  name_ur: 'بڑا کاروبار',
  min_amount: 500,
  is_active: true,
};

const FY_2026: FiscalYearRow = {
  ...BASE_META,
  id: 'fy-2026',
  label: '2026',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  status: 'open',
  closed_by: null,
  closed_at: null,
  reopen_reason: null,
};

const FY_2025_CLOSED: FiscalYearRow = {
  ...BASE_META,
  id: 'fy-2025',
  label: '2025',
  start_date: '2025-01-01',
  end_date: '2025-12-31',
  status: 'closed',
  closed_by: 'admin-1',
  closed_at: '2026-01-02T00:00:00Z',
  reopen_reason: null,
};

const ACTIVE_MEMBER: ProfileRow = {
  ...BASE_META,
  id: 'm1',
  member_no: 1,
  full_name: 'Tariq Mehmood',
  full_name_ur: 'طارق محمود',
  phone: '03001234567',
  designation: 'Engineer',
  tag: 'Founder',
  status: 'active',
  role: 'user',
  personal_pledge: null,
  joined_on: '2026-01-01',
  notes: null,
};

const NON_EARNING_MEMBER: ProfileRow = {
  ...ACTIVE_MEMBER,
  id: 'm2',
  member_no: 2,
  full_name: 'Bilal Student',
  status: 'non_earning',
};

describe('Tier rules & non-retroactive minimums', () => {
  it('never retroactively changes past compliance when tier minimum or tier assignment changes', () => {
    const tierRates: TierRateRow[] = [
      { ...BASE_META, id: 'r1', tier_id: 'tier-small', min_amount: 200, effective_from: '1900-01-01' },
      { ...BASE_META, id: 'r2', tier_id: 'tier-small', min_amount: 300, effective_from: '2026-04-01' },
      { ...BASE_META, id: 'r3', tier_id: 'tier-est', min_amount: 500, effective_from: '1900-01-01' },
    ];
    const memberTiers: MemberTierRow[] = [
      { ...BASE_META, id: 'mt1', member_id: 'm1', tier_id: 'tier-small', effective_from: '2026-01-01', reason: 'Start' },
      { ...BASE_META, id: 'mt2', member_id: 'm1', tier_id: 'tier-est', effective_from: '2026-06-01', reason: 'Promotion' },
    ];

    expect(resolveEffectiveTierForMonth('m1', '2026-01-01', memberTiers, [TIER_SMALL, TIER_EST], tierRates)?.minAmount).toBe(200);
    expect(resolveEffectiveTierForMonth('m1', '2026-04-01', memberTiers, [TIER_SMALL, TIER_EST], tierRates)?.minAmount).toBe(300);
    expect(resolveEffectiveTierForMonth('m1', '2026-06-01', memberTiers, [TIER_SMALL, TIER_EST], tierRates)?.minAmount).toBe(500);
  });
});

describe('Compliance, surplus, non_earning exemption & effective_from arrears', () => {
  it('exempts non_earning members even with zero payments, while recording voluntary payments', () => {
    const contributions: ContributionRow[] = [
      {
        ...BASE_META,
        id: 'c-vol',
        member_id: 'm2',
        amount: 100,
        period_start: '2026-02-01',
        kind: 'special',
        paid_on: '2026-02-10',
        collected_by: 'admin-1',
        remark: 'Voluntary',
        void_reason: null,
        client_created_at: null,
      },
    ];
    const summary = computeMemberFiscalYearSummary({
      profile: NON_EARNING_MEMBER,
      fiscalYear: FY_2026,
      contributions,
      memberTiers: [],
      tiers: [TIER_SMALL, TIER_EST],
      tierRates: [],
      currentMonthStart: '2026-06-01',
    });

    expect(summary.arrearsTotal).toBe(0);
    expect(summary.shortCount).toBe(0);
    expect(summary.unpaidCount).toBe(0);
    expect(summary.exemptCount).toBe(12);
    expect(summary.yearlyCharityTotal).toBe(100);
    expect(summary.isBelowMinimumCurrentCycle).toBe(false);
  });

  it('starts arrears only from effective_from and does not auto-carry surplus to other months', () => {
    // Member activated in March 2026 with tier-small (200)
    const memberTiers: MemberTierRow[] = [
      { ...BASE_META, id: 'mt-mar', member_id: 'm1', tier_id: 'tier-small', effective_from: '2026-03-01', reason: 'Activated' },
    ];
    const contributions: ContributionRow[] = [
      // Paid generous 1000 in March (800 surplus stays on March, does NOT cover April!)
      {
        ...BASE_META,
        id: 'c1',
        member_id: 'm1',
        amount: 1000,
        period_start: '2026-03-01',
        kind: 'monthly',
        paid_on: '2026-03-05',
        collected_by: 'admin-1',
        remark: null,
        void_reason: null,
        client_created_at: null,
      },
      // Paid 100 in April -> short by 100
      {
        ...BASE_META,
        id: 'c2',
        member_id: 'm1',
        amount: 100,
        period_start: '2026-04-01',
        kind: 'monthly',
        paid_on: '2026-04-05',
        collected_by: 'admin-1',
        remark: null,
        void_reason: null,
        client_created_at: null,
      },
      // Paid 200 in advance for July
      {
        ...BASE_META,
        id: 'c3',
        member_id: 'm1',
        amount: 200,
        period_start: '2026-07-01',
        kind: 'advance',
        paid_on: '2026-05-01',
        collected_by: 'admin-1',
        remark: null,
        void_reason: null,
        client_created_at: null,
      },
      // Voided payment in May must be ignored!
      {
        ...BASE_META,
        id: 'c4',
        member_id: 'm1',
        amount: 500,
        period_start: '2026-05-01',
        kind: 'monthly',
        paid_on: '2026-05-02',
        collected_by: 'admin-1',
        remark: null,
        void_reason: 'Mistake',
        deleted_at: '2026-05-03T00:00:00Z',
        client_created_at: null,
      },
    ];

    const summary = computeMemberFiscalYearSummary({
      profile: ACTIVE_MEMBER,
      fiscalYear: FY_2026,
      contributions,
      memberTiers,
      tiers: [TIER_SMALL],
      tierRates: [],
      currentMonthStart: '2026-05-01',
    });

    const byMonth = Object.fromEntries(summary.months.map((m) => [m.periodStart, m]));
    // Jan & Feb before effective_from -> exempt!
    expect(byMonth['2026-01-01'].status).toBe('exempt');
    expect(byMonth['2026-02-01'].status).toBe('exempt');
    // March -> met with 800 surplus
    expect(byMonth['2026-03-01'].status).toBe('met');
    expect(byMonth['2026-03-01'].surplus).toBe(800);
    // April -> short by 100 (March surplus did NOT auto-carry!)
    expect(byMonth['2026-04-01'].status).toBe('short');
    expect(byMonth['2026-04-01'].shortfall).toBe(100);
    // May -> unpaid (voided entry ignored), shortfall 200
    expect(byMonth['2026-05-01'].status).toBe('unpaid');
    expect(byMonth['2026-05-01'].shortfall).toBe(200);
    // July (future month) -> advance
    expect(byMonth['2026-07-01'].status).toBe('advance');
    // Total arrears = 100 (Apr) + 200 (May) = 300
    expect(summary.arrearsTotal).toBe(300);
    expect(summary.yearlyCharityTotal).toBe(1300);
    expect(computeLifetimeCharityTotal('m1', contributions)).toBe(1300);
  });

  it('handles inactive members as exempt', () => {
    const res = computeMemberMonthCompliance({
      profile: { status: 'inactive' },
      periodStart: '2026-03-01',
      currentMonthStart: '2026-05-01',
      paidAmount: 0,
      effectiveTier: {
        tierId: 'tier-small',
        tierCode: 'small_business',
        tierName: 'Small Business',
        tierNameUr: '',
        minAmount: 200,
        effectiveFrom: '2026-01-01',
      },
    });
    expect(res.status).toBe('exempt');
    expect(res.shortfall).toBe(0);
  });
});

describe('Zakat integer math & strict separation from charity', () => {
  it('returns 0 below nisab and exact integer half-up 2.5% at or above nisab', () => {
    expect(computeZakatDue(179_999, 180_000, 250)).toBe(0);
    expect(computeZakatDue(180_000, 180_000, 250)).toBe(4_500);
    // 200,020 * 250 / 10000 = 5000.5 -> rounds half-up to 5001
    expect(computeZakatDue(200_020, 180_000, 250)).toBe(5_001);
    // 200,019 * 250 / 10000 = 5000.475 -> rounds down to 5000
    expect(computeZakatDue(200_019, 180_000, 250)).toBe(5_000);
  });

  it('computes net zakatable, preview, and separate zakat balance cleanly', () => {
    const preview = previewZakatCalculation({
      assets: { cash: 300_000, gold: 250_000, silver: 0, business_inventory: 50_000 },
      liabilities: 50_000,
      nisabAmount: 180_000,
      rateBps: 250,
    });
    expect(computeNetZakatable({ cash: 10_000 }, 50_000)).toBe(0);
    expect(preview.assetsTotal).toBe(600_000);
    expect(preview.netZakatable).toBe(550_000);
    expect(preview.meetsNisab).toBe(true);
    expect(preview.dueAmount).toBe(13_750);

    const assessments: ZakatAssessmentRow[] = [
      {
        ...BASE_META,
        id: 'za-1',
        member_id: 'm1',
        year: 2026,
        assets: { cash: 600_000 },
        liabilities: 50_000,
        net_zakatable: 550_000,
        nisab_used: 180_000,
        rate_bps: 250,
        due_amount: 13_750,
        assessed_by: 'admin-1',
        notes: null,
      },
    ];
    const payments: ZakatPaymentRow[] = [
      {
        ...BASE_META,
        id: 'zp-1',
        member_id: 'm1',
        assessment_id: 'za-1',
        year: 2026,
        amount: 5_000,
        paid_on: '2026-03-15',
        collected_by: 'admin-1',
        remark: 'Installment 1',
        void_reason: null,
      },
    ];

    const summary = computeMemberZakatYearSummary('m1', 2026, assessments, payments);
    expect(summary.dueAmount).toBe(13_750);
    expect(summary.paidAmount).toBe(5_000);
    expect(summary.balance).toBe(8_750);
  });
});

describe('Fiscal year helpers', () => {
  it('detects closed fiscal years for charity periods and Zakat payments', () => {
    expect(getMonthsForFiscalYear(FY_2026)).toHaveLength(12);
    expect(findClosedFiscalYearForDate('2025-06-01', [FY_2025_CLOSED, FY_2026])?.label).toBe('2025');
    expect(findClosedFiscalYearForDate('2026-06-01', [FY_2025_CLOSED, FY_2026])).toBeNull();
    expect(findClosedFiscalYearForZakat(2025, '2026-01-15', [FY_2025_CLOSED, FY_2026])?.label).toBe('2025');
  });
});
