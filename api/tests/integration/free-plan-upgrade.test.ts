import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

/**
 * Free → paid, end to end over HTTP against PostgreSQL: the 14-day trial, paying for a plan once
 * the trial is used, the operator console's approval, and the business worker that activates it.
 *
 * Payments are approved by the operator API (Drezivo/drezivo-operator, tenant-admin-db
 * reviewPayment), not by this service. `approveAsOperator` replays its SQL statement for statement
 * as of operator 4e875e9: a Free workspace's subscription is left untouched and the outbox row
 * hands activation to this repository's worker; a paid plan's payment extends its period.
 * `approveAsLegacyOperator` replays the release before it, which extended a Free subscription.
 */
const clerk = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: clerk.getAuth,
}));

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

type Envelope = { success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const bodyOf = (response: { body: unknown }): Envelope => response.body as Envelope;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)]);
const DAY_MS = 24 * 60 * 60 * 1000;
const EXTEND_PERIOD = `UPDATE subscription
    SET current_period_start = CASE WHEN status = 'active' AND current_period_end > now() THEN current_period_start ELSE now() END,
        current_period_end = GREATEST(
          now(),
          CASE WHEN status = 'trialing' THEN COALESCE(trial_ends_at, now()) ELSE now() END,
          CASE WHEN status = 'active' THEN current_period_end ELSE now() END
        ) + interval '1 month',
        status = 'active',
        grace_ends_at = NULL
  WHERE id = $1`;

describe('Free plan upgrade', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool } = await import('../../src/db/client.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
  const { createTestOwnerAccount } = await import('./helpers/factories.js');
  const { createSubscriptionPaymentReviewedHandler } = await import(
    '../../src/worker/handlers/subscription-payment-reviewed.js'
  );
  const { PermanentOutboxError } = await import('../../src/worker/runner.js');
  const admin = new pg.Pool({ connectionString: adminUrl, max: 3 });
  const methodIds: string[] = [];

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => {
    await resetTestDatabase(adminUrl);
    await admin.query('DELETE FROM platform_payment_method WHERE id = ANY($1::uuid[])', [methodIds.splice(0)]);
  });
  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  /** A published-ready workspace moved onto Free; `trialUsed` marks the owner's lifetime trial spent. */
  async function freeWorkspace(label: string, trialUsed: boolean) {
    const ws = await createStorefrontWorkspace(label);
    await createTestOwnerAccount(ws.owner.principalId, ws.tenantId);
    await admin.query(
      `UPDATE subscription
          SET plan_id = (SELECT id FROM plan WHERE code = 'free' AND version = 1),
              status = 'active', trial_ends_at = NULL, current_period_end = NULL, grace_ends_at = NULL
        WHERE tenant_id = $1`,
      [ws.tenantId],
    );
    // Free has no Front Desk seats, so a real Free workspace has no staff (the fixture adds one).
    await admin.query("UPDATE membership SET status = 'removed' WHERE tenant_id = $1 AND role = 'frontdesk'", [ws.tenantId]);
    if (trialUsed) {
      await admin.query("UPDATE account SET trial_consumed_at = now() - interval '90 days' WHERE clerk_user_id = $1", [
        ws.owner.principalId,
      ]);
    }
    await admin.query(
      "INSERT INTO tenant_settings (tenant_id, business_email) VALUES ($1, 'owner@fu.test') ON CONFLICT (tenant_id) DO UPDATE SET business_email = EXCLUDED.business_email",
      [ws.tenantId],
    );
    clerk.getAuth.mockReturnValue({ userId: ws.owner.principalId, orgId: ws.clerkOrgId });
    return ws;
  }

  async function paymentInputs(tenantId: string) {
    const method = await admin.query<{ id: string }>(
      `INSERT INTO platform_payment_method (label, account_name, account_number, qr_image, qr_mime)
       VALUES ('GCash', 'Drezivo', '09171234567', $1, 'image/png') RETURNING id`,
      [PNG],
    );
    const methodId = method.rows[0]?.id;
    if (!methodId) throw new Error('payment method insert failed');
    methodIds.push(methodId);
    const proof = await admin.query<{ id: string }>(
      `INSERT INTO file_object (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status, is_private, upload_expires_at, frozen_at)
       VALUES ($1, 'subscription_payment_proof', $2, $3, 'image/png', 256, 'accepted', true, now() + interval '1 day', now()) RETURNING id`,
      [tenantId, `test/proof/${randomUUID()}.png`, `v-${randomUUID()}`],
    );
    return { payment_method_id: methodId, proof_file_id: proof.rows[0]?.id };
  }

  async function submitPayment(label: string, planCode: 'starter' | 'standard' | undefined, tenantId: string): Promise<string> {
    const response = await request(createApp())
      .post('/api/v1/billing/payments')
      .set('Idempotency-Key', `${label}-payment`)
      .send({ ...(planCode ? { plan_code: planCode } : {}), reference: 'GC-445566', ...(await paymentInputs(tenantId)) });
    expect(response.status).toBe(201);
    return (bodyOf(response).data as { payment: { id: string } }).payment.id;
  }

  async function inOperatorTransaction(tenantId: string, work: (client: pg.PoolClient) => Promise<void>): Promise<void> {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.principal_id', 'operator:test', true)", [tenantId]);
      await client.query('SELECT id FROM tenant WHERE id = $1 FOR UPDATE', [tenantId]);
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Operator 4e875e9 reviewPayment(approve), apart from its idempotency bookkeeping. */
  async function approveAsOperator(tenantId: string, paymentId: string): Promise<void> {
    await inOperatorTransaction(tenantId, async (client) => {
      await client.query('SELECT status FROM subscription_payment WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, paymentId]);
      await client.query(
        `UPDATE subscription_payment SET status = 'verified', reviewed_at = now(), reviewed_by = 'operator:test', review_note = NULL
          WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
        [tenantId, paymentId],
      );
      const subscription = (
        await client.query<{ id: string; plan_id: string; plan_code: string; status: string }>(
          `SELECT s.id, s.plan_id, p.code AS plan_code, s.status FROM subscription s JOIN plan p ON p.id = s.plan_id
            WHERE s.tenant_id = $1 ORDER BY s.created_at DESC LIMIT 1 FOR UPDATE OF s`,
          [tenantId],
        )
      ).rows[0];
      if (!subscription) throw new Error('no subscription');
      if (subscription.plan_code !== 'free') {
        await client.query(EXTEND_PERIOD, [subscription.id]);
        await client.query(
          `INSERT INTO subscription_event (tenant_id, subscription_id, prior_plan_id, next_plan_id, event_type, effective_at, business_key)
           VALUES ($1, $2, $3, $3, $4, now(), $5) ON CONFLICT (tenant_id, business_key) DO NOTHING`,
          [tenantId, subscription.id, subscription.plan_id, subscription.status === 'active' ? 'renewed' : 'converted', `payment:${paymentId}`],
        );
      }
      await client.query(
        `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
         VALUES ($1, $2, 'subscription.payment_reviewed', $3::jsonb) ON CONFLICT DO NOTHING`,
        [tenantId, `subscription.payment_reviewed:${paymentId}:approved`, JSON.stringify({ payment_id: paymentId, outcome: 'approved' })],
      );
    });
  }

  /** The operator release before 4e875e9: it extended every approved subscription, Free included. */
  async function approveAsLegacyOperator(tenantId: string, paymentId: string): Promise<void> {
    await inOperatorTransaction(tenantId, async (client) => {
      await client.query(
        `UPDATE subscription_payment SET status = 'verified', reviewed_at = now(), reviewed_by = 'operator:test'
          WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
        [tenantId, paymentId],
      );
      const id = (await client.query<{ id: string }>('SELECT id FROM subscription WHERE tenant_id = $1', [tenantId])).rows[0]?.id;
      await client.query(EXTEND_PERIOD, [id]);
    });
  }

  /** Runs the business worker on the approval's outbox row, as the outbox runner would. */
  async function runApprovalJob(tenantId: string, paymentId: string, send = vi.fn().mockResolvedValue(undefined)) {
    const outbox = await admin.query<{ id: string; dedupe_key: string }>(
      "SELECT id, dedupe_key FROM outbox_event WHERE tenant_id = $1 AND payload->>'payment_id' = $2",
      [tenantId, paymentId],
    );
    const row = outbox.rows[0];
    if (!row) throw new Error('no approval outbox row');
    await createSubscriptionPaymentReviewedHandler({ send })({
      id: row.id,
      tenant_id: tenantId,
      dedupe_key: row.dedupe_key,
      event_type: 'subscription.payment_reviewed',
      payload: { payment_id: paymentId, outcome: 'approved' },
      attempts: 0,
      max_attempts: 8,
    });
    return send;
  }

  async function subscriptionOf(tenantId: string) {
    const result = await admin.query<{ plan_code: string; status: string; current_period_end: Date | null; trial_ends_at: Date | null }>(
      `SELECT p.code AS plan_code, s.status, s.current_period_end, s.trial_ends_at
         FROM subscription s JOIN plan p ON p.id = s.plan_id WHERE s.tenant_id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('no subscription');
    return row;
  }

  async function accessOf() {
    return (bodyOf(await request(createApp()).get('/api/v1/actor-context')).data as {
      access: { level: string; reason: string };
      entitlements: { physical_assets_max: number; features: { fittings: boolean; storefront_reservations: boolean } };
    });
  }

  it('starts the 14-day trial once for concurrent double-fire, opening paid features immediately', async () => {
    const ws = await freeWorkspace('fu-trial', false);
    const app = createApp();
    const send = () =>
      request(app).post('/api/v1/subscription/plan').set('Idempotency-Key', 'fu-trial-start-1').send({ plan_code: 'starter' });

    const responses = await Promise.all([send(), send(), send()]);
    expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(true);
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(bodyOf(replay).data).toMatchObject({ plan_code: 'starter', status: 'trialing' });

    const subscription = await subscriptionOf(ws.tenantId);
    expect(subscription.plan_code).toBe('starter');
    const trialMs = (subscription.trial_ends_at?.getTime() ?? 0) - Date.now();
    expect(Math.abs(trialMs - 14 * DAY_MS)).toBeLessThan(60_000);
    const events = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM subscription_event WHERE tenant_id = $1 AND event_type = 'plan_changed'",
      [ws.tenantId],
    );
    expect(events.rows[0]?.n).toBe(1);

    const context = await accessOf();
    expect(context.access).toMatchObject({ level: 'full', reason: 'trial' });
    expect(context.entitlements.features).toMatchObject({ fittings: true, storefront_reservations: true });

    const billing = bodyOf(await request(app).get('/api/v1/billing')).data as { can_start_trial: boolean; plan: { code: string } };
    expect(billing).toMatchObject({ can_start_trial: false, plan: { code: 'starter' } });
  });

  it('keeps a used trial from starting again and points the owner to payment', async () => {
    await freeWorkspace('fu-no-second-trial', true);
    const app = createApp();
    const billing = bodyOf(await request(app).get('/api/v1/billing')).data as {
      can_start_trial: boolean;
      usage: { active_garments: number; frontdesk_seats_used: number };
      plan: { code: string; physical_assets_max: number };
    };
    expect(billing.can_start_trial).toBe(false);
    expect(billing.plan).toMatchObject({ code: 'free', physical_assets_max: 20 });
    expect(billing.usage.active_garments).toBeGreaterThan(0);

    const refused = await request(app)
      .post('/api/v1/subscription/plan')
      .set('Idempotency-Key', 'fu-second-trial')
      .send({ plan_code: 'standard' });
    expect(refused.status).toBe(409);
    expect(bodyOf(refused).error?.message).toContain('Submit a plan payment');
  });

  it('activates a paid upgrade once when the worker runs the operator approval, and emails the owner', async () => {
    const ws = await freeWorkspace('fu-paid', true);
    const paymentId = await submitPayment('fu-paid', 'starter', ws.tenantId);

    await approveAsOperator(ws.tenantId, paymentId);
    // The operator only records the decision; the workspace stays fully open on Free until the job runs.
    expect(await subscriptionOf(ws.tenantId)).toMatchObject({ plan_code: 'free', current_period_end: null });
    expect((await accessOf()).access).toMatchObject({ level: 'full', reason: 'free' });

    const send = await runApprovalJob(ws.tenantId, paymentId);
    const subscription = await subscriptionOf(ws.tenantId);
    expect(subscription).toMatchObject({ plan_code: 'starter', status: 'active' });
    const periodMs = (subscription.current_period_end?.getTime() ?? 0) - Date.now();
    expect(periodMs).toBeGreaterThan(27 * DAY_MS);
    expect(periodMs).toBeLessThan(32 * DAY_MS);
    const context = await accessOf();
    expect(context.access).toMatchObject({ level: 'full', reason: 'paid' });
    expect(context.entitlements).toMatchObject({ physical_assets_max: 125, features: { fittings: true } });
    expect((send.mock.calls[0]?.[0] as { text: string }).text).toContain('Your Starter plan is active until');

    // A redelivered job does not start a second month.
    await runApprovalJob(ws.tenantId, paymentId);
    expect((await subscriptionOf(ws.tenantId)).current_period_end).toEqual(subscription.current_period_end);
    const activations = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM subscription_event WHERE tenant_id = $1 AND business_key = $2',
      [ws.tenantId, `subscription-payment-approved:${paymentId}`],
    );
    expect(activations.rows[0]?.n).toBe(1);
  });

  it('converts a trial started from Free when its payment is approved, after the trial days', async () => {
    const ws = await freeWorkspace('fu-convert', false);
    const app = createApp();
    expect(
      (await request(app).post('/api/v1/subscription/plan').set('Idempotency-Key', 'fu-convert-trial').send({ plan_code: 'standard' })).status,
    ).toBe(200);
    const { trial_ends_at: trialEndsAt } = await subscriptionOf(ws.tenantId);
    const paymentId = await submitPayment('fu-convert', undefined, ws.tenantId);

    await approveAsOperator(ws.tenantId, paymentId);
    await runApprovalJob(ws.tenantId, paymentId);

    const subscription = await subscriptionOf(ws.tenantId);
    expect(subscription).toMatchObject({ plan_code: 'standard', status: 'active' });
    // The paid month starts where the trial ends, so no trial day is lost. Postgres computes the
    // month (Oct 31 + 1 month is Nov 30), as the operator's approval does.
    const expected = await admin.query<{ end: Date }>("SELECT $1::timestamptz + interval '1 month' AS end", [trialEndsAt]);
    expect(Math.abs((subscription.current_period_end?.getTime() ?? 0) - (expected.rows[0]?.end.getTime() ?? 0))).toBeLessThan(60_000);
  });

  it('leaves a rejected Free upgrade on Free with full access', async () => {
    const ws = await freeWorkspace('fu-rejected', true);
    const paymentId = await submitPayment('fu-rejected', 'standard', ws.tenantId);
    await admin.query(
      "UPDATE subscription_payment SET status = 'failed', reviewed_at = now(), review_note = 'No match' WHERE tenant_id = $1 AND id = $2",
      [ws.tenantId, paymentId],
    );

    expect(await subscriptionOf(ws.tenantId)).toMatchObject({ plan_code: 'free', status: 'active', current_period_end: null });
    expect((await accessOf()).access).toMatchObject({ level: 'full', reason: 'free' });
  });

  it('refuses to activate a plan that is no longer offered and leaves the workspace on Free', async () => {
    const ws = await freeWorkspace('fu-retired', true);
    const paymentId = await submitPayment('fu-retired', 'starter', ws.tenantId);
    await approveAsOperator(ws.tenantId, paymentId);
    await admin.query("UPDATE plan SET active = false WHERE code = 'starter' AND version = 1");
    try {
      await expect(runApprovalJob(ws.tenantId, paymentId)).rejects.toBeInstanceOf(PermanentOutboxError);
      expect(await subscriptionOf(ws.tenantId)).toMatchObject({ plan_code: 'free', current_period_end: null });
    } finally {
      await admin.query("UPDATE plan SET active = true WHERE code = 'starter' AND version = 1");
    }
  });

  describe('migration 0088 repairs approvals made while activation was broken', () => {
    const repair = readFileSync(
      new URL('../../src/db/migrations/0088_free_upgrade_approval_repair.sql', import.meta.url),
      'utf8',
    );

    it('moves a Free workspace an earlier operator release extended onto the plan it paid for', async () => {
      const ws = await freeWorkspace('fu-repair-legacy', true);
      const paymentId = await submitPayment('fu-repair-legacy', 'standard', ws.tenantId);
      await approveAsLegacyOperator(ws.tenantId, paymentId);
      expect((await accessOf()).access.level).toBe('locked');

      await admin.query(repair);
      await admin.query(repair);

      expect(await subscriptionOf(ws.tenantId)).toMatchObject({ plan_code: 'standard', status: 'active' });
      expect((await accessOf()).access).toMatchObject({ level: 'full', reason: 'paid' });
    });

    it('re-queues a dead approval job so the fixed worker activates it', async () => {
      const ws = await freeWorkspace('fu-repair-dead', true);
      const paymentId = await submitPayment('fu-repair-dead', 'starter', ws.tenantId);
      await approveAsOperator(ws.tenantId, paymentId);
      await admin.query(
        "UPDATE outbox_event SET status = 'dead', attempts = 8, safe_last_error = 'column updated_at does not exist' WHERE tenant_id = $1 AND event_type = 'subscription.payment_reviewed'",
        [ws.tenantId],
      );

      await admin.query(repair);

      const queued = await admin.query<{ status: string; attempts: number }>(
        "SELECT status, attempts FROM outbox_event WHERE tenant_id = $1 AND event_type = 'subscription.payment_reviewed'",
        [ws.tenantId],
      );
      expect(queued.rows).toEqual([{ status: 'pending', attempts: 0 }]);
      await runApprovalJob(ws.tenantId, paymentId);
      expect(await subscriptionOf(ws.tenantId)).toMatchObject({ plan_code: 'starter', status: 'active' });
    });
  });
});
