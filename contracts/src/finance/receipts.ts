/**
 * TRD §4 `/guest/reservations/{id}/receipts` POST — "Scoped capability;
 * immutable uploaded object; idempotency." TRD §7 — "a successful upload is
 * not automatically immutable: finalize against an exact object version/
 * checksum." The `file_id` referenced here must already be an authorized,
 * finalized upload from the `files` module — this endpoint never accepts
 * raw bytes itself.
 */
import { z } from 'zod';

import { currencyCode, moneyString } from '../common/money';
import { fileObjectId, paymentId, paymentMethodId, paymentReceiptId, reservationId } from '../common/ids';
import { isoInstant } from '../common/time';
import { paymentEvidenceStatus, paymentRail, paymentStatus } from './payment-status';

/** POST /guest/reservations/{id}/receipts request body. Requires `Idempotency-Key`. */
export const paymentReceiptSubmitRequest = z.object({
  payment_id: paymentId,
  file_id: fileObjectId,
});
export type PaymentReceiptSubmitRequest = z.infer<typeof paymentReceiptSubmitRequest>;

export const paymentReceiptSummary = z.object({
  id: paymentReceiptId,
  payment_id: paymentId,
  submitted_at: isoInstant,
});
export type PaymentReceiptSummary = z.infer<typeof paymentReceiptSummary>;

export const paymentReceiptSubmitResponse = z.object({
  receipt: paymentReceiptSummary,
  /** Reflects the payment's status immediately after this submission — `uploaded`
   *  or `under_review`, never `verified` (TRD §5: "A screenshot alone is insufficient"). */
  payment_evidence_status: paymentEvidenceStatus,
});
export type PaymentReceiptSubmitResponse = z.infer<typeof paymentReceiptSubmitResponse>;

/**
 * Shared payment projection for guest/staff views (Data-Model §2 `payment`).
 * `merchant_reference` and `verified_at` are `null` until a decision is
 * recorded — never inferred from `status` alone on the client.
 */
export const paymentSummary = z.object({
  id: paymentId,
  reservation_id: reservationId,
  payment_method_id: paymentMethodId,
  rail: paymentRail,
  amount_minor: moneyString,
  currency: currencyCode,
  status: paymentStatus,
  merchant_reference: z.string().nullable(),
  verified_at: isoInstant.nullable(),
});
export type PaymentSummary = z.infer<typeof paymentSummary>;
