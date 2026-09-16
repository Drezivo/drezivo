import { z } from 'zod';

/**
 * Money is stored and computed as minor-unit integers (centavos) end to end in the database
 * and in domain logic — TRD §4/§6: "Serialize monetary minor units as decimal strings so
 * JavaScript number limits cannot silently corrupt amounts." The wire boundary is the ONLY
 * place minor units are converted to/from a decimal string. Never use `Float`/`Number` for a
 * monetary amount inside domain code (AGENTS.md).
 */

const MAX_SAFE_MINOR_UNITS = 9_999_999_999; // PHP 99,999,999.99 — generous ceiling, still bounded.

/** Positive-or-zero minor-unit integer, bounded so a corrupt/huge value fails validation, not arithmetic. */
export const minorUnitsSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_SAFE_MINOR_UNITS);

/** Decimal-string wire schema, e.g. "1000.00" for PHP 1,000.00 — exactly two fraction digits. */
export const decimalStringSchema = z
  .string()
  .regex(/^\d{1,10}\.\d{2}$/, 'expected a decimal string with exactly two fraction digits');

export function minorUnitsToDecimalString(minorUnits: number): string {
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(minorUnits);
  const pesos = Math.trunc(abs / 100);
  const centavos = abs % 100;
  return `${sign}${pesos}.${centavos.toString().padStart(2, '0')}`;
}

export function decimalStringToMinorUnits(value: string): number {
  const parsed = decimalStringSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`invalid decimal money string: ${value}`);
  }
  const [pesos, centavos] = parsed.data.split('.');
  return Number(pesos) * 100 + Number(centavos);
}
