import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PermanentOutboxError, type OutboxRow } from '../../runner.js';

type TestQueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number | null };

const db = vi.hoisted(() => ({
  payment: null as Record<string, unknown> | null,
  currentPlanId: 'paid-plan-id',
  currentPlanCode: 'standard',
  eventExists: false,
  query: vi.fn<(sql: string) => Promise<TestQueryResult>>(),
}));
vi.mock('../../../db/client.js', () => ({
  withSystemTenantTransaction: (_tenantId: string, _actor: string, fn: (client: unknown) => unknown) =>
    fn({ query: db.query }),
}));

const { createSubscriptionPaymentReviewedHandler } = await import('../subscription-payment-reviewed.js');

const paymentId = '750e8400-e29b-41d4-a716-446655440000';
const row = (payload: Record<string, unknown>): OutboxRow => ({
  id: 'outbox-7',
  tenant_id: 'tenant-1',
  dedupe_key: 'subscription-payment:reviewed',
  event_type: 'subscription.payment_reviewed',
  payload,
  attempts: 0,
  max_attempts: 8,
});
const reviewed = (overrides: Record<string, unknown> = {}) => ({
  status: 'verified',
  subscription_id: 'subscription-1',
  target_plan_id: null,
  target_plan_code: null,
  current_plan_code: 'standard',
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
    db.currentPlanId = 'paid-plan-id';
    db.currentPlanCode = 'standard';
    db.eventExists = false;
    db.query.mockReset().mockImplementation((sql: string) => {
      if (sql.includes('SELECT sp.subscription_id')) {
        return Promise.resolve({ rows: db.payment ? [db.payment] : [] });
      }
      if (sql.includes('SELECT s.plan_id, current_plan.code')) {
        return Promise.resolve({
          rows: [{
            plan_id: db.currentPlanId,
            plan_code: db.currentPlanCode,
            status: 'active',
            tenant_status: 'active',
            target_plan_active: true,
          }],
        });
      }
      if (sql.includes('SELECT EXISTS')) return Promise.resolve({ rows: [{ present: db.eventExists }] });
      if (sql.includes('UPDATE subscription')) {
        db.currentPlanId = 'starter-plan-id';
        db.currentPlanCode = 'starter';
        db.payment = {
          ...db.payment,
          current_plan_code: 'starter',
          current_period_end: new Date('2026-11-15T00:00:00.000Z'),
        };
        return Promise.resolve({
          rowCount: 1,
          rows: [{ current_period_end: new Date('2026-11-15T00:00:00.000Z') }],
        });
      }
      if (sql.includes('INSERT INTO subscription_event')) {
        db.eventExists = true;
        return Promise.resolve({ rowCount: 1, rows: [] });
      }
      if (sql.includes('INSERT INTO audit_event')) return Promise.resolve({ rowCount: 1, rows: [] });
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
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

  it('activates an approved Free upgrade once and names the selected plan', async () => {
    db.currentPlanId = 'free-plan-id';
    db.currentPlanCode = 'free';
    db.payment = reviewed({
      current_plan_code: 'free',
      target_plan_id: 'starter-plan-id',
      target_plan_code: 'starter',
      current_period_end: null,
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const handler = createSubscriptionPaymentReviewedHandler({ send });
    const event = row({ payment_id: paymentId, outcome: 'approved' });

    await handler(event);
    await handler(event);

    const activationUpdates = db.query.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE subscription'),
    );
    expect(activationUpdates).toHaveLength(1);
    expect(db.eventExists).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const email = send.mock.calls[0]?.[0] as { text: string };
    expect(email.text).toContain('Your Starter plan is active');
    expect(email.text).toContain('November 15, 2026');
  });

  it('does not treat a payment for an existing paid plan as a Free upgrade', async () => {
    db.payment = reviewed({ target_plan_id: 'standard-plan-id', target_plan_code: 'standard' });
    const send = vi.fn().mockResolvedValue(undefined);

    await createSubscriptionPaymentReviewedHandler({ send })(row({ payment_id: paymentId, outcome: 'approved' }));

    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE subscription'))).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
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
