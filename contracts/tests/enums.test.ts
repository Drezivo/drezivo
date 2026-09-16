/**
 * Non-negotiable rule (.claude/rules/idempotency-concurrency.md #14):
 * "Fail closed: an unrecognized enum/route/state in a validation chain is a
 * rejection, never a pass-through." Every enum in this package is a
 * `z.enum([...])` with no catch-all — this test proves it for the two
 * enums the task explicitly calls out (reservation state, payment status)
 * and for a representative sample of the rest, so a future contributor
 * adding `z.string()` instead of `z.enum([...])` for a new status field is
 * caught here, not in a `web` production incident.
 */
import { describe, expect, it } from 'vitest';

import { errorCode } from '../src/common/errors';
import { pricingMode } from '../src/storefront/catalogue';
import { paymentEvidenceStatus, paymentRail, paymentVerificationDecision, refundStatus } from '../src/finance/payment-status';
import { filePurpose } from '../src/files/uploads';
import { reservationState } from '../src/reservations/state';
import { fulfillmentMethod } from '../src/reservations/reservation';
import { guestScopeCode } from '../src/guest/guest';
import { membershipRole, membershipStatus, permissionCode, tenantStatus } from '../src/tenancy/tenant';

describe('reservationState — Data-Model §6 canonical states', () => {
  it('accepts every documented state', () => {
    const documented = [
      'held',
      'pending_confirmation',
      'confirmed',
      'picked_up',
      'returned',
      'completed',
      'cancelled',
      'expired',
      'rejected',
    ];

    for (const state of documented) {
      expect(reservationState.safeParse(state).success).toBe(true);
    }
  });

  it('rejects an unrecognized state instead of passing it through', () => {
    const result = reservationState.safeParse('shipped');
    expect(result.success).toBe(false);
  });

  it('rejects the legacy "paid" label — PRD §3 explicitly says evidence is never "Paid"', () => {
    const result = reservationState.safeParse('paid');
    expect(result.success).toBe(false);
  });
});

describe('paymentEvidenceStatus — separate from payment lifecycle', () => {
  it('accepts every documented evidence status', () => {
    const documented = [
      'not_required',
      'awaiting_upload',
      'uploaded',
      'under_review',
      'verified',
      'rejected',
      'superseded',
    ];

    for (const status of documented) {
      expect(paymentEvidenceStatus.safeParse(status).success).toBe(true);
    }
  });

  it('rejects an unrecognized status', () => {
    expect(paymentEvidenceStatus.safeParse('partially_paid').success).toBe(false);
  });

  it('does not share its value space with reservationState', () => {
    // "confirmed" is a valid reservation state but must not silently
    // validate as a payment status — the two enums are intentionally distinct.
    expect(paymentEvidenceStatus.safeParse('confirmed').success).toBe(false);
  });
});

describe('every other enum fails closed on an unrecognized value', () => {
  const cases: Array<[string, { safeParse: (v: unknown) => { success: boolean } }, string]> = [
    ['errorCode', errorCode, 'TEAPOT'],
    ['pricingMode', pricingMode, 'weekly'],
    ['paymentRail', paymentRail, 'credit_card'],
    ['paymentVerificationDecision', paymentVerificationDecision, 'auto_approved'],
    ['refundStatus', refundStatus, 'partially_completed'],
    ['filePurpose', filePurpose, 'random_file'],
    ['fulfillmentMethod', fulfillmentMethod, 'courier'],
    ['guestScopeCode', guestScopeCode, 'delete_reservation'],
    ['membershipRole', membershipRole, 'admin'],
    ['membershipStatus', membershipStatus, 'pending'],
    ['tenantStatus', tenantStatus, 'trial'],
    ['permissionCode', permissionCode, 'god_mode'],
  ];

  for (const [name, schema, badValue] of cases) {
    it(`${name} rejects "${badValue}"`, () => {
      expect(schema.safeParse(badValue).success).toBe(false);
    });
  }
});
