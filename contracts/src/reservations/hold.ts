/**
 * TRD §4 `/public/stores/{slug}/holds` POST — "Rate-limited anonymous
 * checkout identity + idempotency; database capacity claim."
 * TRD §5 "Hold transaction" — "Validate published storefront, active
 * tenant entitlement, branch, dates and input. Compute price and due-now
 * amount; ignore client-sent totals... Commit the guest capability hash,
 * idempotency outcome and relevant outbox records. Only now return payment
 * instructions and the 15-minute expiry."
 *
 * Request and response are deliberately separate types (never a shared
 * "money total" field on the request) — the server is the only source of
 * `price_snapshot`; a client cannot submit one.
 */
import { z } from 'zod';

import { paymentMethodId, productVariantId } from '../common/ids';
import { instantInterval, isoDate, isoInstant } from '../common/time';
import { customerDetails, fulfillmentMethod, reservationSummary } from './reservation';

/** POST /public/stores/{slug}/holds request body. Requires `Idempotency-Key` (see common/idempotency.ts). */
export const holdIntentRequest = z.object({
  variant_id: productVariantId,
  requested_interval: instantInterval,
  event_date: isoDate.optional(),
  fulfillment_method: fulfillmentMethod,
  payment_method_id: paymentMethodId,
  contact: customerDetails,
});
export type HoldIntentRequest = z.infer<typeof holdIntentRequest>;

/**
 * Data-Model §2 `guest_access_token` — "High entropy bearer secret only
 * returned once, hash stored; scopes allowlisted per state." This is the
 * ONE time the raw token is ever transmitted; every later guest request
 * presents it, the server never re-displays it.
 */
export const guestAccessGrant = z.object({
  token: z.string().min(16),
  expires_at: isoInstant,
});
export type GuestAccessGrant = z.infer<typeof guestAccessGrant>;

const paymentInstructions = z.object({
  method_name: z.string().min(1),
  rail: z.enum(['cash', 'manual_qr', 'manual_transfer']),
  qr_image_url: z.string().url().optional(),
  destination_note: z.string().optional(),
});

/** POST /public/stores/{slug}/holds response body (wrapped in the success envelope). */
export const holdIntentResponse = z.object({
  reservation: reservationSummary,
  guest_access: guestAccessGrant,
  payment_instructions: paymentInstructions,
});
export type HoldIntentResponse = z.infer<typeof holdIntentResponse>;

/**
 * TRD §4 `/reservations` POST — "Membership; same quote/hold logic as
 * storefront." A staff walk-in is the same allocator and pricing path as
 * the public hold, plus an authenticated actor instead of a guest
 * capability grant, so it reuses `holdIntentRequest`'s fields and simply
 * skips issuing a `guest_access` grant in the response.
 */
export const staffReservationCreateRequest = holdIntentRequest;
export type StaffReservationCreateRequest = z.infer<typeof staffReservationCreateRequest>;

export const staffReservationCreateResponse = z.object({
  reservation: reservationSummary,
  payment_instructions: paymentInstructions,
});
export type StaffReservationCreateResponse = z.infer<typeof staffReservationCreateResponse>;
