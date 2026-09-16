/**
 * TRD §4 — "Serialize monetary minor units as decimal strings so JavaScript
 * number limits cannot silently corrupt amounts." This is the falsification
 * test for that requirement: prove a value ABOVE Number.MAX_SAFE_INTEGER
 * survives a wire round trip unchanged, which is impossible if the value
 * ever passes through a JS `number`.
 */
import { describe, expect, it } from 'vitest';

import { fromMoneyMinor, moneyAmount, moneyString, nonNegativeMoneyString, toMoneyMinor } from '../src/common/money';

describe('moneyString', () => {
  it('accepts a value above Number.MAX_SAFE_INTEGER and round-trips it exactly', () => {
    // 2^53 - 1 = 9_007_199_254_740_991. One above the safe integer boundary.
    const aboveSafeInteger = '9007199254740993';

    const parsed = moneyString.parse(aboveSafeInteger);
    const minor = toMoneyMinor(parsed);
    const backToWire = fromMoneyMinor(minor);

    expect(backToWire).toBe(aboveSafeInteger);
    // If this had ever touched a JS number, precision would be lost here.
    expect(Number(aboveSafeInteger)).toBe(9007199254740992);
  });

  it('rejects a decimal-point amount, because the value is already minor units', () => {
    expect(() => moneyString.parse('19.99')).toThrow();
  });

  it('rejects a leading zero other than a bare "0"', () => {
    expect(() => moneyString.parse('0199')).toThrow();
  });

  it('accepts a negative amount for reversal/credit rows', () => {
    expect(moneyString.parse('-500')).toBe('-500');
  });

  it('rejects a JS-number-shaped scientific notation string', () => {
    expect(() => moneyString.parse('1e21')).toThrow();
  });
});

describe('nonNegativeMoneyString', () => {
  it('rejects a negative amount', () => {
    expect(() => nonNegativeMoneyString.parse('-1')).toThrow();
  });

  it('accepts zero', () => {
    expect(nonNegativeMoneyString.parse('0')).toBe('0');
  });
});

describe('moneyAmount', () => {
  it('requires both amount and currency together', () => {
    const result = moneyAmount.safeParse({ amount_minor: '300000' });
    expect(result.success).toBe(false);
  });

  it('parses a valid PHP amount', () => {
    // PRD §1 — the Professional plan: ₱499.00 = 49900 minor units.
    const parsed = moneyAmount.parse({ amount_minor: '49900', currency: 'PHP' });
    expect(parsed).toEqual({ amount_minor: '49900', currency: 'PHP' });
  });
});
