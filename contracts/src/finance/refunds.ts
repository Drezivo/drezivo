/**
 * TRD §4 `/refunds` POST — "Owner capability, locked residual amount,
 * immutable reversal record." TRD §6 — "A manual refund is an instruction
 * plus a verified completion record. Double-clicking cannot create another
 * instruction." Data-Model §7 balance formula: `U = P − A − H − R` must
 * stay nonnegative — the amount here is validated against that residual
 * server-side, never trusted from the client (this request carries only
 * the requested amount, not a computed "remaining balance").
 */
import { z } from 'zod';

import { currencyCode, nonNegativeMoneyString } from '../common/money';
import { paymentId, refundId } from '../common/ids';
import { isoInstant } from '../common/time';
import { refundStatus } from './payment-status';

/** Data-Model §7 posting meanings — what the refunded money is being returned for. */
export const refundPurpose = z.enum([
  'rental_refund',
  'security_deposit_release',
  'goodwill_adjustment',
  'fitting_fee_refund',
]);
export type RefundPurpose = z.infer<typeof refundPurpose>;

/** POST /refunds request body. Requires `Idempotency-Key`. */
export const refundCreateRequest = z.object({
  payment_id: paymentId,
  amount_minor: nonNegativeMoneyString.refine((value) => BigInt(value) > 0n, {
    message: 'refund amount must be greater than zero',
  }),
  currency: currencyCode,
  purpose: refundPurpose,
  reason: z.string().trim().min(1).max(500),
});
export type RefundCreateRequest = z.infer<typeof refundCreateRequest>;

export const refundSummary = z.object({
  id: refundId,
  payment_id: paymentId,
  amount_minor: nonNegativeMoneyString,
  currency: currencyCode,
  purpose: refundPurpose,
  status: refundStatus,
  merchant_reference: z.string().nullable(),
  completed_at: isoInstant.nullable(),
});
export type RefundSummary = z.infer<typeof refundSummary>;

export const refundCreateResponse = z.object({ refund: refundSummary });
export type RefundCreateResponse = z.infer<typeof refundCreateResponse>;

/**
 * V1 manual-refund resolution. Drezivo does not execute the external transfer; an authorized
 * Owner records the observed outcome after handling it outside the platform. Failed/cancelled
 * instructions release their reserved refundable balance but remain immutable history.
 */
export const refundResolveRequest = z
  .object({
    status: z.enum(['completed', 'failed', 'cancelled']),
    merchant_reference: z.string().trim().min(1).max(200).optional(),
    resolution_note: z.string().trim().min(1).max(500),
  })
  .strict();
export type RefundResolveRequest = z.infer<typeof refundResolveRequest>;

export const refundResolveResponse = z.object({ refund: refundSummary }).strict();
export type RefundResolveResponse = z.infer<typeof refundResolveResponse>;
