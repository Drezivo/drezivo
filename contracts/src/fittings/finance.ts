/** Fitting-fee finance commands reuse the canonical payment/evidence domain. */
import { z } from 'zod';

import { fileObjectId, paymentId, paymentMethodId, paymentReceiptId } from '../common/ids';
import { moneyString } from '../common/money';
import { isoInstant } from '../common/time';
import { fittingDetail } from './fitting';

const positiveMoneyString = moneyString.refine((value) => BigInt(value) > 0n, {
  message: 'must be a positive integer minor-unit amount',
});

/** Create the one canonical pending payment intent for a positive fitting-fee obligation. */
export const fittingPaymentIntentCreateRequest = z
  .object({
    payment_method_id: paymentMethodId,
  })
  .strict();
export type FittingPaymentIntentCreateRequest = z.infer<typeof fittingPaymentIntentCreateRequest>;

export const fittingPaymentIntentCreateResponse = z
  .object({
    fitting: fittingDetail,
  })
  .strict();
export type FittingPaymentIntentCreateResponse = z.infer<typeof fittingPaymentIntentCreateResponse>;

/** Attach already-finalized immutable payment evidence without changing payment collection state. */
export const fittingPaymentReceiptAttachRequest = z
  .object({
    file_id: fileObjectId,
  })
  .strict();
export type FittingPaymentReceiptAttachRequest = z.infer<typeof fittingPaymentReceiptAttachRequest>;

export const fittingPaymentReceiptAttachResponse = z
  .object({
    fitting: fittingDetail,
    receipt_id: paymentReceiptId,
    payment_id: paymentId,
    evidence_status: z.literal('uploaded'),
  })
  .strict();
export type FittingPaymentReceiptAttachResponse = z.infer<typeof fittingPaymentReceiptAttachResponse>;

/**
 * Explicit staff verification of actual collection. This command mutates finance only; it never
 * confirms or otherwise changes the fitting appointment lifecycle.
 */
export const fittingPaymentVerifyRequest = z
  .object({
    verified_amount_minor: positiveMoneyString,
    merchant_reference: z.string().trim().min(1).max(200).optional(),
    cash_tendered_minor: positiveMoneyString.optional(),
  })
  .strict();
export type FittingPaymentVerifyRequest = z.infer<typeof fittingPaymentVerifyRequest>;

export const fittingPaymentVerifyResponse = z
  .object({
    fitting: fittingDetail,
    payment_id: paymentId,
    payment_status: z.literal('paid'),
    verified_amount_minor: positiveMoneyString,
    verified_at: isoInstant,
  })
  .strict();
export type FittingPaymentVerifyResponse = z.infer<typeof fittingPaymentVerifyResponse>;
