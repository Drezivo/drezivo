/**
 * Reservation intake contracts. Public guest holds and authenticated
 * staff/walk-in creation converge on the same allocator/pricing domain path,
 * but their customer-input rules differ intentionally.
 */
import { z } from 'zod';

import { customerId, paymentMethodId, productVariantId } from '../common/ids';
import { instantInterval, isoDate, isoInstant } from '../common/time';
import {
  customerDetails,
  fulfillmentMethod,
  reservationSummary,
  staffCustomerDetails,
} from './reservation';

/** POST /public/stores/{slug}/holds request body. */
export const holdIntentRequest = z
  .object({
    variant_id: productVariantId,
    requested_interval: instantInterval,
    event_date: isoDate.optional(),
    fulfillment_method: fulfillmentMethod,
    payment_method_id: paymentMethodId,
    contact: customerDetails,
  })
  .strict();
export type HoldIntentRequest = z.infer<typeof holdIntentRequest>;

/** Raw guest capability is returned once; persistence stores only its hash. */
export const guestAccessGrant = z
  .object({
    token: z.string().min(16),
    expires_at: isoInstant,
  })
  .strict();
export type GuestAccessGrant = z.infer<typeof guestAccessGrant>;

export const paymentInstructions = z
  .object({
    method_name: z.string().trim().min(1),
    rail: z.enum(['cash', 'manual_qr', 'manual_transfer']),
    qr_image_url: z.string().url().optional(),
    destination_note: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type PaymentInstructions = z.infer<typeof paymentInstructions>;

export const holdIntentResponse = z
  .object({
    reservation: reservationSummary,
    guest_access: guestAccessGrant,
    payment_instructions: paymentInstructions,
  })
  .strict();
export type HoldIntentResponse = z.infer<typeof holdIntentResponse>;

/** Staff selects either an existing customer or enters a new one, never both. */
export const staffReservationCustomerInput = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('existing'),
      customer_id: customerId,
    })
    .strict(),
  z
    .object({
      source: z.literal('new'),
      customer: staffCustomerDetails,
    })
    .strict(),
]);
export type StaffReservationCustomerInput = z.infer<typeof staffReservationCustomerInput>;

/**
 * POST /reservations request body. Tenant, branch, final totals, chosen asset,
 * allocation IDs, snapshots, and server lifecycle state are deliberately absent.
 */
export const staffReservationCreateRequest = z
  .object({
    customer: staffReservationCustomerInput,
    variant_id: productVariantId,
    requested_interval: instantInterval,
    event_date: isoDate.optional(),
    fulfillment_method: fulfillmentMethod,
    payment_method_id: paymentMethodId,
  })
  .strict();
export type StaffReservationCreateRequest = z.infer<typeof staffReservationCreateRequest>;

export const staffReservationCreateResponse = z
  .object({
    reservation: reservationSummary,
    payment_instructions: paymentInstructions,
  })
  .strict();
export type StaffReservationCreateResponse = z.infer<typeof staffReservationCreateResponse>;
