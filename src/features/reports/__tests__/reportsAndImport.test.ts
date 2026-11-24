import {
  buildAnnualLedgerHtml,
  buildFinancialSummaryHtml,
  buildLedgerCsv,
  buildMemberStatementHtml,
  buildUnpaidShortListHtml,
  buildZakatReportHtml,
} from '../templates/reportTemplates';
import {
  buildAnnualLedgerPdfBytes,
  buildFinancialSummaryPdfBytes,
  buildMemberStatementPdfBytes,
  buildUnpaidShortListPdfBytes,
  buildZakatReportPdfBytes,
} from '../pdfBuilder';
import { parseRegisterCsv } from '../csvImportParser';
import { computeMemberFiscalYearSummary } from '@/core/rules/compliance';
import {
  ContributionRow,
  FiscalYearRow,
  MemberTierRow,
  OrgSettingsRow,
  ProfileRow,
  TierRow,
  ZakatAssessmentRow,
  ZakatPaymentRow,
  ZakatSettingRow,
} from '@/data/db/types';

const META = {
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  updated_by: null,
  version: 1,
};

const ORG: OrgSettingsRow = {
  ...META,
  id: 'org-1',
  org_name: 'Anjuman Khata',
  org_name_ur: 'انجمن کھاتہ',
  logo: null,
  fiscal_year_start_month: 1,
  cycle: 'monthly',
  currency: 'PKR',
  grace_days: 0,
};

const FY: FiscalYearRow = {
  ...META,
  id: 'fy-2026',
  label: '2026',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  status: 'open',
  closed_by: null,
  closed_at: null,
  reopen_reason: null,
};

const TIER: TierRow = {
  ...META,
  id: 't1',
  code: 'established_business',
  name: 'Established Business',
  name_ur: 'بڑا کاروبار',
  min_amount: 500,
  is_active: true,
};

const MEMBER: ProfileRow = {
  ...META,
  id: 'm1',
  member_no: 1,
  full_name: 'Tariq Mehmood',
  full_name_ur: 'طارق محمود',
  phone: '0300-1112223',
  designation: 'Engineer',
  tag: 'Committee',
  status: 'active',
  role: 'user',
  personal_pledge: null,
  joined_on: '2026-01-01',
  notes: null,
};

const MEMBER_TIERS: MemberTierRow[] = [
  { ...META, id: 'mt1', member_id: 'm1', tier_id: 't1', effective_from: '2026-01-01', reason: 'Init' },
];

const CONTRIBUTIONS: ContributionRow[] = [
  {
    ...META,
    id: 'c1',
    member_id: 'm1',
    amount: 500,
    period_start: '2026-01-01',
    kind: 'monthly',
    paid_on: '2026-01-04',
    collected_by: 'admin',
    remark: 'Cash',
    void_reason: null,
    client_created_at: null,
  },
];

const ZAKAT_SETTING: ZakatSettingRow = {
  ...META,
  id: 'zs1',
  year: 2026,
  nisab_amount: 180_000,
  rate_bps: 250,
  basis_note: 'Silver basis',
  per_person_amount: 300,
};

const ZAKAT_ASSESSMENTS: ZakatAssessmentRow[] = [
  {
    ...META,
    id: 'za1',
    member_id: 'm1',
    year: 2026,
    assets: { cash: 400_000 },
    liabilities: 0,
    net_zakatable: 400_000,
    nisab_used: 180_000,
    rate_bps: 250,
    due_amount: 10_000,
    assessed_by: 'admin',
    notes: null,
  },
];

const ZAKAT_PAYMENTS: ZakatPaymentRow[] = [
  {
    ...META,
    id: 'zp1',
    member_id: 'm1',
    zakat_member_id: null,
    family_count_snapshot: null,
    assessment_id: 'za1',
    year: 2026,
    amount: 4_000,
    paid_on: '2026-03-01',
    collected_by: 'admin',
    remark: null,
    void_reason: null,
  },
];

describe('Offline PDF HTML templates (EN + Urdu RTL) & CSV export', () => {
  const summaries = [
    computeMemberFiscalYearSummary({
      profile: MEMBER,
      fiscalYear: FY,
      contributions: CONTRIBUTIONS,
      memberTiers: MEMBER_TIERS,
      tiers: [TIER],
      tierRates: [],
      currentMonthStart: '2026-02-01',
    }),
  ];

  it('generates landscape Urdu RTL annual ledger with embedded base64 font & unsynced warning', () => {
    const html = buildAnnualLedgerHtml({
      orgSettings: ORG,
      lang: 'ur',
      pendingSyncCount: 3,
      urduFontBase64: 'FAKEBASE64FONT',
      fiscalYear: FY,
      summaries,
    });
    expect(html).toContain('<html lang="ur" dir="rtl">');
    expect(html).toContain('size: A4 landscape');
    expect(html).toContain('data:font/ttf;base64,FAKEBASE64FONT');
    expect(html).toContain('انجمن کھاتہ');
    expect(html).toContain('طارق محمود');
    expect(html).toContain('3 غیر ہم آہنگ');
  });

  it('generates all 4 portrait reports keeping Zakat strictly separate from charity', () => {
    const summaryHtml = buildFinancialSummaryHtml({
      orgSettings: ORG,
      lang: 'en',
      pendingSyncCount: 0,
      fiscalYear: FY,
      summaries,
      zakatYear: 2026,
      zakatDueTotal: 10_000,
      zakatPaidTotal: 4_000,
    });
    expect(summaryHtml).toContain('Charity Collected');
    expect(summaryHtml).toContain('Rs 500');
    expect(summaryHtml).toContain('Strictly Separate from Charity');
    expect(summaryHtml).toContain('Rs 4,000');

    const statementHtml = buildMemberStatementHtml({
      orgSettings: ORG,
      lang: 'en',
      pendingSyncCount: 1,
      member: MEMBER,
      fiscalYear: FY,
      contributions: CONTRIBUTIONS,
      memberTiers: MEMBER_TIERS,
      tiers: [TIER],
      tierRates: [],
      zakatAssessments: ZAKAT_ASSESSMENTS,
      zakatPayments: ZAKAT_PAYMENTS,
      zakatYear: 2026,
      currentMonthStart: '2026-02-01',
    });
    expect(statementHtml).toContain('Member Statement');
    expect(statementHtml).toContain('Includes 1 unsynced local change');
    expect(statementHtml).toContain('Rs 6,000'); // Zakat balance = 10000 - 4000

    const zakatHtml = buildZakatReportHtml({
      orgSettings: ORG,
      lang: 'en',
      pendingSyncCount: 0,
      year: 2026,
      setting: ZAKAT_SETTING,
      profiles: [MEMBER],
      assessments: ZAKAT_ASSESSMENTS,
      payments: ZAKAT_PAYMENTS,
    });
    expect(zakatHtml).toContain('Zakat Report — 2026');
    expect(zakatHtml).toContain('Annual Ramazan Zakat Register');
    expect(zakatHtml).toContain('Rs 300');

    const unpaidHtml = buildUnpaidShortListHtml({
      orgSettings: ORG,
      lang: 'en',
      pendingSyncCount: 0,
      fiscalYear: FY,
      summaries,
      currentMonthStart: '2026-02-01',
    });
    expect(unpaidHtml).toContain('Unpaid &amp; Short Members');
    expect(unpaidHtml).toContain('Tariq Mehmood');
  });

  it('exports UTF-8 BOM CSV with exact row totals', () => {
    const csv = buildLedgerCsv(FY, summaries);
    expect(csv.startsWith('\uFEFFmember_no,name')).toBe(true);
    expect(csv).toContain('1,Tariq Mehmood,طارق محمود,Engineer,active,Committee,500,0,0,0,0,0,0,0,0,0,0,0,500,500');
  });

  it('generates real binary %PDF-1.7 files for all 5 reports completely offline (pure JS, no WebView)', async () => {
    const headerOf = (bytes: Uint8Array) =>
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);

    const ledgerPdf = await buildAnnualLedgerPdfBytes({
      orgSettings: ORG,
      pendingSyncCount: 2,
      fiscalYear: FY,
      summaries,
    });
    expect(headerOf(ledgerPdf)).toBe('%PDF-');
    expect(ledgerPdf.length).toBeGreaterThan(1000);

    const summaryPdf = await buildFinancialSummaryPdfBytes({
      orgSettings: ORG,
      pendingSyncCount: 0,
      fiscalYear: FY,
      summaries,
      zakatYear: 2026,
      zakatDueTotal: 10_000,
      zakatPaidTotal: 4_000,
    });
    expect(headerOf(summaryPdf)).toBe('%PDF-');
    expect(summaryPdf.length).toBeGreaterThan(1000);

    const statementPdf = await buildMemberStatementPdfBytes({
      orgSettings: ORG,
      pendingSyncCount: 0,
      member: MEMBER,
      fiscalYear: FY,
      contributions: CONTRIBUTIONS,
      memberTiers: MEMBER_TIERS,
      tiers: [TIER],
      tierRates: [],
      zakatAssessments: ZAKAT_ASSESSMENTS,
      zakatPayments: ZAKAT_PAYMENTS,
      zakatYear: 2026,
      currentMonthStart: '2026-02-01',
    });
    expect(headerOf(statementPdf)).toBe('%PDF-');
    expect(statementPdf.length).toBeGreaterThan(1000);

    const zakatPdf = await buildZakatReportPdfBytes({
      orgSettings: ORG,
      pendingSyncCount: 0,
      year: 2026,
      setting: ZAKAT_SETTING,
      profiles: [MEMBER],
      assessments: ZAKAT_ASSESSMENTS,
      payments: ZAKAT_PAYMENTS,
    });
    expect(headerOf(zakatPdf)).toBe('%PDF-');
    expect(zakatPdf.length).toBeGreaterThan(1000);

    const unpaidPdf = await buildUnpaidShortListPdfBytes({
      orgSettings: ORG,
      pendingSyncCount: 0,
      fiscalYear: FY,
      summaries,
      currentMonthStart: '2026-02-01',
    });
    expect(headerOf(unpaidPdf)).toBe('%PDF-');
    expect(unpaidPdf.length).toBeGreaterThan(1000);
  });
});

describe('Paper-register CSV importer (scripts/import-ledger.ts)', () => {
  it('reproduces exact per-member yearly totals, separates Zakat, and detects non_earning rows', () => {
    const sampleCsv = [
      'member_no,name,designation,tier,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec,zakat,remarks',
      '1,Tariq Mehmood,Engineer,established_business,500,500,500,500,500,1000,500,500,500,500,500,500,12500,Voluntary 1000 in June',
      '2,Kamran Ali,Teacher,small_business,200,200,200,200,200,200,200,200,200,200,200,200,0,Regular',
      '3,Bilal Ahmed,Student,,,,,,,,,,,,,,,0,Unemployed',
    ].join('\n');

    const parsed = parseRegisterCsv(sampleCsv, 2026);
    expect(parsed.members).toHaveLength(3);
    expect(parsed.members[0].yearly_charity_total).toBe(6500);
    expect(parsed.members[0].zakat_amount).toBe(12500);
    expect(parsed.members[0].monthly_contributions).toHaveLength(12);

    expect(parsed.members[1].yearly_charity_total).toBe(2400);
    expect(parsed.members[2].status).toBe('non_earning');
    expect(parsed.members[2].yearly_charity_total).toBe(0);

    // Total charity strictly excludes Zakat!
    expect(parsed.totalCharity).toBe(8900);
    expect(parsed.totalZakat).toBe(12500);
  });
});
