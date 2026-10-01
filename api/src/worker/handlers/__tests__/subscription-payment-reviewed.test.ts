import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PermanentOutboxError, type OutboxRow } from '../../runner.js';

const db = vi.hoisted(() => ({ payment: null as Record<string, unknown> | null }));
vi.mock('../../../db/client.js', () => ({
  withSystemTenantTransaction: (_tenantId: string, _actor: string, fn: (client: unknown) => unknown) =>
    fn({ query: () => Promise.resolve({ rows: db.payment ? [db.payment] : [] }) }),
}));

const { createSubscriptionPaymentReviewedHandler } = await import('../subscription-payment-reviewed.js');

const paymentId = '750e8400-e29b-41d4-a716-446655440000';
const row = (payload: Record<string, unknown>): OutboxRow => ({
  id: 'outbox-7',
  tenant_id: 'tenant-1',
  event_type: 'subscription.payment_reviewed',
  payload,
  attempts: 0,
  max_attempts: 8,
});
const reviewed = (overrides: Record<string, unknown> = {}) => ({
  status: 'verified',
  reference: 'GC-778899',
  amount_minor: 30000,
  currency: 'PHP',
  review_note: null,
  current_period_end: new Date('2026-11-03T04:00:00.000Z'),
  business_email: 'owner@luna.test',
  business_name: 'Luna Gowns',
  ...overrides,
});

describe('subscription payment reviewed email', () => {
  beforeEach(() => {
    db.payment = null;
  });

  it('emails the owner once per outbox row when a payment is approved', async () => {
    db.payment = reviewed();
    const send = vi.fn().mockResolvedValue(undefined);
    await createSubscriptionPaymentReviewedHandler({ send })(row({ payment_id: paymentId, outcome: 'approved' }));
    expect(send).toHaveBeenCalledTimes(1);
    const email = send.mock.calls[0]?.[0] as { to: string; subject: string; text: string; idempotencyKey: string };
    expect(email).toMatchObject({ to: 'owner@luna.test', subject: 'Your Drezivo payment was approved', idempotencyKey: 'outbox-7' });
    expect(email.text).toContain('₱300');
    expect(email.text).toContain('GC-778899');
    expect(email.text).toContain('November 3, 2026');
  });

  it("tells the owner the operator's reason when a payment is rejected", async () => {
    db.payment = reviewed({ status: 'failed', review_note: 'Amount was 200, not 300' });
    const send = vi.fn().mockResolvedValue(undefined);
    await createSubscriptionPaymentReviewedHandler({ send })(row({ payment_id: paymentId, outcome: 'rejected' }));
    const email = send.mock.calls[0]?.[0] as { subject: string; text: string };
    expect(email.subject).toBe('Your Drezivo payment could not be approved');
    expect(email.text).toContain('Reason: Amount was 200, not 300');
  });

  it('sends nothing for a stale outcome, a business without email, or no email provider', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    db.payment = reviewed({ status: 'failed' });
    await createSubscriptionPaymentReviewedHandler({ send })(row({ payment_id: paymentId, outcome: 'approved' }));
    db.payment = reviewed({ business_email: null });
    await createSubscriptionPaymentReviewedHandler({ send })(row({ payment_id: paymentId, outcome: 'approved' }));
    db.payment = reviewed();
    await createSubscriptionPaymentReviewedHandler(null)(row({ payment_id: paymentId, outcome: 'approved' }));
    expect(send).not.toHaveBeenCalled();
  });

  it('ends the row permanently for an invalid payload or a missing payment, and lets provider outages retry', async () => {
    const send = vi.fn().mockRejectedValue(new Error('provider down'));
    const handler = createSubscriptionPaymentReviewedHandler({ send });
    await expect(handler(row({ payment_id: 'nope', outcome: 'approved' }))).rejects.toBeInstanceOf(PermanentOutboxError);
    await expect(handler(row({ payment_id: paymentId, outcome: 'approved', extra: true }))).rejects.toBeInstanceOf(PermanentOutboxError);
    await expect(handler(row({ payment_id: paymentId, outcome: 'approved' }))).rejects.toBeInstanceOf(PermanentOutboxError);
    db.payment = reviewed();
    await expect(handler(row({ payment_id: paymentId, outcome: 'approved' }))).rejects.not.toBeInstanceOf(PermanentOutboxError);
  });
});
