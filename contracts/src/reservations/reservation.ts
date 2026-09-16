/**
 * Data-Model §2 entity dictionary — `reservation`. This is the shared
 * response projection reused by the hold, staff-create, and every state-
 * transition endpoint, so a client never has to reconcile five
 * near-identical-but-not-quite reservation shapes.
 */
import { z } from 'zod';

import { currencyCode, moneyString } from '../common/money';
import { branchId, paymentMethodId, productVariantId, reservationId, storefrontId } from '../common/ids';
import { ianaTimezone, isoDate, isoInstant } from '../common/time';
import { reservationState } from './state';

/** PRD §4: "optional pickup/delivery" — the customer's chosen fulfillment method. */
export const fulfillmentMethod = z.enum(['pickup', 'delivery']);
export type FulfillmentMethod = z.infer<typeof fulfillmentMethod>;

/**
 * PRD §4 FR19 — "Details captures minimum name, phone, email." PRD §3: "On
 * Continue to payment, one transaction validates fields, selects an asset,
 * and creates an exclusive held reservation" — contact is captured on the
 * SAME form as the hold, not a later step. Email is required (Data-Model §2
 * customer: "guest checkout requires email"); the reservation ROW may still
 * persist without a linked customer for a shorter-lived internal hold state
 * (Data-Model §6: "An anonymous short hold may lack a customer row/
 * contact") — that is a storage detail `api` owns, not a wire shape this
 * contract needs to model separately.
 */
export const customerDetails = z.object({
  full_name: z.string().min(1).max(200),
  phone: z.string().min(1).max(32).optional(),
  email: z.string().email(),
});
export type CustomerDetails = z.infer<typeof customerDetails>;

/**
 * Shared by every projection of a reservation's money (this module's
 * `reservationSummary` and the guest module's `guestReservationView`) so
 * the two views cannot silently diverge on what a "price snapshot" contains.
 */
export const reservationMoneySnapshot = z.object({
  rental_total_minor: moneyString,
  security_required_minor: moneyString,
  due_now_minor: moneyString,
  currency: currencyCode,
});
export type ReservationMoneySnapshot = z.infer<typeof reservationMoneySnapshot>;

/**
 * Shared reservation projection returned by every endpoint in this module.
 * All money and policy fields are the immutable snapshot taken at hold time
 * (TRD §5: "Store the resulting price/policy snapshot; editing a catalogue
 * price never rewrites an accepted rental") — never re-derived from the
 * current catalogue price.
 */
export const reservationSummary = z.object({
  id: reservationId,
  reference_code: z.string().min(1),
  status: reservationState,
  branch_id: branchId,
  storefront_id: storefrontId,
  variant_id: productVariantId,
  payment_method_id: paymentMethodId,
  fulfillment_method: fulfillmentMethod,
  pickup_at: isoInstant,
  due_at: isoInstant,
  timezone_snapshot: ianaTimezone,
  event_date: isoDate.optional(),
  price_snapshot: reservationMoneySnapshot,
  hold_expires_at: isoInstant.nullable(),
  /** Optimistic-concurrency token (Data-Model §2 `reservation.version`). Every
   *  state-changing request in this module echoes back the version it read,
   *  so the server can reject a stale transition with `STATE_CONFLICT`
   *  instead of silently applying an action against outdated context. */
  version: z.number().int().nonnegative(),
  created_at: isoInstant,
  updated_at: isoInstant,
});
export type ReservationSummary = z.infer<typeof reservationSummary>;
