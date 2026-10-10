/** Guest booking from a published storefront. Guests do not need accounts or email verification. */
import { z } from 'zod';

import { customerSocialMedia } from '../common/customer';
import { fileObjectId, fittingId, paymentMethodId, productVariantId, reservationId } from '../common/ids';
import { moneyString } from '../common/money';
import { instantInterval, isoDate, isoInstant } from '../common/time';
import { fulfillmentMethod, reservationState } from '../reservations';
import { MAX_RESERVATION_LINES, paymentInstructions } from '../reservations/hold';

const guestEmail = z.string().trim().toLowerCase().email().max(254);
const turnstileToken = z.string().trim().min(1).max(2_048).optional();

export const guestCustomer = z
  .object({
    full_name: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(/^\d{11}$/, 'enter an 11-digit mobile number').nullable(),
    address: z.string().trim().min(5).max(500),
    social_handle: customerSocialMedia.nullable(),
  })
  .strict();
export type GuestCustomer = z.infer<typeof guestCustomer>;

/** POST /public/stores/{slug}/holds. Send an `Idempotency-Key` header. */
export const guestReservationRequest = z
  .object({
    turnstile_token: turnstileToken,
    email: guestEmail,
    customer: guestCustomer,
    variant_id: productVariantId,
    /** More pieces for the same dates; each gets its own free piece or the whole request is refused. */
    additional_variant_ids: z.array(productVariantId).max(MAX_RESERVATION_LINES - 1).optional(),
    requested_interval: instantInterval,
    event_date: isoDate.nullable(),
    fulfillment_method: fulfillmentMethod,
    payment_method_id: paymentMethodId,
  })
  .strict();
export type GuestReservationRequest = z.infer<typeof guestReservationRequest>;

export const guestReservationView = z
  .object({
    id: reservationId,
    reference_code: z.string().min(1),
    status: reservationState,
    item_name: z.string(),
    size_label: z.string().nullable(),
    /** Every piece on the booking in order; `item_name` and `size_label` describe the first. */
    items: z
      .array(z.object({ name: z.string(), size_label: z.string().nullable() }).strict())
      .max(MAX_RESERVATION_LINES)
      .optional(),
    fulfillment_method: fulfillmentMethod,
    pickup_at: isoInstant,
    due_at: isoInstant,
    hold_expires_at: isoInstant.nullable(),
    receipt_submitted: z.boolean(),
    money: z
      .object({
        rental_total_minor: moneyString,
        security_required_minor: moneyString,
        delivery_total_minor: moneyString,
        due_now_minor: moneyString,
      })
      .strict(),
    payment_instructions: paymentInstructions.nullable(),
  })
  .strict();
export type GuestReservationView = z.infer<typeof guestReservationView>;

/** The capability is delivered only as an HttpOnly cookie, never in this JSON response. */
export const guestReservationCreated = z
  .object({
    reservation: guestReservationView,
    access_expires_at: isoInstant,
  })
  .strict();
export type GuestReservationCreated = z.infer<typeof guestReservationCreated>;

/** POST /guest/reservations/{id}/uploads. Receipt images or PDF up to 10 MB. */
export const guestReceiptUploadRequest = z
  .object({
    content_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    byte_size: z.number().int().min(1).max(10 * 1024 * 1024),
    sha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'must be a base64 SHA-256 digest'),
  })
  .strict();
export type GuestReceiptUploadRequest = z.infer<typeof guestReceiptUploadRequest>;

export const guestReceiptUploadResponse = z
  .object({
    file_id: fileObjectId,
    upload_url: z.string().url(),
    required_headers: z.record(z.string(), z.string()),
    expires_at: isoInstant,
  })
  .strict();
export type GuestReceiptUploadResponse = z.infer<typeof guestReceiptUploadResponse>;

/** POST /guest/reservations/{id}/receipts. Send an `Idempotency-Key` header. */
export const guestReceiptSubmitRequest = z.object({ file_id: fileObjectId }).strict();
export type GuestReceiptSubmitRequest = z.infer<typeof guestReceiptSubmitRequest>;

/** POST /public/stores/{slug}/fittings. Send an `Idempotency-Key` header. */
export const guestFittingRequest = z
  .object({
    turnstile_token: turnstileToken,
    email: guestEmail,
    customer: guestCustomer.omit({ address: true }).extend({ address: z.string().trim().min(5).max(500).nullable() }),
    start_at: isoInstant,
    variant_ids: z
      .array(productVariantId)
      .min(1, 'choose at least one piece to try')
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length, 'choose each size once'),
    note: z.string().trim().max(500).nullable(),
  })
  .strict();
export type GuestFittingRequest = z.infer<typeof guestFittingRequest>;

export const guestFittingCreated = z
  .object({
    id: fittingId,
    status: z.literal('pending'),
    start_at: isoInstant,
    end_at: isoInstant,
    fee_minor: moneyString.nullable(),
  })
  .strict();
export type GuestFittingCreated = z.infer<typeof guestFittingCreated>;
