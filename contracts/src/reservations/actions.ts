/**
 * Reservation lifecycle mutation contracts. Requests carry only user intent
 * plus the optimistic reservation version; actor, tenant, branch, prices,
 * allocation IDs, and authoritative target state are server-owned.
 */
import { z } from 'zod';

import { fileObjectId, paymentId, paymentReceiptId } from '../common/ids';
import { moneyString } from '../common/money';
import { instantInterval, isoDate, isoInstant } from '../common/time';
import { physicalAssetReadiness } from '../catalogue/staff';
import { staffReservationCustomerInput } from './hold';
import { fulfillmentMethod, reservationSummary } from './reservation';

const versionedAction = z
  .object({
    version: z.number().int().positive(),
  })
  .strict();

/** held -> pending_confirmation after contact/terms/evidence prerequisites are satisfied. */
export const reservationSubmitRequest = versionedAction.extend({
  terms_accepted: z.literal(true),
  /** Required only when the initial staff hold was acquired before customer entry. */
  customer: staffReservationCustomerInput.optional(),
});
export type ReservationSubmitRequest = z.infer<typeof reservationSubmitRequest>;

export const reservationSubmitResponse = z
  .object({ reservation: reservationSummary })
  .strict();
export type ReservationSubmitResponse = z.infer<typeof reservationSubmitResponse>;

/**
 * Staff-facing "Complete Reservation" intent. The API may submit and then confirm,
 * but it never skips the canonical held -> pending_confirmation -> confirmed states.
 */
export const staffReservationCompleteRequest = reservationSubmitRequest.extend({
  /** Staff records physical cash tendered; verified payment remains the exact amount due. */
  cash_collection: z
    .object({
      amount_tendered_minor: moneyString,
    })
    .strict()
    .optional(),
});
export type StaffReservationCompleteRequest = z.infer<typeof staffReservationCompleteRequest>;

export const staffReservationCompletionNextAction = z.enum([
  'none',
  'merchant_review',
  'payment_verification',
]);
export type StaffReservationCompletionNextAction = z.infer<
  typeof staffReservationCompletionNextAction
>;

export const staffReservationCompleteResponse = z
  .object({
    reservation: reservationSummary,
    completion_state: z.enum(['pending_confirmation', 'confirmed']),
    next_action: staffReservationCompletionNextAction,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reservation.status !== value.completion_state) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completion_state'],
        message: 'completion_state must match reservation.status.',
      });
    }
    if (value.completion_state === 'confirmed' && value.next_action !== 'none') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['next_action'],
        message: 'A confirmed reservation cannot require another completion action.',
      });
    }
    if (value.completion_state === 'pending_confirmation' && value.next_action === 'none') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['next_action'],
        message: 'A pending reservation must identify the remaining completion action.',
      });
    }
  });
export type StaffReservationCompleteResponse = z.infer<typeof staffReservationCompleteResponse>;

/** pending_confirmation -> confirmed; finance verification remains a separate authority. */
export const reservationConfirmRequest = versionedAction;
export type ReservationConfirmRequest = z.infer<typeof reservationConfirmRequest>;

export const reservationConfirmResponse = z
  .object({ reservation: reservationSummary })
  .strict();
export type ReservationConfirmResponse = z.infer<typeof reservationConfirmResponse>;

/** Attach one already-finalized immutable receipt to the reservation's server-owned payment. */
export const reservationPaymentReceiptAttachRequest = z
  .object({ file_id: fileObjectId })
  .strict();
export type ReservationPaymentReceiptAttachRequest = z.infer<
  typeof reservationPaymentReceiptAttachRequest
>;

export const reservationPaymentReceiptAttachResponse = z
  .object({
    receipt_id: paymentReceiptId,
    payment_id: paymentId,
    evidence_status: z.literal('uploaded'),
  })
  .strict();
export type ReservationPaymentReceiptAttachResponse = z.infer<
  typeof reservationPaymentReceiptAttachResponse
>;

/**
 * Staff merchant collection verification. Cash does not require evidence; manual rails require
 * an accepted receipt already attached to the reservation payment.
 */
export const reservationPaymentVerifyRequest = versionedAction.extend({
  verified_amount_minor: moneyString,
  merchant_reference: z.string().trim().min(1).max(200).optional(),
});
export type ReservationPaymentVerifyRequest = z.infer<typeof reservationPaymentVerifyRequest>;

export const reservationPaymentVerifyResponse = z
  .object({
    reservation: reservationSummary,
    payment_id: paymentId,
    payment_status: z.literal('paid'),
    verified_amount_minor: moneyString,
    verified_at: isoInstant,
  })
  .strict();
export type ReservationPaymentVerifyResponse = z.infer<typeof reservationPaymentVerifyResponse>;

/** pending_confirmation -> rejected with an auditable merchant reason. */
export const reservationRejectRequest = versionedAction.extend({
  reason: z.string().trim().min(1).max(500),
});
export type ReservationRejectRequest = z.infer<typeof reservationRejectRequest>;

export const reservationRejectResponse = z
  .object({ reservation: reservationSummary })
  .strict();
export type ReservationRejectResponse = z.infer<typeof reservationRejectResponse>;

/** Atomic replacement of booking capacity; failure must preserve the old allocation. */
export const reservationRescheduleRequest = versionedAction.extend({
  requested_interval: instantInterval,
  accept_price_change: z.boolean().default(false),
});
export type ReservationRescheduleRequest = z.infer<typeof reservationRescheduleRequest>;

export const reservationRescheduleResponse = z
  .object({
    reservation: reservationSummary,
    price_changed: z.boolean(),
  })
  .strict();
export type ReservationRescheduleResponse = z.infer<typeof reservationRescheduleResponse>;

/**
 * The customer facts shown on one reservation. Editing them corrects this booking only; the shared
 * customer profile is changed through customer management.
 */
export const reservationEditCustomer = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    phone: z.string().trim().regex(/^\d{11}$/, 'Phone number must contain exactly 11 digits.').nullable(),
    email: z.string().trim().email().max(320).nullable(),
    address: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine((value) => value.phone !== null || value.email !== null, {
    path: ['phone'],
    message: 'At least one customer contact method (phone or email) is required.',
  });
export type ReservationEditCustomer = z.infer<typeof reservationEditCustomer>;

/**
 * PATCH /reservations/:id: staff corrections before handover (held, pending confirmation, or
 * confirmed). Send only what changes. New dates are re-checked against stock and re-priced with
 * the price terms accepted at booking, and swap the booked garments in one transaction: if any
 * garment is not free, nothing changes. Once the renter paid or uploaded a receipt, the paid amount
 * stays as recorded: a lower total needs `accept_price_change` (staff refund the difference) and a
 * higher total is refused, since pickup requires the paid amount to cover the total.
 */
export const reservationEditRequest = versionedAction
  .extend({
    customer: reservationEditCustomer.optional(),
    event_date: isoDate.nullable().optional(),
    fulfillment_method: fulfillmentMethod.optional(),
    requested_interval: instantInterval.optional(),
    accept_price_change: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) =>
      value.customer !== undefined ||
      value.event_date !== undefined ||
      value.fulfillment_method !== undefined ||
      value.requested_interval !== undefined,
    { message: 'Change at least one reservation detail.' },
  );
export type ReservationEditRequest = z.infer<typeof reservationEditRequest>;
/** What a client sends: `accept_price_change` may be omitted. */
export type ReservationEditRequestInput = z.input<typeof reservationEditRequest>;

export const reservationEditResponse = z
  .object({
    reservation: reservationSummary,
    /** True when the edit changed the amount due. */
    price_changed: z.boolean(),
    /** Amount due before this edit, so staff can see what to collect or refund. */
    previous_due_now_minor: moneyString,
  })
  .strict();
export type ReservationEditResponse = z.infer<typeof reservationEditResponse>;

/** Pre-handover cancellation only; picked-up rentals must use return/settlement. */
export const reservationCancelRequest = versionedAction.extend({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type ReservationCancelRequest = z.infer<typeof reservationCancelRequest>;

export const reservationCancelResponse = z
  .object({ reservation: reservationSummary })
  .strict();
export type ReservationCancelResponse = z.infer<typeof reservationCancelResponse>;

/** confirmed -> picked_up; actual actor is resolved from authenticated membership. */
export const reservationPickupRequest = versionedAction.extend({
  condition_note: z.string().trim().max(1_000).optional(),
});
export type ReservationPickupRequest = z.infer<typeof reservationPickupRequest>;

export const reservationPickupResponse = z
  .object({ reservation: reservationSummary })
  .strict();
export type ReservationPickupResponse = z.infer<typeof reservationPickupResponse>;

/** picked_up -> returned; actual return remains recordable even when late. */
export const reservationReturnRequest = versionedAction.extend({
  condition_note: z.string().trim().max(1_000).optional(),
});
export type ReservationReturnRequest = z.infer<typeof reservationReturnRequest>;

export const reservationReturnResponse = z
  .object({ reservation: reservationSummary })
  .strict();
export type ReservationReturnResponse = z.infer<typeof reservationReturnResponse>;

/** Post-return inspection updates the physical readiness projection but does not complete the rental. */
export const reservationInspectionRequest = versionedAction.extend({
  readiness: physicalAssetReadiness,
  condition_note: z.string().trim().max(1_000).optional(),
});
export type ReservationInspectionRequest = z.infer<typeof reservationInspectionRequest>;

export const reservationInspectionResponse = z
  .object({
    reservation: reservationSummary,
    asset_readiness: physicalAssetReadiness,
  })
  .strict();
export type ReservationInspectionResponse = z.infer<typeof reservationInspectionResponse>;

/** returned -> completed after inspection/readiness/settlement gates pass server-side. */
export const reservationCompleteRequest = versionedAction;
export type ReservationCompleteRequest = z.infer<typeof reservationCompleteRequest>;

export const reservationCompleteResponse = z
  .object({ reservation: reservationSummary })
  .strict();
export type ReservationCompleteResponse = z.infer<typeof reservationCompleteResponse>;
