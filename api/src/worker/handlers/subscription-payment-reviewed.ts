import type { PoolClient } from 'pg';
import { z } from 'zod';

import { withSystemTenantTransaction } from '../../db/client.js';
import { createEmailSender, type EmailSender } from '../../integrations/email/email-sender.js';
import { PermanentOutboxError, type EventHandler } from '../runner.js';

/**
 * Emails the business owner after an operator reviews a subscription payment.
 *
 * The operator API (a separate repository) cannot seal emails, so when it approves or rejects a
 * payment it writes one `subscription.payment_reviewed` outbox row:
 *   payload { "payment_id": uuid, "outcome": "approved" | "rejected" },
 *   dedupe_key "subscription.payment_reviewed:<payment_id>:<outcome>".
 * This handler reads the rest from the database. The row id is the provider idempotency key, so a
 * retry after a lost acknowledgement does not send twice. A business with no business email is
 * acknowledged without sending (the owner still sees the result in the app).
 */
export const PAYMENT_REVIEWED_EVENT_TYPE = 'subscription.payment_reviewed';

const payloadSchema = z.object({ payment_id: z.string().uuid(), outcome: z.enum(['approved', 'rejected']) }).strict();

interface ReviewedPayment {
  status: 'pending' | 'verified' | 'failed';
  reference: string | null;
  amount_minor: number;
  currency: string;
  review_note: string | null;
  current_period_end: Date | null;
  business_email: string | null;
  business_name: string;
}

async function readReviewedPayment(client: PoolClient, tenantId: string, paymentId: string): Promise<ReviewedPayment | null> {
  const result = await client.query<ReviewedPayment>(
    `SELECT sp.status, sp.reference, sp.amount_minor, sp.currency, sp.review_note,
            s.current_period_end, ts.business_email, t.name AS business_name
       FROM subscription_payment sp
       JOIN subscription s ON s.tenant_id = sp.tenant_id AND s.id = sp.subscription_id
       JOIN tenant t ON t.id = sp.tenant_id
       LEFT JOIN tenant_settings ts ON ts.tenant_id = sp.tenant_id
      WHERE sp.tenant_id = $1 AND sp.id = $2`,
    [tenantId, paymentId],
  );
  return result.rows[0] ?? null;
}

const peso = (minor: number): string => `₱${(minor / 100).toLocaleString('en-PH', { minimumFractionDigits: minor % 100 === 0 ? 0 : 2 })}`;
const day = (value: Date): string => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long' }).format(value);

export function createSubscriptionPaymentReviewedHandler(sender: EmailSender | null = createEmailSender()): EventHandler {
  return async (row) => {
    const parsed = payloadSchema.safeParse(row.payload);
    if (!parsed.success) throw new PermanentOutboxError('Payment review payload is invalid.');
    const { payment_id: paymentId, outcome } = parsed.data;

    const payment = await withSystemTenantTransaction(row.tenant_id, 'system:subscription-review-email', (client) =>
      readReviewedPayment(client, row.tenant_id, paymentId),
    );
    if (!payment) throw new PermanentOutboxError('The reviewed payment was not found.');
    // A later review changed the outcome; this row is stale and must not send the old message.
    if ((outcome === 'approved' && payment.status !== 'verified') || (outcome === 'rejected' && payment.status !== 'failed')) return;
    if (!payment.business_email || !sender) return;

    const reference = payment.reference ? ` (reference ${payment.reference})` : '';
    const email =
      outcome === 'approved'
        ? {
            subject: 'Your Drezivo payment was approved',
            text: `Hi ${payment.business_name},\n\nWe received your ${peso(payment.amount_minor)} payment${reference}. Your Standard plan is active${
              payment.current_period_end ? ` until ${day(payment.current_period_end)}` : ''
            }, and every feature is open again.\n\nThank you for using Drezivo.`,
          }
        : {
            subject: 'Your Drezivo payment could not be approved',
            text: `Hi ${payment.business_name},\n\nWe could not match your ${peso(payment.amount_minor)} payment${reference}.${
              payment.review_note ? `\n\nReason: ${payment.review_note}` : ''
            }\n\nPlease check the details and send it again from Subscribe in your Drezivo account.`,
          };

    await sender.send({ to: payment.business_email, ...email, idempotencyKey: row.id });
  };
}
