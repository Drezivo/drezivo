import { createEmailSender, type EmailSender } from '../../integrations/email/email-sender.js';
import { openSealedEmail } from '../../modules/notifications/email-notifications.js';
import { PermanentOutboxError, type EventHandler } from '../runner.js';

/**
 * Delivers one sealed `notification.email` outbox row. Provider outages are retried by the runner
 * with backoff; a missing provider or an unreadable payload can never succeed, so those end the
 * row as dead instead of retrying forever. The outbox id is the provider idempotency key, so an
 * at-least-once retry after a lost acknowledgement does not send a second copy.
 */
export function createEmailDeliveryHandler(sender: EmailSender | null = createEmailSender()): EventHandler {
  return async (row) => {
    if (!sender) throw new PermanentOutboxError('Email delivery is not configured.');
    let email: ReturnType<typeof openSealedEmail>;
    try {
      email = openSealedEmail(row.payload);
    } catch {
      throw new PermanentOutboxError('Email payload could not be opened.');
    }
    await sender.send({ ...email, idempotencyKey: row.id });
  };
}
