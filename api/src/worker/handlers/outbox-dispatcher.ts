import type { OutboxRow } from '../runner.js';
import { logger } from '../../shared/logger.js';
import { DependencyUnavailableError } from '../../shared/errors.js';

/**
 * Dispatches a domain event row to its notification channel(s). This is the boundary where
 * "at-least-once" becomes visible: TRD §8 — "Exactly-once email delivery cannot be promised
 * with an external provider... Never couple reservation success to email success." The business
 * transaction that wrote this outbox row has ALREADY committed by the time this handler runs;
 * a failure here retries the notification, never the booking.
 *
 * Reservation reminders specifically must recheck the reservation's current `version` before
 * sending (TRD §8) — this scaffold's handler reads `payload.reservationVersion` and is expected
 * to no-op if the live row has since moved past it, so a reschedule cannot cause an obsolete
 * pickup-time email to go out after the fact. That version recheck query is intentionally left
 * to the concrete notification-channel implementation (not written here), since it needs a
 * real provider/template layer this scaffold does not include.
 */
export function outboxDispatcher(row: OutboxRow): Promise<void> {
  logger.info(
    { outboxId: row.id, tenantId: row.tenant_id, eventType: row.event_type },
    'dispatching outbox event (notification channel not wired in this scaffold)',
  );

  switch (row.event_type) {
    case 'reservation.held':
    case 'reservation.pending_confirmation':
    case 'reservation.confirmed':
    case 'reservation.picked_up':
    case 'reservation.returned':
    case 'reservation.cancelled':
    case 'reservation.rejected':
    case 'reservation.hold_expired':
      // A real implementation resolves the recipient from an authorized record at send time
      // (TRD §8), renders the templated message, and calls the provider adapter — recording
      // the outcome in `notification_delivery` (queued -> provider_accepted -> delivered/
      // bounced). Left unimplemented here: this file's job is the outbox contract, not a
      // concrete email/SMS provider integration.
      throw new DependencyUnavailableError('Notification delivery is not configured.');
    default:
      throw new Error(`outbox-dispatcher: no notification mapping for event type "${row.event_type}"`);
  }
}
