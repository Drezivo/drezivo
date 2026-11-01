import { z } from 'zod';

import { withSystemTenantTransaction } from '../../db/client.js';
import { createEmailSender, type EmailSender } from '../../integrations/email/email-sender.js';
import { PermanentOutboxError, type EventHandler } from '../runner.js';

/**
 * Emails one client business an operator announcement (migration 0094). The operator console
 * queues one `operator.announcement` row per business; this handler reads the announcement and the
 * business's contact email and sends it. A business without a contact email is acknowledged
 * without sending. The row id is the provider idempotency key, so a retry after a lost
 * acknowledgement does not send a second copy.
 */
export const OPERATOR_ANNOUNCEMENT_EVENT_TYPE = 'operator.announcement';

const payloadSchema = z.object({ announcement_id: z.string().uuid() }).strict();

interface AnnouncementDelivery {
  subject: string;
  body: string;
  business_email: string | null;
  business_name: string;
}

export function createOperatorAnnouncementHandler(sender: EmailSender | null = createEmailSender()): EventHandler {
  return async (row) => {
    const parsed = payloadSchema.safeParse(row.payload);
    if (!parsed.success) throw new PermanentOutboxError('Announcement payload is invalid.');

    const delivery = await withSystemTenantTransaction(row.tenant_id, 'system:operator-announcement', async (client) => {
      const result = await client.query<AnnouncementDelivery>(
        `SELECT a.subject, a.body, ts.business_email, t.name AS business_name
           FROM operator_announcement a
           JOIN tenant t ON t.id = $1
           LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
          WHERE a.id = $2`,
        [row.tenant_id, parsed.data.announcement_id],
      );
      return result.rows[0] ?? null;
    });
    if (!delivery) throw new PermanentOutboxError('The announcement was not found.');
    if (!delivery.business_email) return;
    if (!sender) throw new PermanentOutboxError('Email delivery is not configured.');

    await sender.send({
      to: delivery.business_email,
      subject: delivery.subject,
      text: `Hi ${delivery.business_name},\n\n${delivery.body}\n\nThis is a service message from Drezivo about your account.`,
      idempotencyKey: row.id,
    });
  };
}
