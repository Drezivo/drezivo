/**
 * TRD §3 "Guest access" — "Other guest actions require a server-issued
 * scoped capability... A leaked booking capability must not reveal other
 * bookings, full identity documents, or payment configuration."
 * Data-Model §2 `guest_access_token.scope_codes`: "scopes allowlisted per
 * state." PRD §4 — the resend link "permits status, corrected evidence,
 * cancellation, or reschedule."
 *
 * This module intentionally depends on `reservations` (for
 * `reservationSummary`/`reservationState`), never the reverse — a guest
 * view is a narrowed projection of reservation data, not the other way
 * round. Fields a guest must never see (internal branch id, membership
 * actor, full payment destination config) are simply absent here rather
 * than redacted at runtime, so a server bug cannot accidentally serialize
 * them into a guest response.
 */
import { z } from 'zod';

/**
 * The allowlisted actions a bearer token may perform, independent of which
 * scopes a given reservation's state currently permits (e.g. `cancel` is
 * meaningless once a reservation is `picked_up` — the server still checks
 * state, this enum only fixes the vocabulary of possible scopes).
 */
export const guestScopeCode = z.enum(['view_status', 'submit_evidence', 'cancel', 'reschedule']);
export type GuestScopeCode = z.infer<typeof guestScopeCode>;
