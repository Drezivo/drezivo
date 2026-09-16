/**
 * Money on the wire is always a decimal string (TRD §4: "serialize monetary minor units as
 * decimal strings so JavaScript number limits cannot silently corrupt amounts"). This
 * module is the only place in the app allowed to turn that string into a JS number, and
 * only for display formatting — never for arithmetic, and never with `parseFloat`.
 * `parseFloat` is banned repo-wide by eslint.config.mjs; it silently accepts garbage like
 * "1500.00-drop-table" -> 1500. A strict regex fails closed instead.
 *
 * Any arithmetic (sums shown in a UI summary) happens in integer centavo space via BigInt
 * so repeated additions cannot accumulate float error.
 */

const DECIMAL_STRING = /^-?\d+(\.\d{1,2})?$/;

export class InvalidMoneyStringError extends Error {
  constructor(value: string) {
    super(`"${value}" is not a valid decimal money string (expected e.g. "1500.00").`);
    this.name = "InvalidMoneyStringError";
  }
}

function assertValidDecimalString(value: string): void {
  if (!DECIMAL_STRING.test(value)) {
    throw new InvalidMoneyStringError(value);
  }
}

/** Format a decimal-string PHP amount for display, e.g. "1500" -> "₱1,500.00". */
export function formatPhp(amount: string): string {
  assertValidDecimalString(amount);
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

/** Exact decimal-string addition, e.g. addPhp("1500.00", "2000.00") -> "3500.00". */
export function addPhp(a: string, b: string): string {
  assertValidDecimalString(a);
  assertValidDecimalString(b);
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b));
}

/** Exact decimal-string subtraction, e.g. subtractPhp("2000.00", "750.50") -> "1249.50". */
export function subtractPhp(a: string, b: string): string {
  assertValidDecimalString(a);
  assertValidDecimalString(b);
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

/** -1 if a < b, 0 if equal, 1 if a > b — for sorting/validating without going through Number. */
export function comparePhp(a: string, b: string): -1 | 0 | 1 {
  assertValidDecimalString(a);
  assertValidDecimalString(b);
  const diff = toMinorUnits(a) - toMinorUnits(b);
  if (diff === 0n) return 0;
  return diff > 0n ? 1 : -1;
}

function toMinorUnits(amount: string): bigint {
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole, fraction = ""] = unsigned.split(".");
  const paddedFraction = (fraction + "00").slice(0, 2);
  const minorUnits = BigInt(whole) * 100n + BigInt(paddedFraction || "0");
  return negative ? -minorUnits : minorUnits;
}

function fromMinorUnits(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const abs = negative ? -minorUnits : minorUnits;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
