import { getKarachiToday, getMonthsBetween, toMonthStart } from '../dates';
import { FiscalYearRow } from '@/data/db/types';

export function isPeriodInFiscalYear(periodStart: string, fy: FiscalYearRow): boolean {
  const month = toMonthStart(periodStart);
  return month >= toMonthStart(fy.start_date) && month <= toMonthStart(fy.end_date);
}

export function getMonthsForFiscalYear(fy: FiscalYearRow): string[] {
  return getMonthsBetween(fy.start_date, fy.end_date);
}

export function findClosedFiscalYearForDate(
  dateStr: string,
  fiscalYears: readonly FiscalYearRow[],
): FiscalYearRow | null {
  const iso = dateStr.slice(0, 10);
  return (
    fiscalYears.find(
      (fy) => !fy.deleted_at && fy.status === 'closed' && iso >= fy.start_date && iso <= fy.end_date,
    ) ?? null
  );
}

export function findClosedFiscalYearForZakat(
  year: number,
  paidOn: string,
  fiscalYears: readonly FiscalYearRow[],
): FiscalYearRow | null {
  const byDate = findClosedFiscalYearForDate(paidOn, fiscalYears);
  if (byDate) return byDate;
  return (
    fiscalYears.find(
      (fy) =>
        !fy.deleted_at &&
        fy.status === 'closed' &&
        (fy.label === String(year) || Number.parseInt(fy.start_date.slice(0, 4), 10) === year),
    ) ?? null
  );
}

export function findCurrentFiscalYear(
  fiscalYears: readonly FiscalYearRow[],
  now: Date = new Date(),
): FiscalYearRow | null {
  const today = getKarachiToday(now);
  const active = fiscalYears.filter((fy) => !fy.deleted_at);
  const containing = active.find((fy) => today >= fy.start_date && today <= fy.end_date);
  if (containing) return containing;
  const sorted = [...active].sort((a, b) => b.start_date.localeCompare(a.start_date));
  return sorted[0] ?? null;
}
