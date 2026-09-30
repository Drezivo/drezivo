/**
 * Guest booking from a published storefront: email verification, reservation request, payment
 * receipt, and fitting request. No customer account is required.
 *
 * A verification token proves control of one email address for one store for a short time.
 * A guest access token (returned once, stored only as a hash) lets that guest act on the one
 * reservation it was minted for. Neither token is ever placed in a URL query or local storage.
 */
import { z } from 'zod';

import { customerSocialMedia } from '../common/customer';
import { fileObjectId, fittingId, paymentMethodId, productVariantId, reservationId } from '../common/ids';
import { moneyString } from '../common/money';
import { instantInterval, isoDate, isoInstant } from '../common/time';
import { fulfillmentMethod, reservationState } from '../reservations';
import { paymentInstructions } from '../reservations/hold';

const guestEmail = z.string().trim().toLowerCase().email().max(254);
const opaqueToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'token is malformed');

/** POST /public/stores/{slug}/verifications. The answer is identical whether or not a code was sent. */
/** `turnstile_token` is required whenever the API has a Cloudflare Turnstile secret configured. */
export const startGuestVerificationRequest = z
  .object({ email: guestEmail, turnstile_token: z.string().trim().min(1).max(2_048).optional() })
  .strict();
export type StartGuestVerificationRequest = z.infer<typeof startGuestVerificationRequest>;

export const startGuestVerificationResponse = z
  .object({ accepted: z.literal(true), code_length: z.literal(6), expires_in_seconds: z.number().int().positive() })
  .strict();
export type StartGuestVerificationResponse = z.infer<typeof startGuestVerificationResponse>;

/** POST /public/stores/{slug}/verifications/confirm. */
export const confirmGuestVerificationRequest = z
  .object({ email: guestEmail, code: z.string().regex(/^\d{6}$/, 'enter the 6-digit code') })
  .strict();
export type ConfirmGuestVerificationRequest = z.infer<typeof confirmGuestVerificationRequest>;

export const confirmGuestVerificationResponse = z
  .object({ verification_token: opaqueToken, expires_at: isoInstant })
  .strict();
export type ConfirmGuestVerificationResponse = z.infer<typeof confirmGuestVerificationResponse>;

export const guestCustomer = z
  .object({
    full_name: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(/^\d{11}$/, 'enter an 11-digit mobile number').nullable(),
    address: z.string().trim().min(5).max(500),
    social_handle: customerSocialMedia.nullable(),
  })
  .strict();
export type GuestCustomer = z.infer<typeof guestCustomer>;

/** POST /public/stores/{slug}/reservations. Send an `Idempotency-Key` header. */
export const guestReservationRequest = z
  .object({
    verification_token: opaqueToken,
    email: guestEmail,
    customer: guestCustomer,
    variant_id: productVariantId,
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

export const guestReservationCreated = z
  .object({
    reservation: guestReservationView,
    guest_token: opaqueToken,
    guest_token_expires_at: isoInstant,
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

/** POST /guest/reservations/{id}/receipt. Send an `Idempotency-Key` header. */
export const guestReceiptSubmitRequest = z.object({ file_id: fileObjectId }).strict();
export type GuestReceiptSubmitRequest = z.infer<typeof guestReceiptSubmitRequest>;

/** POST /public/stores/{slug}/fittings. Send an `Idempotency-Key` header. */
export const guestFittingRequest = z
  .object({
    verification_token: opaqueToken,
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
