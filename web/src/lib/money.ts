/**
 * PHP money formatting. Decimal strings in, formatted PHP text out — never
 * `parseFloat`. Drezivo-TRD.md §4 API contract: "Serialize monetary minor
 * units as decimal strings so JavaScript number limits cannot silently
 * corrupt amounts." The server is the only source of truth for amounts; this
 * module only formats what the server already computed. It never adds,
 * multiplies, or otherwise recomputes a price — recomputing client-side risks
 * silently drifting from the server's figure through binary floating-point
 * rounding, and the server must always be the one that recalculates money
 * (Drezivo-PRD.md §3: "Server recalculates money, quantities, eligibility,
 * and scope").
 */

const PHP_DECIMAL_STRING_PATTERN = /^-?\d+(\.\d{1,2})?$/;

const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a server-supplied decimal string (e.g. "3500.00") as PHP currency
 * (e.g. "₱3,500.00"). Throws on malformed input rather than silently
 * rendering "₱NaN" — a broken price display must fail loudly, never quietly
 * mislead a customer about what they owe.
 */
export function formatPhp(decimalString: string): string {
  if (!PHP_DECIMAL_STRING_PATTERN.test(decimalString)) {
    throw new Error(`formatPhp received a non-decimal-string value: "${decimalString}"`);
  }

  // Intl.NumberFormat requires a JS number, but the input was already
  // validated as a short, exact decimal string above — this is a display
  // conversion, not an arithmetic operation, so it cannot corrupt a stored
  // amount the way parseFloat + reuse in a calculation could.
  return PHP_FORMATTER.format(Number(decimalString));
}

/** Renders an amount with a unit label, e.g. "₱3,500.00 / 3 days". */
export function formatPhpPerUnit(decimalString: string, unitLabel: string): string {
  return `${formatPhp(decimalString)} / ${unitLabel}`;
}
