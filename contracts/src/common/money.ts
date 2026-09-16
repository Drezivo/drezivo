/**
 * TRD §4 — "Serialize monetary minor units as decimal strings so JavaScript
 * number limits cannot silently corrupt amounts."
 * Data-Model §2 — "Money uses nonnegative bigint minor units and explicit currency."
 *
 * A JS `number` is an IEEE-754 double: integers above 2^53 - 1
 * (Number.MAX_SAFE_INTEGER) lose precision. A ₱1,299.00 subscription charge
 * is nowhere near that limit, but a rental's cumulative minor-unit ledger
 * (charges + allocations + refunds, all summed) is exactly the kind of value
 * that must never be forced through a JS number, on the wire or in a client
 * that re-sums it. So money crosses the wire as a decimal STRING of integer
 * minor units, and every consumer parses it with a decimal-safe library
 * (BigInt, or a decimal library) — never `parseFloat`/`Number()`.
 */
import { z } from 'zod';

/**
 * Branded type for a monetary amount already converted to integer minor
 * units (e.g. centavos). Branding prevents a raw `number` — which could be
 * a major-unit float like `19.99` — from being passed where minor units are
 * required. Construct one only via `toMoneyMinor`.
 */
export type MoneyMinor = bigint & { readonly __brand: 'MoneyMinor' };

/**
 * Converts a validated decimal-string minor-unit amount to the branded
 * internal type. Callers must validate with `moneyString` (or
 * `nonNegativeMoneyString`) first — this function does not re-validate.
 */
export function toMoneyMinor(value: string): MoneyMinor {
  return BigInt(value) as MoneyMinor;
}

/** Renders a branded amount back to the wire's decimal-string form. */
export function fromMoneyMinor(value: MoneyMinor): string {
  return value.toString();
}

/**
 * Wire schema for a signed integer minor-unit amount: an optional leading
 * `-`, followed by one or more digits. No decimal point — the value is
 * ALREADY in minor units (centavos), not major units (pesos). No leading
 * zeros beyond a bare "0", no exponents, no whitespace.
 */
export const moneyString = z
  .string()
  .regex(/^-?(0|[1-9]\d*)$/, 'must be an integer minor-unit amount as a decimal string');

/**
 * Data-Model §7 — charges, allocations and collected payments are bounded
 * nonnegative amounts; only reversal/credit rows carry sign. Use this schema
 * wherever the domain forbids a negative amount.
 */
export const nonNegativeMoneyString = moneyString.regex(
  /^(0|[1-9]\d*)$/,
  'must be a nonnegative integer minor-unit amount as a decimal string',
);

/**
 * ISO 4217 alphabetic currency code. TRD/PRD scope V1 to PHP only, but the
 * wire shape is not hardcoded to PHP so a later market does not require a
 * breaking change — see Data-Model §1 tenant.currency.
 */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 currency code');

/**
 * The shape every money-carrying field uses together: amount in minor
 * units plus its currency. Never send a bare amount without its currency
 * — Data-Model §7 requires currency equality checks on every financial
 * cross-row link, which is impossible if currency is implicit.
 */
export const moneyAmount = z.object({
  amount_minor: moneyString,
  currency: currencyCode,
});
export type MoneyAmount = z.infer<typeof moneyAmount>;
