import type { OutboxRow } from '../runner.js';
import { logger } from '../../shared/logger.js';

/**
 * Domain events written to the outbox by reservation commands. Nothing subscribes to them yet:
 * renter and owner emails are composed inside the business transaction as separate
 * `notification.email` rows (modules/notifications/email-notifications.ts). Each type is listed
 * explicitly so an unknown event type still dead-letters instead of being silently swallowed.
 * When a real subscriber is added, give that type its own handler and remove it from this list.
 */
export const ACKNOWLEDGED_DOMAIN_EVENTS = [
  'reservation.held',
  'reservation.pending_confirmation',
  'reservation.confirmed',
  'reservation.rejected',
  'reservation.cancelled',
  'reservation.hold_expired',
  'reservation.picked_up',
  'reservation.returned',
  'reservation.completed',
  'payment.verified',
] as const;

export function acknowledgeDomainEvent(row: OutboxRow): Promise<void> {
  logger.debug({ outboxId: row.id, tenantId: row.tenant_id, eventType: row.event_type }, 'domain event acknowledged; no subscriber');
  return Promise.resolve();
}
