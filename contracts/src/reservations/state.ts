/**
 * Data-Model §6 "Reservation states and transaction recipes" — the table
 * below is copied verbatim from that section. This is the single source of
 * truth for reservation state on the wire; `api` must not invent a state
 * this enum does not list, and this enum must not drift from Data-Model §6
 * without updating that document first.
 *
 * | State                 | Allowed transition                                   |
 * |------------------------|------------------------------------------------------|
 * | held                   | pending_confirmation, cancelled, expired              |
 * | pending_confirmation    | confirmed, rejected, cancelled, expired               |
 * | confirmed              | picked_up, cancelled; atomic reschedule retains state |
 * | picked_up              | returned; cannot cancel into available                |
 * | returned               | completed after inspection and settlement checklist   |
 * | completed, cancelled, expired, rejected | Terminal                            |
 */
import { z } from 'zod';

export const reservationState = z.enum([
  'held',
  'pending_confirmation',
  'confirmed',
  'picked_up',
  'returned',
  'completed',
  'cancelled',
  'expired',
  'rejected',
]);
export type ReservationState = z.infer<typeof reservationState>;

/**
 * The transition table above, as data. `api` is the enforcement point (a
 * conditional UPDATE, not this map) — this is published so `app`/`web` can
 * grey out an action the current state can never legally reach, as a UX
 * nicety, never as the authority.
 */
export const RESERVATION_STATE_TRANSITIONS = Object.freeze({
    held: Object.freeze(['pending_confirmation', 'cancelled', 'expired']),
    pending_confirmation: Object.freeze(['confirmed', 'rejected', 'cancelled', 'expired']),
    confirmed: Object.freeze(['picked_up', 'cancelled']),
    picked_up: Object.freeze(['returned']),
    returned: Object.freeze(['completed']),
    completed: Object.freeze([]),
    cancelled: Object.freeze([]),
    expired: Object.freeze([]),
    rejected: Object.freeze([]),
  } as const);
