import { describe, expect, it } from 'vitest';

import { guestQuote, guestQuoteRequest, guestReservationRequest } from '../src';

const quote = {
  rental_total_minor: '230000', security_required_minor: '200000', delivery_total_minor: '0',
  due_now_minor: '430000', currency: 'PHP',
};
const input = {
  variant_id: '0194f6a2-9dd6-7a4c-8e9f-142f1d310001',
  requested_interval: { start: '2026-12-01T02:00:00Z', end: '2026-12-04T02:00:00Z' },
  event_date: null, fulfillment_method: 'pickup', payment_method_id: '0194f6a2-9dd6-7a4c-8e9f-142f1d310002',
};

describe('guest price confirmation contracts', () => {
  it('accepts a minimal quote request and nonnegative integer amounts', () => {
    expect(guestQuoteRequest.safeParse(input).success).toBe(true);
    expect(guestQuote.safeParse(quote).success).toBe(true);
    expect(guestQuote.safeParse({ ...quote, due_now_minor: '-1' }).success).toBe(false);
    expect(guestQuote.safeParse({ ...quote, currency: 'USD' }).success).toBe(false);
    expect(guestQuoteRequest.safeParse({ ...input, email: 'guest@example.test' }).success).toBe(false);
  });

  it('accepts an expected quote while keeping old clients compatible', () => {
    const hold = {
      ...input, email: 'guest@example.test',
      customer: { full_name: 'Test Guest', phone: null, address: 'Test address', social_handle: null },
    };
    expect(guestReservationRequest.safeParse(hold).success).toBe(true);
    expect(guestReservationRequest.safeParse({ ...hold, expected_quote: quote }).success).toBe(true);
    expect(guestReservationRequest.safeParse({ ...hold, expected_quote: { ...quote, due_now_minor: '-1' } }).success).toBe(false);
  });
});
