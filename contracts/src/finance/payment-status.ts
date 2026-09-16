/**
 * PRD §3 — "Payment evidence is independent: not_required, awaiting_upload,
 * uploaded, under_review, verified, rejected, superseded. Uploaded evidence
 * is never Paid." Data-Model §7 — `payment` is "a guarded mutable intent;
 * verified amount/currency/reference become immutable."
 *
 * `paymentEvidenceStatus` is deliberately separate from the payment lifecycle and `reservationState`
 * (reservations/state.ts) — a reservation can be `pending_confirmation`
 * while its evidence is `under_review`, or `confirmed` while a later
 * clarification payment is `awaiting_upload`. Conflating the two would make
 * "payment received but reservation not yet reviewed" unrepresentable.
 */
import { z } from 'zod';

export const paymentEvidenceStatus = z.enum([
  'not_required',
  'awaiting_upload',
  'uploaded',
  'under_review',
  'verified',
  'rejected',
  'superseded',
]);
export type PaymentEvidenceStatus = z.infer<typeof paymentEvidenceStatus>;

/** Data-Model §7 — the payment money lifecycle, independent from evidence review. */
export const paymentStatus = z.enum(['pending', 'partially_paid', 'paid', 'failed', 'refunded']);
export type PaymentStatus = z.infer<typeof paymentStatus>;

/**
 * Data-Model §2 `payment_method.rail`. The rail selected at hold time
 * (reservations/hold.ts `paymentInstructions.rail`) determines which
 * evidence flow applies — cash never has an uploaded proof; QR/transfer do.
 */
export const paymentRail = z.enum(['cash', 'manual_qr', 'manual_transfer']);
export type PaymentRail = z.infer<typeof paymentRail>;

/**
 * Data-Model §2 `payment_verification.decision`. PRD §4: "Reject/ask-info
 * is audited; asking for information cannot extend the maximum deadline."
 */
export const paymentVerificationDecision = z.enum(['verified', 'rejected', 'ask_info']);
export type PaymentVerificationDecision = z.infer<typeof paymentVerificationDecision>;

/**
 * Data-Model §7 `refund.status` / falsification §11 — "requested/
 * processing/completed/failed/cancelled." Pending instructions reserve
 * capacity immediately; only `completed` means money actually returned.
 */
export const refundStatus = z.enum(['requested', 'processing', 'completed', 'failed', 'cancelled']);
export type RefundStatus = z.infer<typeof refundStatus>;
