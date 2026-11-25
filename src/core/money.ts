/**
 * Integer PKR currency utilities.
 * All amounts in Anjuman Khata are integer Pakistani Rupees — floats are forbidden.
 */

export function assertIntegerPKR(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer PKR amount (got ${value})`);
  }
  return value;
}

/**
 * Formats an integer PKR amount as `Rs 1,500` (or `-Rs 1,500` if negative).
 * Uses deterministic grouping so output is identical across Android Hermes & iOS JSC.
 */
export function formatPKR(amount: number, options?: { showSign?: boolean }): string {
  const intVal = Math.trunc(Number.isFinite(amount) ? amount : 0);
  const abs = Math.abs(intVal);
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (intVal < 0) {
    return `-Rs ${formatted}`;
  }
  if (options?.showSign && intVal > 0) {
    return `+Rs ${formatted}`;
  }
  return `Rs ${formatted}`;
}

/**
 * Parses a user-entered string (allowing commas, spaces, or Rs prefix) into a strict integer.
 * Returns null if invalid or fractional.
 */
export function parsePKR(input: string): number | null {
  const cleaned = input.replace(/Rs\.?/gi, '').replace(/[,\s]/g, '').trim();
  if (!cleaned || !/^\d+$/.test(cleaned)) {
    return null;
  }
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function sumPKR(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    total += assertIntegerPKR(v);
  }
  return total;
}
