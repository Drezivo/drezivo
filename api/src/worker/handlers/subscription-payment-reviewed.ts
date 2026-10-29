import type { PlanCode } from '@drezivo/contracts';
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
  subscription_id: string;
  target_plan_id: string | null;
  target_plan_code: PlanCode | null;
  current_plan_code: PlanCode;
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
    `SELECT sp.subscription_id, sp.target_plan_id, target_plan.code AS target_plan_code,
            current_plan.code AS current_plan_code,
            sp.status, sp.reference, sp.amount_minor, sp.currency, sp.review_note,
            s.current_period_end, ts.business_email, t.name AS business_name
       FROM subscription_payment sp
       JOIN subscription s ON s.tenant_id = sp.tenant_id AND s.id = sp.subscription_id
       JOIN plan current_plan ON current_plan.id = s.plan_id
       LEFT JOIN plan target_plan ON target_plan.id = sp.target_plan_id
       JOIN tenant t ON t.id = sp.tenant_id
       LEFT JOIN tenant_settings ts ON ts.tenant_id = sp.tenant_id
      WHERE sp.tenant_id = $1 AND sp.id = $2`,
    [tenantId, paymentId],
  );
  return result.rows[0] ?? null;
}

/**
 * Activate a Free-to-paid manual upgrade once, after the operator's verified decision. This is the
 * only activation path: for a Free workspace the operator API records the approval and leaves the
 * subscription untouched (Drezivo/drezivo-operator tenant-admin-db reviewPayment), so the plan and
 * its first paid month start here, in one transaction with this row's event and audit record.
 */
async function activateApprovedFreeUpgrade(
  client: PoolClient,
  tenantId: string,
  paymentId: string,
  payment: ReviewedPayment,
  outboxId: string,
): Promise<Date | null> {
  if (
    payment.current_plan_code !== 'free' ||
    !payment.target_plan_id ||
    !payment.target_plan_code ||
    payment.target_plan_code === 'free'
  ) return null;

  const locked = await client.query<{
    plan_id: string;
    plan_code: string;
    status: string;
    tenant_status: string;
    target_plan_active: boolean;
    current_period_end: Date | null;
  }>(
    `SELECT s.plan_id, current_plan.code AS plan_code, s.status, t.status AS tenant_status,
            s.current_period_end,
            target_plan.active AS target_plan_active
       FROM subscription s
       JOIN tenant t ON t.id = s.tenant_id
       JOIN plan current_plan ON current_plan.id = s.plan_id
       JOIN plan target_plan ON target_plan.id = $3
      WHERE s.tenant_id = $1 AND s.id = $2
      FOR UPDATE OF s, t`,
    [tenantId, payment.subscription_id, payment.target_plan_id],
  );
  const current = locked.rows[0];
  if (!current || current.target_plan_active !== true) {
    throw new PermanentOutboxError('The approved upgrade plan is unavailable.');
  }

  const businessKey = `subscription-payment-approved:${paymentId}`;
  if (current.plan_id === payment.target_plan_id && current.status === 'active') {
    const priorActivation = await client.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM subscription_event
          WHERE tenant_id = $1 AND business_key = $2
       ) AS present`,
      [tenantId, businessKey],
    );
    if (priorActivation.rows[0]?.present === true) return current.current_period_end;
    throw new PermanentOutboxError('The approved upgrade has an inconsistent activation record.');
  }

  if (
    current.plan_code !== 'free' ||
    current.status !== 'active' ||
    current.tenant_status !== 'active'
  ) {
    throw new PermanentOutboxError('The workspace is not in an activatable Free-plan state.');
  }

  const changed = await client.query<{ current_period_end: Date }>(
    `UPDATE subscription
        SET plan_id = $3, status = 'active', trial_ends_at = NULL,
            current_period_start = statement_timestamp(),
            current_period_end = statement_timestamp() + interval '1 month',
            grace_ends_at = NULL, cancel_at_period_end = false
      WHERE tenant_id = $1 AND id = $2 AND plan_id = $4
        AND status = 'active' AND current_period_end IS NULL
      RETURNING current_period_end`,
    [tenantId, payment.subscription_id, payment.target_plan_id, current.plan_id],
  );
  if (changed.rowCount !== 1) {
    throw new PermanentOutboxError('The Free subscription changed before payment activation.');
  }
  const currentPeriodEnd = changed.rows[0]?.current_period_end;
  if (!currentPeriodEnd) {
    throw new PermanentOutboxError('The approved upgrade did not receive a paid period end.');
  }

  await client.query(
    `INSERT INTO subscription_event
       (tenant_id, subscription_id, prior_plan_id, next_plan_id,
        event_type, effective_at, business_key)
     VALUES ($1, $2, $3, $4, 'plan_changed', statement_timestamp(), $5)
     ON CONFLICT (tenant_id, business_key) DO NOTHING`,
    [tenantId, payment.subscription_id, current.plan_id, payment.target_plan_id, businessKey],
  );
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'system', 'system:subscription-payment-reviewed',
             'subscription.free_upgrade_payment_approved', 'subscription', $2,
             $3::jsonb, $4, statement_timestamp(), 'succeeded')`,
    [
      tenantId,
      payment.subscription_id,
      JSON.stringify({ payment_id: paymentId, target_plan_code: payment.target_plan_code }),
      `outbox:${outboxId}`,
    ],
  );
  return currentPeriodEnd;
}

const peso = (minor: number): string => `₱${(minor / 100).toLocaleString('en-PH', { minimumFractionDigits: minor % 100 === 0 ? 0 : 2 })}`;
const day = (value: Date): string => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long' }).format(value);

export function createSubscriptionPaymentReviewedHandler(sender: EmailSender | null = createEmailSender()): EventHandler {
  return async (row) => {
    const parsed = payloadSchema.safeParse(row.payload);
    if (!parsed.success) throw new PermanentOutboxError('Payment review payload is invalid.');
    const { payment_id: paymentId, outcome } = parsed.data;

    const payment = await withSystemTenantTransaction(row.tenant_id, 'system:subscription-review-email', async (client) => {
      const payment = await readReviewedPayment(client, row.tenant_id, paymentId);
      if (!payment) return null;
      if ((outcome === 'approved' && payment.status !== 'verified') || (outcome === 'rejected' && payment.status !== 'failed')) {
        return payment;
      }
      if (outcome !== 'approved') return payment;

      const currentPeriodEnd = await activateApprovedFreeUpgrade(client, row.tenant_id, paymentId, payment, row.id);
      return currentPeriodEnd
        ? {
            ...payment,
            current_plan_code: payment.target_plan_code ?? payment.current_plan_code,
            current_period_end: currentPeriodEnd,
          }
        : payment;
    });
    if (!payment) throw new PermanentOutboxError('The reviewed payment was not found.');
    // A later review changed the outcome; this row is stale and must not send the old message.
    if ((outcome === 'approved' && payment.status !== 'verified') || (outcome === 'rejected' && payment.status !== 'failed')) return;
    if (!payment.business_email || !sender) return;

    const reference = payment.reference ? ` (reference ${payment.reference})` : '';
    const email =
      outcome === 'approved'
        ? {
            subject: 'Your Drezivo payment was approved',
            text: `Hi ${payment.business_name},\n\nWe received your ${peso(payment.amount_minor)} payment${reference}. Your ${planName(payment.target_plan_code ?? payment.current_plan_code)} plan is active${
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

function planName(code: ReviewedPayment['current_plan_code'] | ReviewedPayment['target_plan_code']): string {
  if (code === 'starter') return 'Starter';
  if (code === 'standard') return 'Standard';
  return 'Free';
}
