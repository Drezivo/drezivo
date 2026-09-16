/**
 * TRD §4 — `/public/stores/{slug}/availability` GET: "No customer details;
 * short-lived answer, never a guarantee." TRD §5 — "An availability
 * response can lag; a hold cannot bypass the database constraint."
 *
 * This is intentionally a preview, not a reservation. The response's
 * `price_preview` mirrors what the merchant currently charges but is NOT
 * the price that gets stored on a hold — the hold transaction recomputes
 * and snapshots price/policy server-side regardless of what this endpoint
 * last answered (TRD §5 "Store the resulting price/policy snapshot").
 */
import { z } from 'zod';

import { currencyCode, moneyString } from '../common/money';
import { productVariantId } from '../common/ids';
import { instantInterval } from '../common/time';

/** GET /public/stores/{slug}/availability query params. */
export const availabilityQuery = z.object({
  variant_id: productVariantId,
  requested_interval: instantInterval,
});
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;

const pricePreview = z.object({
  rental_minor: moneyString,
  security_deposit_minor: moneyString,
  due_now_minor: moneyString,
  currency: currencyCode,
});

export const availabilityResult = z.object({
  variant_id: productVariantId,
  requested_interval: instantInterval,
  available: z.boolean(),
  /** Present only when `available` is true — there is nothing to price otherwise. */
  price_preview: pricePreview.nullable(),
});
export type AvailabilityResult = z.infer<typeof availabilityResult>;
