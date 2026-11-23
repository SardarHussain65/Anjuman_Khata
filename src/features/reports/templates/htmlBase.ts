import { OrgSettingsRow } from '@/data/db/types';
import { formatKarachiDateTime } from '@/core/dates';

export type ReportLang = 'en' | 'ur';

export interface BaseHtmlOptions {
  title: string;
  subtitle?: string;
  lang: ReportLang;
  landscape?: boolean;
  orgSettings: OrgSettingsRow | null;
  pendingSyncCount: number;
  urduFontBase64?: string;
  generatedAt?: Date;
  accent?: 'charity' | 'zakat';
  bodyHtml: string;
}

export function escapeHtml(raw: string | number | null | undefined): string {
  const s = raw == null ? '' : String(raw);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function wrapReportHtml(options: BaseHtmlOptions): string {
  const {
    title,
    subtitle,
    lang,
    landscape = false,
    orgSettings,
    pendingSyncCount,
    urduFontBase64,
    generatedAt = new Date(),
    accent = 'charity',
    bodyHtml,
  } = options;

  const isRtl = lang === 'ur';
  const dir = isRtl ? 'rtl' : 'ltr';
  const orgName =
    isRtl && orgSettings?.org_name_ur
      ? orgSettings.org_name_ur
      : orgSettings?.org_name ?? 'Anjuman Khata';
  const accentColor = accent === 'zakat' ? '#B7791F' : '#0F5C4A';
  const accentSoft = accent === 'zakat' ? '#FEF6E7' : '#E6F4F0';
  const generatedStr = formatKarachiDateTime(generatedAt);

  const fontFaceCss = urduFontBase64
    ? `@font-face {
        font-family: 'NotoNaskhUrdu';
        src: url('data:font/ttf;base64,${urduFontBase64}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }`
    : '';

  const fontStack = isRtl
    ? `'NotoNaskhUrdu', 'Noto Naskh Arabic', 'Jameel Noori Nastaleeq', Tahoma, sans-serif`
    : `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'NotoNaskhUrdu', sans-serif`;

  const logoHtml = orgSettings?.logo
    ? `<img src="${escapeHtml(orgSettings.logo)}" class="logo" alt="Logo" />`
    : '';

  const unsyncedNote =
    pendingSyncCount > 0
      ? `<span class="unsynced">${
          isRtl
            ? `انتباہ: ${pendingSyncCount} غیر ہم آہنگ مقامی تبدیلیاں شامل ہیں`
            : `Includes ${pendingSyncCount} unsynced local change${pendingSyncCount === 1 ? '' : 's'}`
        }</span>`
      : '';

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${fontFaceCss}
    @page {
      size: A4 ${landscape ? 'landscape' : 'portrait'};
      margin: 12mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: ${fontStack};
      color: #15221E;
      font-size: ${landscape ? '9.5px' : '11px'};
      line-height: ${isRtl ? '1.75' : '1.45'};
      margin: 0;
      padding: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid ${accentColor};
      padding-bottom: 8px;
      margin-bottom: 12px;
      gap: 12px;
    }
    .org-wrap { display: flex; align-items: center; gap: 10px; }
    .logo { width: 42px; height: 42px; object-fit: contain; border-radius: 6px; }
    .org-name { font-size: 16px; font-weight: 700; color: ${accentColor}; margin: 0; }
    .report-title { font-size: 13px; font-weight: 700; margin: 2px 0 0 0; }
    .report-sub { font-size: 10px; color: #4B5B55; margin: 2px 0 0 0; }
    .summary-grid {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .stat-box {
      flex: 1;
      min-width: 120px;
      background: ${accentSoft};
      border: 1px solid #D5D2C8;
      border-radius: 6px;
      padding: 8px 10px;
    }
    .stat-label { font-size: 9.5px; color: #4B5B55; }
    .stat-val { font-size: 14px; font-weight: 700; color: #15221E; font-variant-numeric: tabular-nums; }
    .zakat-box {
      background: #FEF6E7;
      border: 1.5px solid #B7791F;
      border-radius: 6px;
      padding: 10px 12px;
      margin-top: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; }
    th, td {
      border: 1px solid #D5D2C8;
      padding: ${landscape ? '4px 4px' : '6px 7px'};
      text-align: ${isRtl ? 'right' : 'left'};
      vertical-align: middle;
    }
    th {
      background: ${accentSoft};
      color: #15221E;
      font-weight: 700;
      font-size: ${landscape ? '8.5px' : '10px'};
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .total-row td {
      background: ${accentSoft};
      font-weight: 700;
    }
    .badge-met { color: #15803D; font-weight: 700; }
    .badge-short { color: #B45309; font-weight: 700; }
    .badge-unpaid { color: #B91C1C; font-weight: 700; }
    .badge-exempt { color: #64748B; }
    .scholar-note {
      margin-top: 12px;
      padding: 8px 10px;
      background: #F4F3EE;
      border-radius: 6px;
      font-size: 9.5px;
      color: #4B5B55;
    }
    .footer {
      margin-top: 16px;
      padding-top: 8px;
      border-top: 1px solid #D5D2C8;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #64748B;
      gap: 10px;
    }
    .unsynced { color: #B45309; font-weight: 700; }
  </style>
</head>
<body>
  <div class="header">
    <div class="org-wrap">
      ${logoHtml}
      <div>
        <h1 class="org-name">${escapeHtml(orgName)}</h1>
        <div class="report-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="report-sub">${escapeHtml(subtitle)}</div>` : ''}
      </div>
    </div>
  </div>
  ${bodyHtml}
  <div class="footer">
    <span>${isRtl ? 'تیار کردہ وقت' : 'Generated'}: ${escapeHtml(generatedStr)}</span>
    ${unsyncedNote}
  </div>
</body>
</html>`;
}
