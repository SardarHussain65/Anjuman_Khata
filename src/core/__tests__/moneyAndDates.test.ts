import { assertIntegerPKR, formatPKR, parsePKR, sumPKR } from '../money';
import {
  addMonths,
  buildFiscalYearDefinition,
  getKarachiCurrentMonthStart,
  getKarachiToday,
  getMonthsBetween,
} from '../dates';

describe('PKR integer money utilities', () => {
  it('formats PKR with thousand separators and sign', () => {
    expect(formatPKR(0)).toBe('Rs 0');
    expect(formatPKR(200)).toBe('Rs 200');
    expect(formatPKR(1500)).toBe('Rs 1,500');
    expect(formatPKR(180000)).toBe('Rs 180,000');
    expect(formatPKR(-500)).toBe('-Rs 500');
    expect(formatPKR(500, { showSign: true })).toBe('+Rs 500');
  });

  it('parses integer PKR strings and rejects floats or invalid input', () => {
    expect(parsePKR('1,500')).toBe(1500);
    expect(parsePKR('Rs 500')).toBe(500);
    expect(parsePKR('250.50')).toBeNull();
    expect(parsePKR('-100')).toBeNull();
    expect(parsePKR('')).toBeNull();
  });

  it('throws on non-integer PKR assertions', () => {
    expect(assertIntegerPKR(500)).toBe(500);
    expect(() => assertIntegerPKR(12.5)).toThrow();
    expect(sumPKR([200, 500, 1000])).toBe(1700);
  });
});

describe('Asia/Karachi calendar helpers', () => {
  it('computes Karachi date across UTC midnight boundary (UTC+5)', () => {
    // 2026-01-31T20:30:00Z is 2026-02-01 01:30 PKT
    const boundary = new Date('2026-01-31T20:30:00Z');
    expect(getKarachiToday(boundary)).toBe('2026-02-01');
    expect(getKarachiCurrentMonthStart(boundary)).toBe('2026-02-01');
  });

  it('builds calendar and custom fiscal year ranges accurately', () => {
    expect(buildFiscalYearDefinition(2026, 1)).toEqual({
      label: '2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(buildFiscalYearDefinition(2026, 7)).toEqual({
      label: '2026-27',
      startDate: '2026-07-01',
      endDate: '2027-06-30',
    });
    expect(getMonthsBetween('2026-07-01', '2027-06-30')).toHaveLength(12);
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
  });
});
