import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { formatPKR } from '@/core/money';
import { formatDateShort, formatKarachiDateTime, formatMonthShort, formatMonthYear } from '@/core/dates';
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
} from '@/data/db/types';
import { computeMemberFiscalYearSummary, MemberFiscalYearSummary } from '@/core/rules/compliance';
import { getMonthsForFiscalYear } from '@/core/rules/fiscalYear';
import { getMemberTierHistory } from '@/core/rules/tiers';
import { computeMemberZakatYearSummary, computeZakatMemberYearSummary } from '@/core/rules/zakat';

const EMERALD = rgb(0.05, 0.31, 0.24);
const EMERALD_SOFT = rgb(0.91, 0.96, 0.94);
const GOLD = rgb(0.72, 0.47, 0.12);
const GOLD_SOFT = rgb(0.99, 0.96, 0.90);
const INK = rgb(0.09, 0.14, 0.12);
const MUTED = rgb(0.38, 0.44, 0.41);
const BORDER = rgb(0.82, 0.84, 0.82);
const ROW_ALT = rgb(0.97, 0.98, 0.97);
const WHITE = rgb(1, 1, 1);
const DANGER = rgb(0.73, 0.11, 0.11);
const SUCCESS = rgb(0.08, 0.50, 0.24);

/**
 * Standard PDF Helvetica font uses WinAnsi encoding.
 * Convert common typographic symbols and strip any non-WinAnsi chars so drawText never throws.
 */
export function sanitizePdfText(raw: string | number | null | undefined, maxLen = 80): string {
  if (raw == null) return '';
  const cleaned = String(raw)
    .replace(/[—–]/g, '-')
    .replace(/→/g, '->')
    .replace(/·/g, '|')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxLen - 3))}...`;
}

interface PdfColumn {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

class ReportPdfWriter {
  private doc!: PDFDocument;
  private font!: PDFFont;
  private bold!: PDFFont;
  private page!: PDFPage;
  private pageWidth: number;
  private pageHeight: number;
  private margin = 32;
  private cursorY = 0;
  private accent: 'charity' | 'zakat';
  private orgName: string;
  private title: string;
  private subtitle: string;
  private pendingSyncCount: number;
  private generatedStr: string;

  constructor(opts: {
    landscape?: boolean;
    accent?: 'charity' | 'zakat';
    orgSettings: OrgSettingsRow | null;
    title: string;
    subtitle?: string;
    pendingSyncCount: number;
    generatedAt?: Date;
  }) {
    this.pageWidth = opts.landscape ? 841.89 : 595.28;
    this.pageHeight = opts.landscape ? 595.28 : 841.89;
    this.accent = opts.accent ?? 'charity';
    this.orgName = sanitizePdfText(opts.orgSettings?.org_name ?? 'Anjuman Khata', 60) || 'Anjuman Khata';
    this.title = sanitizePdfText(opts.title, 90);
    this.subtitle = sanitizePdfText(opts.subtitle ?? '', 100);
    this.pendingSyncCount = opts.pendingSyncCount;
    this.generatedStr = sanitizePdfText(formatKarachiDateTime(opts.generatedAt ?? new Date()), 50);
  }

  get contentWidth(): number {
    return this.pageWidth - this.margin * 2;
  }

  async init(): Promise<void> {
    this.doc = await PDFDocument.create();
    this.doc.setTitle(this.title);
    this.doc.setCreator(this.orgName);
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.addPage(true);
  }

  private get accentColor() {
    return this.accent === 'zakat' ? GOLD : EMERALD;
  }

  private get accentSoft() {
    return this.accent === 'zakat' ? GOLD_SOFT : EMERALD_SOFT;
  }

  addPage(withFullHeader = false): void {
    this.page = this.doc.addPage([this.pageWidth, this.pageHeight]);
    this.cursorY = this.pageHeight - this.margin;

    if (withFullHeader) {
      const bannerH = this.subtitle ? 58 : 46;
      this.page.drawRectangle({
        x: this.margin,
        y: this.cursorY - bannerH,
        width: this.contentWidth,
        height: bannerH,
        color: this.accentColor,
      });

      this.page.drawText(this.orgName, {
        x: this.margin + 14,
        y: this.cursorY - 20,
        size: 14,
        font: this.bold,
        color: WHITE,
      });
      this.page.drawText(this.title, {
        x: this.margin + 14,
        y: this.cursorY - 36,
        size: 10.5,
        font: this.bold,
        color: rgb(0.95, 0.97, 0.96),
      });
      if (this.subtitle) {
        this.page.drawText(this.subtitle, {
          x: this.margin + 14,
          y: this.cursorY - 50,
          size: 8.5,
          font: this.font,
          color: rgb(0.86, 0.92, 0.89),
        });
      }

      const genLabel = `Generated: ${this.generatedStr}`;
      const genW = this.font.widthOfTextAtSize(genLabel, 8);
      this.page.drawText(genLabel, {
        x: this.margin + this.contentWidth - genW - 12,
        y: this.cursorY - 20,
        size: 8,
        font: this.font,
        color: rgb(0.90, 0.95, 0.93),
      });

      this.cursorY -= bannerH + 14;

      if (this.pendingSyncCount > 0) {
        const warnText = `Note: Includes ${this.pendingSyncCount} unsynced local change(s).`;
        this.page.drawText(warnText, {
          x: this.margin,
          y: this.cursorY,
          size: 8.5,
          font: this.bold,
          color: GOLD,
        });
        this.cursorY -= 14;
      }
    } else {
      this.page.drawText(`${this.orgName} - ${this.title}`, {
        x: this.margin,
        y: this.cursorY - 10,
        size: 9,
        font: this.bold,
        color: this.accentColor,
      });
      this.cursorY -= 22;
    }
  }

  ensureSpace(neededHeight: number): void {
    if (this.cursorY - neededHeight < this.margin + 20) {
      this.addPage(false);
    }
  }

  drawSectionTitle(text: string): void {
    this.ensureSpace(26);
    this.cursorY -= 4;
    this.page.drawText(sanitizePdfText(text, 80), {
      x: this.margin,
      y: this.cursorY - 12,
      size: 11,
      font: this.bold,
      color: this.accentColor,
    });
    this.cursorY -= 20;
  }

  drawStatCards(cards: { label: string; value: string; tone?: 'normal' | 'danger' | 'success' }[], accentOverride?: 'charity' | 'zakat'): void {
    const boxH = 44;
    this.ensureSpace(boxH + 12);
    const gap = 8;
    const cardW = (this.contentWidth - gap * (cards.length - 1)) / cards.length;
    const bg = accentOverride === 'zakat' ? GOLD_SOFT : accentOverride === 'charity' ? EMERALD_SOFT : this.accentSoft;
    const borderCol = accentOverride === 'zakat' ? GOLD : BORDER;

    cards.forEach((card, idx) => {
      const x = this.margin + idx * (cardW + gap);
      const y = this.cursorY - boxH;
      this.page.drawRectangle({
        x,
        y,
        width: cardW,
        height: boxH,
        color: bg,
        borderColor: borderCol,
        borderWidth: 0.75,
      });
      this.page.drawText(sanitizePdfText(card.label, 30), {
        x: x + 8,
        y: y + boxH - 15,
        size: 8,
        font: this.font,
        color: MUTED,
      });
      const valColor = card.tone === 'danger' ? DANGER : card.tone === 'success' ? SUCCESS : INK;
      this.page.drawText(sanitizePdfText(card.value, 28), {
        x: x + 8,
        y: y + 10,
        size: 12,
        font: this.bold,
        color: valColor,
      });
    });

    this.cursorY -= boxH + 14;
  }

  drawNoteBox(text: string): void {
    const safe = sanitizePdfText(text, 160);
    if (!safe) return;
    this.ensureSpace(32);
    const boxH = 26;
    const y = this.cursorY - boxH;
    this.page.drawRectangle({
      x: this.margin,
      y,
      width: this.contentWidth,
      height: boxH,
      color: ROW_ALT,
      borderColor: BORDER,
      borderWidth: 0.6,
    });
    this.page.drawText(safe, {
      x: this.margin + 10,
      y: y + 9,
      size: 8.5,
      font: this.font,
      color: MUTED,
    });
    this.cursorY -= boxH + 10;
  }

  drawTable(
    columns: PdfColumn[],
    rows: string[][],
    options?: { fontSize?: number; footerRow?: string[] },
  ): void {
    const fontSize = options?.fontSize ?? 8.5;
    const rowH = fontSize + 10;
    const headerH = fontSize + 12;

    const drawHeader = () => {
      this.ensureSpace(headerH + rowH);
      const y = this.cursorY - headerH;
      this.page.drawRectangle({
        x: this.margin,
        y,
        width: this.contentWidth,
        height: headerH,
        color: this.accentSoft,
        borderColor: BORDER,
        borderWidth: 0.6,
      });
      let x = this.margin;
      for (const col of columns) {
        const label = this.fitText(col.header, col.width - 6, fontSize, this.bold);
        const tw = this.bold.widthOfTextAtSize(label, fontSize);
        const tx = col.align === 'right' ? x + col.width - tw - 4 : x + 4;
        this.page.drawText(label, {
          x: tx,
          y: y + (headerH - fontSize) / 2 + 1,
          size: fontSize,
          font: this.bold,
          color: INK,
        });
        x += col.width;
      }
      this.cursorY -= headerH;
    };

    drawHeader();

    rows.forEach((cells, rowIdx) => {
      if (this.cursorY - rowH < this.margin + 22) {
        this.addPage(false);
        drawHeader();
      }
      const y = this.cursorY - rowH;
      this.page.drawRectangle({
        x: this.margin,
        y,
        width: this.contentWidth,
        height: rowH,
        color: rowIdx % 2 === 1 ? ROW_ALT : WHITE,
        borderColor: BORDER,
        borderWidth: 0.4,
      });

      let x = this.margin;
      columns.forEach((col, colIdx) => {
        const raw = cells[colIdx] ?? '';
        const text = this.fitText(raw, col.width - 6, fontSize, this.font);
        const tw = this.font.widthOfTextAtSize(text, fontSize);
        const tx = col.align === 'right' ? x + col.width - tw - 4 : x + 4;
        this.page.drawText(text, {
          x: tx,
          y: y + (rowH - fontSize) / 2 + 1,
          size: fontSize,
          font: this.font,
          color: INK,
        });
        x += col.width;
      });
      this.cursorY -= rowH;
    });

    if (options?.footerRow) {
      if (this.cursorY - headerH < this.margin + 20) {
        this.addPage(false);
      }
      const y = this.cursorY - headerH;
      this.page.drawRectangle({
        x: this.margin,
        y,
        width: this.contentWidth,
        height: headerH,
        color: this.accentSoft,
        borderColor: this.accentColor,
        borderWidth: 0.75,
      });
      let x = this.margin;
      columns.forEach((col, colIdx) => {
        const raw = options.footerRow?.[colIdx] ?? '';
        const text = this.fitText(raw, col.width - 6, fontSize, this.bold);
        const tw = this.bold.widthOfTextAtSize(text, fontSize);
        const tx = col.align === 'right' ? x + col.width - tw - 4 : x + 4;
        this.page.drawText(text, {
          x: tx,
          y: y + (headerH - fontSize) / 2 + 1,
          size: fontSize,
          font: this.bold,
          color: INK,
        });
        x += col.width;
      });
      this.cursorY -= headerH;
    }

    this.cursorY -= 12;
  }

  private fitText(raw: string, maxWidth: number, fontSize: number, f: PDFFont): string {
    const clean = sanitizePdfText(raw, 120);
    if (!clean) return '';
    if (f.widthOfTextAtSize(clean, fontSize) <= maxWidth) return clean;
    let out = clean;
    while (out.length > 1 && f.widthOfTextAtSize(`${out}...`, fontSize) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}...`;
  }

  async save(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, idx) => {
      const footer = `${this.orgName}  |  Page ${idx + 1} of ${pages.length}`;
      p.drawText(footer, {
        x: this.margin,
        y: 14,
        size: 7.5,
        font: this.font,
        color: MUTED,
      });
    });
    return this.doc.save();
  }
}

/** (1) Annual Contribution Ledger (A4 Landscape) */
export async function buildAnnualLedgerPdfBytes(input: {
  orgSettings: OrgSettingsRow | null;
  pendingSyncCount: number;
  fiscalYear: FiscalYearRow;
  summaries: MemberFiscalYearSummary[];
}): Promise<Uint8Array> {
  const { fiscalYear, summaries } = input;
  const months = getMonthsForFiscalYear(fiscalYear);
  const perMonthTotals = months.map(() => 0);
  let grandTotal = 0;
  let grandArrears = 0;

  const byTier = new Map<string, { label: string; total: number; count: number }>();

  const rows = summaries.map((s) => {
    grandTotal += s.yearlyCharityTotal;
    grandArrears += s.arrearsTotal;
    const tier = s.currentMonthCompliance?.effectiveTier;
    const tierKey = tier?.tierId ?? 'exempt';
    const tierLabel = tier ? tier.tierName : 'Exempt';
    const agg = byTier.get(tierKey) ?? { label: tierLabel, total: 0, count: 0 };
    agg.total += s.yearlyCharityTotal;
    agg.count += 1;
    byTier.set(tierKey, agg);

    const monthVals = s.months.map((m, idx) => {
      perMonthTotals[idx] = (perMonthTotals[idx] ?? 0) + m.paidAmount;
      return m.paidAmount > 0 ? String(m.paidAmount) : '-';
    });

    return [
      String(s.member.member_no ?? '-'),
      s.member.full_name,
      ...monthVals,
      formatPKR(s.yearlyCharityTotal),
      s.arrearsTotal > 0 ? formatPKR(s.arrearsTotal) : '-',
    ];
  });

  const writer = new ReportPdfWriter({
    landscape: true,
    accent: 'charity',
    orgSettings: input.orgSettings,
    title: `Annual Contribution Ledger - ${fiscalYear.label}`,
    subtitle: `${fiscalYear.start_date} to ${fiscalYear.end_date}`,
    pendingSyncCount: input.pendingSyncCount,
  });
  await writer.init();

  const fixedCols = 28 + 130 + 68 + 64;
  const monthColW = (writer.contentWidth - fixedCols) / Math.max(1, months.length);

  const columns: PdfColumn[] = [
    { header: '#', width: 28, align: 'right' },
    { header: 'Member', width: 130, align: 'left' },
    ...months.map((m) => ({
      header: formatMonthShort(m, 'en'),
      width: monthColW,
      align: 'right' as const,
    })),
    { header: 'Total', width: 68, align: 'right' },
    { header: 'Arrears', width: 64, align: 'right' },
  ];

  const footerRow = [
    '',
    'Monthly Totals',
    ...perMonthTotals.map((amt) => (amt > 0 ? amt.toLocaleString() : '-')),
    formatPKR(grandTotal),
    formatPKR(grandArrears),
  ];

  writer.drawTable(columns, rows.length > 0 ? rows : [['', 'No members recorded']], {
    fontSize: 7.5,
    footerRow,
  });

  if (byTier.size > 0) {
    writer.drawSectionTitle('Collection by Tier');
    const tierW = writer.contentWidth;
    writer.drawTable(
      [
        { header: 'Tier', width: tierW * 0.5, align: 'left' },
        { header: 'Members', width: tierW * 0.2, align: 'right' },
        { header: 'Collected', width: tierW * 0.3, align: 'right' },
      ],
      Array.from(byTier.values()).map((t) => [t.label, String(t.count), formatPKR(t.total)]),
    );
  }

  return writer.save();
}

/** (2) Financial Summary (A4 Portrait) */
export async function buildFinancialSummaryPdfBytes(input: {
  orgSettings: OrgSettingsRow | null;
  pendingSyncCount: number;
  fiscalYear: FiscalYearRow;
  summaries: MemberFiscalYearSummary[];
  zakatYear: number;
  zakatDueTotal: number;
  zakatPaidTotal: number;
}): Promise<Uint8Array> {
  const { fiscalYear, summaries, zakatYear, zakatDueTotal, zakatPaidTotal } = input;
  let collected = 0;
  let expected = 0;
  let arrears = 0;
  let metMonths = 0;
  let dueMonths = 0;

  for (const s of summaries) {
    collected += s.yearlyCharityTotal;
    expected += s.expectedTotalToDate;
    arrears += s.arrearsTotal;
    metMonths += s.metCount;
    dueMonths += s.metCount + s.shortCount + s.unpaidCount;
  }
  const compliancePct = dueMonths > 0 ? Math.round((metMonths / dueMonths) * 100) : 100;

  const writer = new ReportPdfWriter({
    accent: 'charity',
    orgSettings: input.orgSettings,
    title: `Financial Summary - ${fiscalYear.label}`,
    subtitle: `${fiscalYear.start_date} to ${fiscalYear.end_date}`,
    pendingSyncCount: input.pendingSyncCount,
  });
  await writer.init();

  writer.drawSectionTitle('Monthly Charity Fund');
  writer.drawStatCards([
    { label: 'Charity Collected', value: formatPKR(collected), tone: 'success' },
    { label: 'Expected to Date', value: formatPKR(expected) },
    { label: 'Total Arrears', value: formatPKR(arrears), tone: arrears > 0 ? 'danger' : 'normal' },
    { label: 'Compliance Rate', value: `${compliancePct}%` },
  ]);

  writer.drawSectionTitle(`Ramazan Zakat Summary (${zakatYear}) - Strictly Separate from Charity`);
  writer.drawStatCards(
    [
      { label: 'Zakat Due', value: formatPKR(zakatDueTotal) },
      { label: 'Zakat Collected', value: formatPKR(zakatPaidTotal), tone: 'success' },
      { label: 'Zakat Balance', value: formatPKR(Math.max(0, zakatDueTotal - zakatPaidTotal)) },
    ],
    'zakat',
  );

  return writer.save();
}

/** (3) Individual Member Statement (A4 Portrait) */
export async function buildMemberStatementPdfBytes(input: {
  orgSettings: OrgSettingsRow | null;
  pendingSyncCount: number;
  member: ProfileRow;
  fiscalYear: FiscalYearRow;
  contributions: ContributionRow[];
  memberTiers: MemberTierRow[];
  tiers: TierRow[];
  tierRates: TierRateRow[];
  zakatAssessments: ZakatAssessmentRow[];
  zakatPayments: ZakatPaymentRow[];
  zakatYear: number;
  currentMonthStart: string;
}): Promise<Uint8Array> {
  const { member, fiscalYear, contributions, memberTiers, tiers, tierRates, zakatAssessments, zakatPayments, zakatYear, currentMonthStart } = input;
  const summary = computeMemberFiscalYearSummary({
    profile: member,
    fiscalYear,
    contributions,
    memberTiers,
    tiers,
    tierRates,
    currentMonthStart,
  });
  const tierHistory = getMemberTierHistory(member.id, memberTiers, tiers);
  const zakatSummary = computeMemberZakatYearSummary(member.id, zakatYear, zakatAssessments, zakatPayments);
  const memberPayments = contributions.filter(
    (c) =>
      c.member_id === member.id &&
      !c.deleted_at &&
      c.period_start >= fiscalYear.start_date &&
      c.period_start <= fiscalYear.end_date,
  );

  const writer = new ReportPdfWriter({
    accent: 'charity',
    orgSettings: input.orgSettings,
    title: `Member Statement - #${member.member_no ?? '-'} ${member.full_name}`,
    subtitle: `${fiscalYear.label}${member.designation ? ` | ${member.designation}` : ''}`,
    pendingSyncCount: input.pendingSyncCount,
  });
  await writer.init();

  writer.drawStatCards([
    { label: 'Year Charity Paid', value: formatPKR(summary.yearlyCharityTotal), tone: 'success' },
    { label: 'Arrears', value: formatPKR(summary.arrearsTotal), tone: summary.arrearsTotal > 0 ? 'danger' : 'normal' },
    { label: 'Met / Short / Unpaid', value: `${summary.metCount} / ${summary.shortCount} / ${summary.unpaidCount}` },
  ]);

  const w = writer.contentWidth;
  writer.drawSectionTitle('Charity Contributions');
  writer.drawTable(
    [
      { header: 'Period', width: w * 0.25 },
      { header: 'Paid On', width: w * 0.25 },
      { header: 'Remark', width: w * 0.3 },
      { header: 'Amount', width: w * 0.2, align: 'right' },
    ],
    memberPayments.length > 0
      ? memberPayments.map((p) => [
          formatMonthYear(p.period_start, 'en'),
          formatDateShort(p.paid_on, 'en'),
          p.remark ?? p.kind,
          formatPKR(p.amount),
        ])
      : [['No contributions recorded', '', '', '']],
  );

  writer.drawSectionTitle('Tier Assignment History');
  writer.drawTable(
    [
      { header: 'Tier', width: w * 0.35 },
      { header: 'Effective From', width: w * 0.25 },
      { header: 'Reason', width: w * 0.4 },
    ],
    tierHistory.length > 0
      ? tierHistory.map((th) => [th.tierName, th.effective_from, th.reason ?? '-'])
      : [['No tier assigned', '', '']],
  );

  writer.drawSectionTitle(`Zakat Section (${zakatYear}) - Separate Ledger`);
  writer.drawStatCards(
    [
      { label: 'Due', value: formatPKR(zakatSummary.dueAmount) },
      { label: 'Paid', value: formatPKR(zakatSummary.paidAmount), tone: 'success' },
      { label: 'Balance', value: formatPKR(zakatSummary.balance) },
    ],
    'zakat',
  );

  return writer.save();
}

/** (4) Annual Ramazan Zakat Report (A4 Portrait, Gold Accent) */
export async function buildZakatReportPdfBytes(input: {
  orgSettings: OrgSettingsRow | null;
  pendingSyncCount: number;
  year: number;
  setting: ZakatSettingRow | null;
  profiles: ProfileRow[];
  zakatMembers?: ZakatMemberRow[];
  assessments: ZakatAssessmentRow[];
  payments: ZakatPaymentRow[];
}): Promise<Uint8Array> {
  const { year, setting, profiles, zakatMembers = [], assessments, payments } = input;
  const perPersonAmount = setting?.per_person_amount ?? 0;

  let totalPeople = 0;
  let totalDue = 0;
  let totalPaid = 0;
  let tableRows: string[][] = [];

  if (zakatMembers.length > 0) {
    tableRows = zakatMembers.map((zm) => {
      const s = computeZakatMemberYearSummary({
        zakatMember: zm,
        year,
        perPersonAmount,
        payments,
      });
      if (zm.status === 'active') totalPeople += s.peopleCount;
      totalDue += s.dueAmount;
      totalPaid += s.paidAmount;
      return [
        String(zm.member_no),
        zm.khandan_name ? `${zm.payer_name} (${zm.khandan_name})` : zm.payer_name,
        String(s.peopleCount),
        formatPKR(s.dueAmount),
        formatPKR(s.paidAmount),
        formatPKR(s.remaining),
      ];
    });
  } else {
    tableRows = profiles
      .map((m) => ({ m, s: computeMemberZakatYearSummary(m.id, year, assessments, payments) }))
      .filter((x) => x.s.dueAmount > 0 || x.s.paidAmount > 0)
      .map(({ m, s }) => {
        totalDue += s.dueAmount;
        totalPaid += s.paidAmount;
        return [
          String(m.member_no ?? '-'),
          m.full_name,
          '1',
          formatPKR(s.dueAmount),
          formatPKR(s.paidAmount),
          formatPKR(s.balance),
        ];
      });
  }

  const writer = new ReportPdfWriter({
    accent: 'zakat',
    orgSettings: input.orgSettings,
    title: `Zakat Report - ${year}`,
    subtitle: 'Annual Ramazan Zakat Register - Strictly Separate from Charity',
    pendingSyncCount: input.pendingSyncCount,
  });
  await writer.init();

  writer.drawStatCards([
    {
      label: 'Per Person Rate',
      value: perPersonAmount > 0 ? formatPKR(perPersonAmount) : setting ? formatPKR(setting.nisab_amount) : '-',
    },
    { label: 'Total Due', value: `${formatPKR(totalDue)}${totalPeople > 0 ? ` (${totalPeople})` : ''}` },
    { label: 'Total Paid', value: formatPKR(totalPaid), tone: 'success' },
    { label: 'Remaining', value: formatPKR(Math.max(0, totalDue - totalPaid)) },
  ]);

  const w = writer.contentWidth;
  writer.drawTable(
    [
      { header: '#', width: 32, align: 'right' },
      { header: 'Payer / Khandan', width: w - 32 - 48 - 78 - 78 - 78 },
      { header: 'People', width: 48, align: 'right' },
      { header: 'Due', width: 78, align: 'right' },
      { header: 'Paid', width: 78, align: 'right' },
      { header: 'Remaining', width: 78, align: 'right' },
    ],
    tableRows.length > 0 ? tableRows : [['', 'No Zakat records', '', '', '', '']],
    {
      footerRow: [
        '',
        'Totals',
        totalPeople > 0 ? String(totalPeople) : '',
        formatPKR(totalDue),
        formatPKR(totalPaid),
        formatPKR(Math.max(0, totalDue - totalPaid)),
      ],
    },
  );

  if (setting?.basis_note) {
    writer.drawNoteBox(setting.basis_note);
  }

  return writer.save();
}

/** (5) Unpaid & Short Members List (A4 Portrait) */
export async function buildUnpaidShortListPdfBytes(input: {
  orgSettings: OrgSettingsRow | null;
  pendingSyncCount: number;
  fiscalYear: FiscalYearRow;
  summaries: MemberFiscalYearSummary[];
  currentMonthStart: string;
}): Promise<Uint8Array> {
  const { fiscalYear, summaries, currentMonthStart } = input;
  const flagged = summaries.filter((s) => s.isBelowMinimumCurrentCycle || s.arrearsTotal > 0);
  const totalArrears = flagged.reduce((sum, s) => sum + s.arrearsTotal, 0);

  const writer = new ReportPdfWriter({
    accent: 'charity',
    orgSettings: input.orgSettings,
    title: `Unpaid & Short Members - ${fiscalYear.label}`,
    subtitle: `Cycle: ${formatMonthYear(currentMonthStart, 'en')}`,
    pendingSyncCount: input.pendingSyncCount,
  });
  await writer.init();

  writer.drawStatCards([
    { label: 'Flagged Members', value: String(flagged.length) },
    { label: 'Total Arrears', value: formatPKR(totalArrears), tone: totalArrears > 0 ? 'danger' : 'success' },
  ]);

  const w = writer.contentWidth;
  writer.drawTable(
    [
      { header: '#', width: 32, align: 'right' },
      { header: 'Member', width: w - 32 - 96 - 62 - 86 - 86 },
      { header: 'Phone', width: 96 },
      { header: 'Status', width: 62 },
      { header: 'This Month', width: 86, align: 'right' },
      { header: 'Total Arrears', width: 86, align: 'right' },
    ],
    flagged.length > 0
      ? flagged.map((s) => [
          String(s.member.member_no ?? '-'),
          s.member.full_name,
          s.member.phone ?? '-',
          s.currentMonthCompliance?.status ?? 'unpaid',
          formatPKR(s.currentMonthCompliance?.shortfall ?? 0),
          formatPKR(s.arrearsTotal),
        ])
      : [['', 'All active members are up to date', '', '', '', '']],
    {
      footerRow: ['', `Total Arrears (${flagged.length})`, '', '', '', formatPKR(totalArrears)],
    },
  );

  return writer.save();
}
