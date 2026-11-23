/**
 * Timezone-deterministic date helpers for Asia/Karachi (UTC+5, no DST).
 * Never rely on the device's local timezone for cycle or "current month" compliance.
 */

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Returns current date in Asia/Karachi as YYYY-MM-DD. */
export function getKarachiToday(now: Date = new Date()): string {
  const karachi = new Date(now.getTime() + KARACHI_OFFSET_MS);
  const y = karachi.getUTCFullYear();
  const m = karachi.getUTCMonth() + 1;
  const d = karachi.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Returns current Karachi month start as YYYY-MM-01. */
export function getKarachiCurrentMonthStart(now: Date = new Date()): string {
  return toMonthStart(getKarachiToday(now));
}

/** Returns current Karachi timestamp string formatted for display / PDF footer. */
export function formatKarachiDateTime(now: Date = new Date()): string {
  const karachi = new Date(now.getTime() + KARACHI_OFFSET_MS);
  const y = karachi.getUTCFullYear();
  const m = pad2(karachi.getUTCMonth() + 1);
  const d = pad2(karachi.getUTCDate());
  const hh = pad2(karachi.getUTCHours());
  const mm = pad2(karachi.getUTCMinutes());
  return `${y}-${m}-${d} ${hh}:${mm} PKT`;
}

/** Normalizes any YYYY-MM-DD or YYYY-MM string to YYYY-MM-01. */
export function toMonthStart(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  if (!y || !m) {
    throw new Error(`Invalid ISO date string: ${dateStr}`);
  }
  return `${y}-${pad2(Number.parseInt(m, 10))}-01`;
}

export function monthStartOf(year: number, month1To12: number): string {
  return `${year}-${pad2(month1To12)}-01`;
}

export function parseYearMonth(dateStr: string): { year: number; month: number } {
  const [yStr, mStr] = dateStr.split('-');
  return {
    year: Number.parseInt(yStr, 10),
    month: Number.parseInt(mStr, 10),
  };
}

/** Adds deltaMonths (can be negative) to a YYYY-MM-01 period string. */
export function addMonths(periodStart: string, deltaMonths: number): string {
  const { year, month } = parseYearMonth(periodStart);
  const total = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12 + 12) % 12 + 1;
  return monthStartOf(nextYear, nextMonth);
}

/** Generates all month start dates (YYYY-MM-01) inclusive between startDate and endDate. */
export function getMonthsBetween(startDate: string, endDate: string): string[] {
  const start = toMonthStart(startDate);
  const end = toMonthStart(endDate);
  const result: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 240) {
    result.push(cursor);
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return result;
}

/** Computes last day of a calendar month (YYYY-MM-DD). */
export function endOfMonth(year: number, month1To12: number): string {
  const lastDay = new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
  return `${year}-${pad2(month1To12)}-${pad2(lastDay)}`;
}

/** Builds a 12-month fiscal year start/end date & label from a start year and fiscal start month. */
export function buildFiscalYearDefinition(startYear: number, fiscalStartMonth: number): {
  label: string;
  startDate: string;
  endDate: string;
} {
  const startDate = monthStartOf(startYear, fiscalStartMonth);
  const endMonthStart = addMonths(startDate, 11);
  const { year: endY, month: endM } = parseYearMonth(endMonthStart);
  const endDate = endOfMonth(endY, endM);
  const label = fiscalStartMonth === 1 ? `${startYear}` : `${startYear}-${String(endY).slice(-2)}`;
  return { label, startDate, endDate };
}

export function formatMonthShort(periodStart: string, lang: 'en' | 'ur' = 'en'): string {
  const { month } = parseYearMonth(periodStart);
  const idx = Math.max(0, Math.min(11, month - 1));
  return lang === 'ur' ? MONTHS_UR[idx] : MONTHS_EN[idx];
}

export function formatMonthYear(periodStart: string, lang: 'en' | 'ur' = 'en'): string {
  const { year } = parseYearMonth(periodStart);
  return `${formatMonthShort(periodStart, lang)} ${year}`;
}

export function formatDateShort(dateStr: string | null | undefined, lang: 'en' | 'ur' = 'en'): string {
  if (!dateStr) return '—';
  const parts = dateStr.slice(0, 10).split('-');
  if (parts.length !== 3) return dateStr;
  const day = Number.parseInt(parts[2], 10);
  const month = Number.parseInt(parts[1], 10);
  const year = parts[0];
  const mLabel = lang === 'ur' ? MONTHS_UR[month - 1] ?? parts[1] : MONTHS_EN[month - 1] ?? parts[1];
  return `${day} ${mLabel} ${year}`;
}
