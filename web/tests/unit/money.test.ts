import { describe, expect, it } from 'vitest';
import { formatPhp, formatPhpPerUnit } from '@/lib/money';

describe('formatPhp', () => {
  it('formats a server-supplied decimal string as PHP currency', () => {
    expect(formatPhp('3500.00')).toBe('₱3,500.00');
  });

  it('formats a decimal string with cents', () => {
    expect(formatPhp('1999.50')).toBe('₱1,999.50');
  });

  it('throws instead of silently rendering ₱NaN for malformed input', () => {
    // A real bug this guards against: passing a pre-formatted display string
    // (with a currency symbol or thousands separator) back into the
    // formatter, which parseFloat would have silently truncated instead of
    // rejecting.
    expect(() => formatPhp('₱3,500.00')).toThrow(/non-decimal-string/);
  });
});

describe('formatPhpPerUnit', () => {
  it('appends the unit label after the formatted amount', () => {
    expect(formatPhpPerUnit('3500.00', '3 days')).toBe('₱3,500.00 / 3 days');
  });
});
