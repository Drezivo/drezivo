/**
 * TRD §4 endpoint family table — confirm/reschedule/pickup/return/cancel.
 * TRD §5 "Reschedule, cancellation and return" — each transition is a
 * single locked transaction; the request never carries a price or a new
 * total, only the inputs the server needs to recompute one.
 *
 * Every request below carries `version` (Data-Model §2 `reservation.
 * version`) so the server can answer a stale action with `STATE_CONFLICT`
 * (409) rather than silently applying it against context the client no
 * longer has current — the concurrency guard is at the type level, not an
 * implementation detail left to `api` to remember.
 */
import { z } from 'zod';

import { instantInterval } from '../common/time';
import { reservationSummary } from './reservation';

const versionedAction = z.object({
  version: z.number().int().nonnegative(),
});

/** POST /reservations/{id}/confirm — TRD §5 "Approval versus expiry." No body fields
 *  beyond the version guard: the verified amount/reference is recorded from the
 *  actor's authenticated review action server-side, never sent by the client. */
export const reservationConfirmRequest = versionedAction;
export type ReservationConfirmRequest = z.infer<typeof reservationConfirmRequest>;

export const reservationConfirmResponse = z.object({ reservation: reservationSummary });
export type ReservationConfirmResponse = z.infer<typeof reservationConfirmResponse>;

/**
 * POST /reservations/{id}/reschedule — TRD §5 "Obtain customer acceptance
 * for repricing/policy changes." `accept_price_change` defaults to `false`
 * so a reprice is rejected (422) until the client has shown the customer
 * the new price and resubmitted with explicit acceptance — never silently
 * charged a different amount than what was displayed.
 */
export const reservationRescheduleRequest = versionedAction.extend({
  requested_interval: instantInterval,
  accept_price_change: z.boolean().default(false),
});
export type ReservationRescheduleRequest = z.infer<typeof reservationRescheduleRequest>;

export const reservationRescheduleResponse = z.object({
  reservation: reservationSummary,
  /** True when the new interval's price differs from the prior snapshot. */
  price_changed: z.boolean(),
});
export type ReservationRescheduleResponse = z.infer<typeof reservationRescheduleResponse>;

/** POST /reservations/{id}/cancel — TRD §5 "Cancellation atomically releases
 *  eligible future allocation and creates any financial obligation." */
export const reservationCancelRequest = versionedAction.extend({
  reason: z.string().min(1).max(500).optional(),
});
export type ReservationCancelRequest = z.infer<typeof reservationCancelRequest>;

export const reservationCancelResponse = z.object({ reservation: reservationSummary });
export type ReservationCancelResponse = z.infer<typeof reservationCancelResponse>;

/**
 * POST /reservations/{id}/pickup — Data-Model §5 "Pickup requires confirmed
 * booking, allocation, physical presence, readiness, policy/payment
 * prerequisites and permission." The acting membership is resolved from
 * the authenticated session server-side, never taken from the request body.
 */
export const reservationPickupRequest = versionedAction.extend({
  condition_note: z.string().max(1000).optional(),
});
export type ReservationPickupRequest = z.infer<typeof reservationPickupRequest>;

export const reservationPickupResponse = z.object({ reservation: reservationSummary });
export type ReservationPickupResponse = z.infer<typeof reservationPickupResponse>;

/** POST /reservations/{id}/return — Data-Model §5 "Return does not imply
 *  ready: inspection and cleaning remain separate." This endpoint records
 *  the actual return custody event only; readiness/cleaning is a separate
 *  operational workflow outside this contract's V1 surface. */
export const reservationReturnRequest = versionedAction.extend({
  condition_note: z.string().max(1000).optional(),
});
export type ReservationReturnRequest = z.infer<typeof reservationReturnRequest>;

export const reservationReturnResponse = z.object({ reservation: reservationSummary });
export type ReservationReturnResponse = z.infer<typeof reservationReturnResponse>;
