import { formatPKR } from '@/core/money';
import { formatDateShort, formatMonthShort, formatMonthYear } from '@/core/dates';
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
import {
  computeMemberFiscalYearSummary,
  MemberFiscalYearSummary,
} from '@/core/rules/compliance';
import { getMonthsForFiscalYear } from '@/core/rules/fiscalYear';
import { getMemberTierHistory } from '@/core/rules/tiers';
import { computeMemberZakatYearSummary, computeZakatMemberYearSummary } from '@/core/rules/zakat';
import { escapeHtml, ReportLang, wrapReportHtml } from './htmlBase';

interface SharedTemplateInput {
  orgSettings: OrgSettingsRow | null;
  lang: ReportLang;
  pendingSyncCount: number;
  urduFontBase64?: string;
  generatedAt?: Date;
}

function memberDisplayName(m: ProfileRow, lang: ReportLang): string {
  return lang === 'ur' && m.full_name_ur ? m.full_name_ur : m.full_name;
}

/** (1) Annual Contribution Report — Full Ledger Grid (A4 Landscape) + Monthly & Tier Totals */
export function buildAnnualLedgerHtml(
  input: SharedTemplateInput & {
    fiscalYear: FiscalYearRow;
    summaries: MemberFiscalYearSummary[];
  },
): string {
  const { fiscalYear, summaries, lang } = input;
  const isUr = lang === 'ur';
  const months = getMonthsForFiscalYear(fiscalYear);
  const perMonthTotals = months.map(() => 0);
  let grandTotal = 0;
  let grandArrears = 0;

  const byTier = new Map<string, { label: string; total: number; count: number }>();

  const bodyRows = summaries
    .map((s) => {
      grandTotal += s.yearlyCharityTotal;
      grandArrears += s.arrearsTotal;
      const tier = s.currentMonthCompliance?.effectiveTier;
      const tierKey = tier?.tierId ?? 'exempt';
      const tierLabel = tier
        ? isUr && tier.tierNameUr
          ? tier.tierNameUr
          : tier.tierName
        : isUr
          ? 'مستثنیٰ'
          : 'Exempt';
      const agg = byTier.get(tierKey) ?? { label: tierLabel, total: 0, count: 0 };
      agg.total += s.yearlyCharityTotal;
      agg.count += 1;
      byTier.set(tierKey, agg);

      const monthCells = s.months
        .map((m, idx) => {
          perMonthTotals[idx] = (perMonthTotals[idx] ?? 0) + m.paidAmount;
          const cls = `num badge-${m.status}`;
          return `<td class="${cls}">${m.paidAmount > 0 ? m.paidAmount : '—'}</td>`;
        })
        .join('');

      return `<tr>
        <td class="num">${s.member.member_no}</td>
        <td><strong>${escapeHtml(memberDisplayName(s.member, lang))}</strong>${
          s.member.designation ? ` <small>(${escapeHtml(s.member.designation)})</small>` : ''
        }</td>
        ${monthCells}
        <td class="num"><strong>${formatPKR(s.yearlyCharityTotal)}</strong></td>
        <td class="num">${s.arrearsTotal > 0 ? formatPKR(s.arrearsTotal) : '—'}</td>
      </tr>`;
    })
    .join('');

  const monthHeaders = months
    .map((m) => `<th class="num">${escapeHtml(formatMonthShort(m, lang))}</th>`)
    .join('');
  const monthFooterCells = perMonthTotals
    .map((amt) => `<td class="num">${amt > 0 ? amt.toLocaleString() : '—'}</td>`)
    .join('');

  const tierRows = Array.from(byTier.values())
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.label)}</td><td class="num">${t.count}</td><td class="num">${formatPKR(t.total)}</td></tr>`,
    )
    .join('');

  const bodyHtml = `
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>${isUr ? 'رکن کا نام' : 'Member'}</th>
          ${monthHeaders}
          <th class="num">${isUr ? 'سالانہ کل' : 'Total'}</th>
          <th class="num">${isUr ? 'بقایا' : 'Arrears'}</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>
        <tr class="total-row">
          <td colspan="2">${isUr ? 'ماہانہ مجموعہ' : 'Monthly Totals'}</td>
          ${monthFooterCells}
          <td class="num">${formatPKR(grandTotal)}</td>
          <td class="num">${formatPKR(grandArrears)}</td>
        </tr>
      </tfoot>
    </table>
    <table style="max-width: 380px; margin-top: 14px;">
      <thead>
        <tr>
          <th>${isUr ? 'درجہ' : 'Tier'}</th>
          <th class="num">${isUr ? 'اراکین' : 'Members'}</th>
          <th class="num">${isUr ? 'کل وصولی' : 'Collected'}</th>
        </tr>
      </thead>
      <tbody>${tierRows}</tbody>
    </table>
  `;

  return wrapReportHtml({
    ...input,
    landscape: true,
    title: isUr
      ? `سالانہ چندہ کھاتہ — ${fiscalYear.label}`
      : `Annual Contribution Ledger — ${fiscalYear.label}`,
    subtitle: `${fiscalYear.start_date} → ${fiscalYear.end_date}`,
    bodyHtml,
  });
}

/** (2) Financial Summary — Collected vs Expected, Compliance Rate, Arrears, Separate Zakat Box */
export function buildFinancialSummaryHtml(
  input: SharedTemplateInput & {
    fiscalYear: FiscalYearRow;
    summaries: MemberFiscalYearSummary[];
    zakatYear: number;
    zakatDueTotal: number;
    zakatPaidTotal: number;
  },
): string {
  const { fiscalYear, summaries, zakatYear, zakatDueTotal, zakatPaidTotal, lang } = input;
  const isUr = lang === 'ur';

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

  const bodyHtml = `
    <div class="summary-grid">
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'وصول شدہ چندہ' : 'Charity Collected'}</div>
        <div class="stat-val">${formatPKR(collected)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'متوقع چندہ' : 'Expected to Date'}</div>
        <div class="stat-val">${formatPKR(expected)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'کل بقایا' : 'Total Arrears'}</div>
        <div class="stat-val">${formatPKR(arrears)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'شرح پابندی' : 'Compliance Rate'}</div>
        <div class="stat-val">${compliancePct}%</div>
      </div>
    </div>

    <div class="zakat-box">
      <strong>${isUr ? `زکوٰۃ خلاصہ (${zakatYear}) — ماہانہ چندے سے الگ` : `Zakat Summary (${zakatYear}) — Strictly Separate from Charity`}</strong>
      <div class="summary-grid" style="margin-top: 8px; margin-bottom: 0;">
        <div class="stat-box" style="background: #FFFFFF;">
          <div class="stat-label">${isUr ? 'واجب الادا زکوٰۃ' : 'Zakat Assessed Due'}</div>
          <div class="stat-val">${formatPKR(zakatDueTotal)}</div>
        </div>
        <div class="stat-box" style="background: #FFFFFF;">
          <div class="stat-label">${isUr ? 'وصول شدہ زکوٰۃ' : 'Zakat Collected'}</div>
          <div class="stat-val">${formatPKR(zakatPaidTotal)}</div>
        </div>
        <div class="stat-box" style="background: #FFFFFF;">
          <div class="stat-label">${isUr ? 'بقایا زکوٰۃ' : 'Zakat Balance'}</div>
          <div class="stat-val">${formatPKR(zakatDueTotal - zakatPaidTotal)}</div>
        </div>
      </div>
    </div>
  `;

  return wrapReportHtml({
    ...input,
    title: isUr ? `مالی خلاصہ — ${fiscalYear.label}` : `Financial Summary — ${fiscalYear.label}`,
    subtitle: `${fiscalYear.start_date} → ${fiscalYear.end_date}`,
    bodyHtml,
  });
}

/** (3) Individual Member Statement — Payments, Tier History, Compliance & Separate Zakat Section */
export function buildMemberStatementHtml(
  input: SharedTemplateInput & {
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
  },
): string {
  const {
    member,
    fiscalYear,
    contributions,
    memberTiers,
    tiers,
    tierRates,
    zakatAssessments,
    zakatPayments,
    zakatYear,
    currentMonthStart,
    lang,
  } = input;
  const isUr = lang === 'ur';

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
  const zakatSummary = computeMemberZakatYearSummary(
    member.id,
    zakatYear,
    zakatAssessments,
    zakatPayments,
  );

  const memberPayments = contributions.filter(
    (c) =>
      c.member_id === member.id &&
      !c.deleted_at &&
      c.period_start >= fiscalYear.start_date &&
      c.period_start <= fiscalYear.end_date,
  );

  const paymentRows =
    memberPayments.length === 0
      ? `<tr><td colspan="4">${isUr ? 'کوئی ادائیگی نہیں' : 'No contributions recorded'}</td></tr>`
      : memberPayments
          .map(
            (p) => `<tr>
              <td>${escapeHtml(formatMonthYear(p.period_start, lang))}</td>
              <td>${escapeHtml(formatDateShort(p.paid_on, lang))}</td>
              <td>${escapeHtml(p.remark ?? p.kind)}</td>
              <td class="num">${formatPKR(p.amount)}</td>
            </tr>`,
          )
          .join('');

  const tierRows =
    tierHistory.length === 0
      ? `<tr><td colspan="3">${isUr ? 'کوئی درجہ مقرر نہیں' : 'No tier assigned'}</td></tr>`
      : tierHistory
          .map(
            (th) => `<tr>
              <td>${escapeHtml(isUr && th.tierNameUr ? th.tierNameUr : th.tierName)}</td>
              <td>${escapeHtml(th.effective_from)}</td>
              <td>${escapeHtml(th.reason ?? '—')}</td>
            </tr>`,
          )
          .join('');

  const bodyHtml = `
    <div class="summary-grid">
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'سالانہ چندہ' : 'Year Charity Paid'}</div>
        <div class="stat-val">${formatPKR(summary.yearlyCharityTotal)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'بقایا' : 'Arrears'}</div>
        <div class="stat-val">${formatPKR(summary.arrearsTotal)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'مکمل / کم / باقی ماہ' : 'Met / Short / Unpaid'}</div>
        <div class="stat-val">${summary.metCount} / ${summary.shortCount} / ${summary.unpaidCount}</div>
      </div>
    </div>

    <h3>${isUr ? 'چندہ ادائیگیاں' : 'Charity Contributions'}</h3>
    <table>
      <thead>
        <tr>
          <th>${isUr ? 'مہینہ' : 'Period'}</th>
          <th>${isUr ? 'تاریخ ادائیگی' : 'Paid On'}</th>
          <th>${isUr ? 'کیفیت' : 'Remark'}</th>
          <th class="num">${isUr ? 'رقم' : 'Amount'}</th>
        </tr>
      </thead>
      <tbody>${paymentRows}</tbody>
    </table>

    <h3 style="margin-top: 12px;">${isUr ? 'درجہ بندی کی تاریخ' : 'Tier Assignment History'}</h3>
    <table>
      <thead>
        <tr>
          <th>${isUr ? 'درجہ' : 'Tier'}</th>
          <th>${isUr ? 'نافذ از' : 'Effective From'}</th>
          <th>${isUr ? 'وجہ' : 'Reason'}</th>
        </tr>
      </thead>
      <tbody>${tierRows}</tbody>
    </table>

    <div class="zakat-box">
      <strong>${isUr ? `زکوٰۃ حصہ (${zakatYear}) — الگ کھاتہ` : `Zakat Section (${zakatYear}) — Separate Ledger`}</strong>
      <p style="margin: 6px 0 0 0;">
        ${isUr ? 'واجب الادا' : 'Due'}: <strong>${formatPKR(zakatSummary.dueAmount)}</strong> ·
        ${isUr ? 'ادا شدہ' : 'Paid'}: <strong>${formatPKR(zakatSummary.paidAmount)}</strong> ·
        ${isUr ? 'بقایا' : 'Balance'}: <strong>${formatPKR(zakatSummary.balance)}</strong>
      </p>
    </div>
  `;

  return wrapReportHtml({
    ...input,
    title: isUr
      ? `رکن کا بیان — #${member.member_no} ${memberDisplayName(member, lang)}`
      : `Member Statement — #${member.member_no} ${memberDisplayName(member, lang)}`,
    subtitle: `${fiscalYear.label}${member.designation ? ` · ${member.designation}` : ''}`,
    bodyHtml,
  });
}

/** (4) Zakat Report — Separate Annual Zakat Register (Per-Person × Family/Solo) */
export function buildZakatReportHtml(
  input: SharedTemplateInput & {
    year: number;
    setting: ZakatSettingRow | null;
    profiles: ProfileRow[];
    zakatMembers?: ZakatMemberRow[];
    assessments: ZakatAssessmentRow[];
    payments: ZakatPaymentRow[];
  },
): string {
  const { year, setting, profiles, zakatMembers = [], assessments, payments, lang } = input;
  const isUr = lang === 'ur';
  const perPersonAmount = setting?.per_person_amount ?? 0;

  let totalPeople = 0;
  let totalDue = 0;
  let totalPaid = 0;
  let rows = '';

  if (zakatMembers.length > 0) {
    rows = zakatMembers
      .map((zm) => {
        const s = computeZakatMemberYearSummary({
          zakatMember: zm,
          year,
          perPersonAmount,
          payments,
        });
        if (zm.status === 'active') totalPeople += s.peopleCount;
        totalDue += s.dueAmount;
        totalPaid += s.paidAmount;
        return `<tr>
          <td class="num">${zm.member_no}</td>
          <td><strong>${escapeHtml(zm.payer_name)}</strong>${zm.khandan_name ? ` (${escapeHtml(zm.khandan_name)})` : ''}</td>
          <td class="num">${s.peopleCount}</td>
          <td class="num">${formatPKR(s.dueAmount)}</td>
          <td class="num">${formatPKR(s.paidAmount)}</td>
          <td class="num"><strong>${formatPKR(s.remaining)}</strong></td>
        </tr>`;
      })
      .join('');
  } else {
    rows = profiles
      .map((m) => ({ m, s: computeMemberZakatYearSummary(m.id, year, assessments, payments) }))
      .filter((x) => x.s.dueAmount > 0 || x.s.paidAmount > 0)
      .map(({ m, s }) => {
        totalDue += s.dueAmount;
        totalPaid += s.paidAmount;
        return `<tr>
          <td class="num">${m.member_no}</td>
          <td>${escapeHtml(memberDisplayName(m, lang))}</td>
          <td class="num">1</td>
          <td class="num">${formatPKR(s.dueAmount)}</td>
          <td class="num">${formatPKR(s.paidAmount)}</td>
          <td class="num"><strong>${formatPKR(s.balance)}</strong></td>
        </tr>`;
      })
      .join('');
  }

  const bodyHtml = `
    <div class="summary-grid">
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'فی کس رقم' : 'Per Person Rate'}</div>
        <div class="stat-val">${perPersonAmount > 0 ? formatPKR(perPersonAmount) : setting ? formatPKR(setting.nisab_amount) : '—'}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'کل واجب الادا' : 'Total Due'}</div>
        <div class="stat-val">${formatPKR(totalDue)}${totalPeople > 0 ? ` (${totalPeople})` : ''}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'کل وصول شدہ' : 'Total Zakat Paid'}</div>
        <div class="stat-val">${formatPKR(totalPaid)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">${isUr ? 'کل بقایا' : 'Remaining Balance'}</div>
        <div class="stat-val">${formatPKR(Math.max(0, totalDue - totalPaid))}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>${isUr ? 'نام / خاندان' : 'Payer / Khandan'}</th>
          <th class="num">${isUr ? 'افراد' : 'People'}</th>
          <th class="num">${isUr ? 'واجب الادا' : 'Due'}</th>
          <th class="num">${isUr ? 'ادا شدہ' : 'Paid'}</th>
          <th class="num">${isUr ? 'بقایا' : 'Remaining'}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="6">${isUr ? 'کوئی زکوٰۃ اندراج نہیں' : 'No Zakat records'}</td></tr>`}</tbody>
    </table>

    ${setting?.basis_note ? `<div class="scholar-note">${escapeHtml(setting.basis_note)}</div>` : ''}
  `;

  return wrapReportHtml({
    ...input,
    accent: 'zakat',
    title: isUr ? `زکوٰۃ رپورٹ — ${year}` : `Zakat Report — ${year}`,
    subtitle: isUr ? 'سالانہ رمضان زکوٰۃ رجسٹر — چندے سے مکمل الگ' : 'Annual Ramazan Zakat Register — Strictly Separate from Charity',
    bodyHtml,
  });
}

/** (5) Unpaid & Short Members List */
export function buildUnpaidShortListHtml(
  input: SharedTemplateInput & {
    fiscalYear: FiscalYearRow;
    summaries: MemberFiscalYearSummary[];
    currentMonthStart: string;
  },
): string {
  const { fiscalYear, summaries, currentMonthStart, lang } = input;
  const isUr = lang === 'ur';

  const flagged = summaries.filter(
    (s) => s.isBelowMinimumCurrentCycle || s.arrearsTotal > 0,
  );
  const totalArrears = flagged.reduce((sum, s) => sum + s.arrearsTotal, 0);

  const rows = flagged
    .map((s) => {
      const curStatus = s.currentMonthCompliance?.status ?? 'unpaid';
      return `<tr>
        <td class="num">${s.member.member_no}</td>
        <td><strong>${escapeHtml(memberDisplayName(s.member, lang))}</strong></td>
        <td>${escapeHtml(s.member.phone ?? '—')}</td>
        <td class="badge-${curStatus}">${escapeHtml(curStatus)}</td>
        <td class="num">${formatPKR(s.currentMonthCompliance?.shortfall ?? 0)}</td>
        <td class="num"><strong>${formatPKR(s.arrearsTotal)}</strong></td>
      </tr>`;
    })
    .join('');

  const bodyHtml = `
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>${isUr ? 'رکن' : 'Member'}</th>
          <th>${isUr ? 'فون' : 'Phone'}</th>
          <th>${isUr ? 'حالت' : 'Status'}</th>
          <th class="num">${isUr ? 'موجودہ ماہ کمی' : 'This Month Shortfall'}</th>
          <th class="num">${isUr ? 'کل بقایا' : 'Total Arrears'}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="6">${isUr ? 'تمام اراکین مکمل ہیں' : 'All active members are up to date'}</td></tr>`}</tbody>
      <tfoot>
        <tr class="total-row">
          <td colspan="5">${isUr ? 'کل بقایا' : 'Total Arrears'} (${flagged.length})</td>
          <td class="num">${formatPKR(totalArrears)}</td>
        </tr>
      </tfoot>
    </table>
  `;

  return wrapReportHtml({
    ...input,
    title: isUr
      ? `بقایا اور کم ادائیگی اراکین — ${fiscalYear.label}`
      : `Unpaid & Short Members — ${fiscalYear.label}`,
    subtitle: `${isUr ? 'مہینہ' : 'Cycle'}: ${formatMonthYear(currentMonthStart, lang)}`,
    bodyHtml,
  });
}

/** RFC-4180 UTF-8 CSV Export (with BOM for Excel Urdu compatibility). */
export function buildLedgerCsv(
  fiscalYear: FiscalYearRow,
  summaries: MemberFiscalYearSummary[],
): string {
  const months = getMonthsForFiscalYear(fiscalYear);
  const escapeCsv = (val: string | number | null | undefined) => {
    const s = val == null ? '' : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = [
    'member_no',
    'name',
    'name_ur',
    'designation',
    'status',
    'tag',
    ...months.map((m) => m.slice(0, 7)),
    'yearly_total',
    'arrears',
  ];

  const lines = [header.map(escapeCsv).join(',')];
  for (const s of summaries) {
    lines.push(
      [
        s.member.member_no,
        s.member.full_name,
        s.member.full_name_ur ?? '',
        s.member.designation ?? '',
        s.member.status,
        s.member.tag ?? '',
        ...s.months.map((m) => m.paidAmount),
        s.yearlyCharityTotal,
        s.arrearsTotal,
      ]
        .map(escapeCsv)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\n')}\n`;
}
