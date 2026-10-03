import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, durationLabel, formatMinor, offsetOf, rentalDays, zonedInstant } from '@/lib/storefront-format';
import { receiptProblem } from '@/lib/receipt-upload';

describe('storefront formatting', () => {
  it('formats centavos exactly, without floating-point drift', () => {
    expect(formatMinor('350000')).toBe('₱3,500');
    expect(formatMinor('15050')).toBe('₱150.50');
    expect(formatMinor('5')).toBe('₱0.05');
    expect(formatMinor('0')).toBe('₱0');
    expect(() => formatMinor('12.5')).toThrow();
    expect(() => formatMinor('-100')).toThrow();
  });

  it('labels rental durations', () => {
    expect(durationLabel('fixed_duration', 4320)).toBe('3 days');
    expect(durationLabel('fixed_duration', 1440)).toBe('1 day');
    expect(durationLabel('daily', 1440)).toBe('per day');
  });

  it('builds handover instants in the store time zone', () => {
    expect(offsetOf('Asia/Manila', '2026-10-14')).toBe('+08:00');
    expect(zonedInstant('2026-10-14', '10:00', 'Asia/Manila')).toBe('2026-10-14T10:00:00+08:00');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-10-14', '2026-10-17')).toBe(3);
  });

  it('rejects receipts of the wrong type or size before uploading', () => {
    expect(receiptProblem(new File(['x'], 'r.png', { type: 'image/png' }))).toBeNull();
    expect(receiptProblem(new File(['x'], 'r.gif', { type: 'image/gif' }))).toMatch(/JPG, PNG, WebP, or PDF/);
    expect(receiptProblem(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'r.pdf', { type: 'application/pdf' }))).toMatch(/10 MB/);
  });

  it('counts rental days with the pickup date as Day 1', () => {
    // Owner rule: Oct 1 pickup, Oct 2 event, Oct 3 return is a 3-day rental.
    expect(rentalDays('2026-10-01', '2026-10-03')).toBe(3);
    expect(rentalDays('2026-10-05', '2026-10-06')).toBe(2);
    expect(rentalDays('2026-12-31', '2027-01-02')).toBe(3);
  });
});
