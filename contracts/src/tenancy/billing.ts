/**
 * Pilot billing: one plan (Standard, internal code `starter`), a 14-day trial, and manual payment of
 * Drezivo's subscription by QR/transfer with uploaded proof that an operator approves.
 *
 * Access is derived at request time from the subscription (no background job decides it). "End" is
 * the trial end while trialing, otherwise the paid-through date:
 * - `full`: before the end (the last 3 days carry a reminder reason).
 * - `read_only`: from the end, for READ_ONLY_ACCESS_DAYS (30). Everything is viewable, nothing can
 *   change, renters cannot book. The storefront stays online (bookings paused) for the first
 *   STOREFRONT_GRACE_DAYS (3), then goes offline. An operator extension (`grace_ends_at`) keeps
 *   read-only access and the storefront online until that date.
 * - `locked`: after the 30 read-only days (or cancelled). Only subscribing is possible.
 */
import { z } from 'zod';

import { fileObjectId } from '../common/ids';
import { isoInstant } from '../common/time';
import { planCode, subscriptionStatus } from './onboarding';

export const subscriptionAccessLevel = z.enum(['full', 'read_only', 'locked']);
export type SubscriptionAccessLevel = z.infer<typeof subscriptionAccessLevel>;

export const subscriptionAccessReason = z.enum([
  'trial',
  'trial_ending',
  'trial_ended',
  'trial_extension',
  'paid',
  'renewal_due',
  'payment_overdue',
  'cancelled',
]);
export type SubscriptionAccessReason = z.infer<typeof subscriptionAccessReason>;

/** How many days before an end date the owner sees the countdown reminder. */
export const SUBSCRIPTION_REMINDER_DAYS = 3;
/** Days after the end during which the storefront stays online (bookings paused). */
export const STOREFRONT_GRACE_DAYS = 3;
/** Days after the end during which the business keeps read-only access before it is locked. */
export const READ_ONLY_ACCESS_DAYS = 30;

export const subscriptionAccess = z
  .object({
    level: subscriptionAccessLevel,
    reason: subscriptionAccessReason,
    /** The instant the current state ends (trial end, paid-through, or extension end); null when open-ended. */
    ends_at: isoInstant.nullable(),
    /** Whole days until `ends_at`, rounded down (0 during the final 24 hours); null when `ends_at` is null. */
    days_left: z.number().int().nonnegative().nullable(),
    /** A payment proof is waiting for operator review. */
    pending_payment: z.boolean(),
    /** Whether the public storefront is online (it may still be taking no bookings; see level). */
    storefront_online: z.boolean(),
    /** When the storefront goes offline, while read-only and still online; otherwise null. */
    storefront_offline_at: isoInstant.nullable(),
    /** When read-only access ends and the workspace locks, while read-only; otherwise null. */
    read_only_until: isoInstant.nullable(),
  })
  .strict();
export type SubscriptionAccess = z.infer<typeof subscriptionAccess>;

export const subscriptionPaymentStatus = z.enum(['pending', 'verified', 'failed']);
export type SubscriptionPaymentStatus = z.infer<typeof subscriptionPaymentStatus>;

/** One of Drezivo's own ways to receive the subscription fee (managed by operators). */
export const platformPaymentMethod = z
  .object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(80),
    account_name: z.string().trim().max(160).nullable(),
    account_number: z.string().trim().max(120).nullable(),
    instructions: z.string().trim().max(1_000).nullable(),
    /** When true, GET /billing/payment-methods/{id}/qr serves the QR image. */
    has_qr: z.boolean(),
  })
  .strict();
export type PlatformPaymentMethod = z.infer<typeof platformPaymentMethod>;

export const subscriptionPaymentReference = z.string().trim().min(1).max(64);

export const subscriptionPaymentView = z
  .object({
    id: z.string().uuid(),
    amount_minor: z.string().regex(/^\d+$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: subscriptionPaymentStatus,
    reference: subscriptionPaymentReference,
    payment_method_label: z.string().min(1),
    submitted_at: isoInstant,
    reviewed_at: isoInstant.nullable(),
    /** Operator's reason, shown to the owner only for rejected payments. */
    review_note: z.string().max(500).nullable(),
  })
  .strict();
export type SubscriptionPaymentView = z.infer<typeof subscriptionPaymentView>;

/**
 * GET /billing — data for the Subscribe dialog (there is no billing page and no plan choice).
 * Owner and front desk may read; only the owner may pay. Works in every access level.
 */
export const billingOverview = z
  .object({
    plan: z
      .object({
        code: planCode,
        name: z.literal('Standard'),
        monthly_minor: z.string().regex(/^\d+$/),
        currency: z.string().regex(/^[A-Z]{3}$/),
        physical_assets_max: z.number().int().positive(),
        frontdesk_seats_max: z.number().int().nonnegative(),
        trial_days: z.number().int().positive(),
      })
      .strict(),
    subscription: z
      .object({
        status: subscriptionStatus,
        trial_ends_at: isoInstant.nullable(),
        /** Operator-granted read-only extension end (stored in `grace_ends_at`). */
        read_only_until: isoInstant.nullable(),
        current_period_end: isoInstant,
      })
      .strict(),
    access: subscriptionAccess,
    can_pay: z.boolean(),
    payment_methods: z.array(platformPaymentMethod).max(10),
    payments: z.array(subscriptionPaymentView).max(24),
  })
  .strict();
export type BillingOverview = z.infer<typeof billingOverview>;

/** POST /billing/payments (owner only, Idempotency-Key required). One pending payment at a time. */
export const submitSubscriptionPaymentRequest = z
  .object({
    payment_method_id: z.string().uuid(),
    reference: subscriptionPaymentReference,
    proof_file_id: fileObjectId,
  })
  .strict();
export type SubmitSubscriptionPaymentRequest = z.infer<typeof submitSubscriptionPaymentRequest>;

export const submitSubscriptionPaymentResponse = z
  .object({ payment: subscriptionPaymentView, access: subscriptionAccess })
  .strict();
export type SubmitSubscriptionPaymentResponse = z.infer<typeof submitSubscriptionPaymentResponse>;

/** POST /onboarding/{id}/start-trial — replaces plan selection: Standard + 14-day trial, then bootstrap. */
export const startTrialRequest = z.object({}).strict();
export type StartTrialRequest = z.infer<typeof startTrialRequest>;
