/**
 * TRD §4/§5 and Data-Model §6 — shared reservation wire projections.
 * Accepted booking facts are snapshots: catalogue edits must never rewrite
 * the customer, price, measurement, delivery, or policy facts already shown
 * to the renter/staff at reservation time.
 */
import { z } from 'zod';

import { branchId, paymentMethodId, productVariantId, reservationId, storefrontId } from '../common/ids';
import { currencyCode, moneyString } from '../common/money';
import { ianaTimezone, isoDate, isoInstant } from '../common/time';
import { reservationState } from './state';

/** PRD §4: the customer's selected fulfillment method. */
export const fulfillmentMethod = z.enum(['pickup', 'delivery']);
export type FulfillmentMethod = z.infer<typeof fulfillmentMethod>;

/** Guest checkout requires email; staff-created customers use a separate schema. */
export const customerDetails = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(32).optional(),
    email: z.string().trim().email(),
  })
  .strict();
export type CustomerDetails = z.infer<typeof customerDetails>;

/**
 * Staff may receive a walk-in/phone/social booking where only one contact
 * channel is available. At least one of phone/email is required; do not
 * synthesize placeholder contacts just to satisfy persistence constraints.
 */
export const staffCustomerDetails = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(32).optional(),
    email: z.string().trim().email().optional(),
    notes: z.string().trim().max(2_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.phone === undefined && value.email === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'At least one customer contact method (phone or email) is required.',
      });
    }
  });
export type StaffCustomerDetails = z.infer<typeof staffCustomerDetails>;

/** Safe customer facts frozen on the reservation rather than live profile data. */
export const reservationCustomerSnapshot = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(32).nullable(),
    email: z.string().trim().email().nullable(),
  })
  .strict();
export type ReservationCustomerSnapshot = z.infer<typeof reservationCustomerSnapshot>;

/** Shared money snapshot returned by staff and guest reservation projections. */
export const reservationMoneySnapshot = z
  .object({
    rental_total_minor: moneyString,
    security_required_minor: moneyString,
    due_now_minor: moneyString,
    currency: currencyCode,
  })
  .strict();
export type ReservationMoneySnapshot = z.infer<typeof reservationMoneySnapshot>;

/**
 * Compact V1 reservation projection used by create/action responses. The
 * single variant field reflects the V1 one-garment UI; read-detail contracts
 * expose reservation lines explicitly so V1.1 can expand without discarding
 * the persisted line model.
 */
export const reservationSummary = z
  .object({
    id: reservationId,
    reference_code: z.string().trim().min(1).max(120),
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
    version: z.number().int().positive(),
    created_at: isoInstant,
  })
  .strict();
export type ReservationSummary = z.infer<typeof reservationSummary>;
