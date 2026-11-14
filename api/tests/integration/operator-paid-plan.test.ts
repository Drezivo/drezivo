import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

import '../../src/config/load-env.js';
import { buildAppRoleDatabaseUrl, ensureAppRoleLogin, migrateTestDatabase, requireTestDatabaseUrl, resetTestDatabase } from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('operator paid plan changes against PostgreSQL', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { changeTenantPlan } = await import('../../src/modules/internal-operator/operator-plan-change.service.js');
  const { resolveTenantEntitlements, resolvePlanEntitlements, assertFrontDeskSeatCapacity } = await import('../../src/modules/entitlements/entitlements.service.js');
  const { createTestMembership } = await import('./helpers/factories.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
  const admin = new Client({ connectionString: adminUrl });
  const command = (tenantId: string, planCode: 'standard' | 'growth', idempotencyKey: string) => ({
    tenantId, planCode, idempotencyKey, reason: null, operatorSubject: 'operator-test', requestId: 'request-test',
  });

  beforeAll(async () => { await migrateTestDatabase(adminUrl); await ensureAppRoleLogin(adminUrl); await admin.connect(); }, 180_000);
  afterEach(async () => { await resetTestDatabase(adminUrl); });
  afterAll(async () => { await admin.end(); await closePool(); });

  it('applies Growth once, immediately exposes its entitlements, and preserves the paid period', async () => {
    const workspace = await createStorefrontWorkspace('paid_change');
    const readPeriod = async () => {
      const period = (await admin.query<{ current_period_start: Date; current_period_end: Date }>(
        'SELECT current_period_start,current_period_end FROM subscription WHERE tenant_id=$1', [workspace.tenantId],
      )).rows[0];
      if (!period) throw new Error('The test subscription was not found.');
      return period;
    };
    const before = await readPeriod();
    const beforeOutbox = await admin.query<{ count: number }>('SELECT count(*)::int AS count FROM outbox_event WHERE tenant_id=$1', [workspace.tenantId]);
    const input = command(workspace.tenantId, 'growth', 'change-once');
    const results = await Promise.all([changeTenantPlan(input), changeTenantPlan(input)]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    const after = await readPeriod();
    expect(after.current_period_start.toISOString()).toBe(before.current_period_start.toISOString());
    expect(after.current_period_end.toISOString()).toBe(before.current_period_end.toISOString());
    const entitlements = await withTenantTransaction(workspace.tenantId, 'owner-test', async (client) => ({
      actual: await resolveTenantEntitlements(client, workspace.tenantId),
      expected: await resolvePlanEntitlements(client, 'growth'),
    }));
    expect(entitlements.actual).toEqual(entitlements.expected);
    expect(entitlements.actual.physicalAssetsMax).toBe(500);
    const audit = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM audit_event WHERE tenant_id=$1 AND action='subscription.plan_changed'", [workspace.tenantId],
    );
    expect(audit.rows[0]?.count).toBe(1);
    const afterOutbox = await admin.query<{ count: number }>('SELECT count(*)::int AS count FROM outbox_event WHERE tenant_id=$1', [workspace.tenantId]);
    expect(afterOutbox.rows[0]?.count).toBe(beforeOutbox.rows[0]?.count);
  });

  it('allows a downgrade that fits the target limits and preserves the paid period', async () => {
    const workspace = await createStorefrontWorkspace('paid_downgrade');
    const before = await admin.query<{ current_period_start: Date; current_period_end: Date }>(
      'SELECT current_period_start,current_period_end FROM subscription WHERE tenant_id=$1', [workspace.tenantId],
    );
    await changeTenantPlan(command(workspace.tenantId, 'growth', 'upgrade'));
    await expect(changeTenantPlan(command(workspace.tenantId, 'standard', 'downgrade'))).resolves.toMatchObject({ changed: true, plan_code: 'standard' });
    const after = await admin.query<{ current_period_start: Date; current_period_end: Date }>(
      'SELECT current_period_start,current_period_end FROM subscription WHERE tenant_id=$1', [workspace.tenantId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it.each(['trialing', 'active', 'past_due', 'restricted'] as const)(
    'changes an overdue %s subscription without changing its status or access dates', async (status) => {
      const workspace = await createStorefrontWorkspace(`overdue_${status}`);
      await admin.query(`UPDATE subscription SET status=$2, trial_ends_at=now()-interval '40 days',
        current_period_start=now()-interval '70 days', current_period_end=now()-interval '40 days'
        WHERE tenant_id=$1`, [workspace.tenantId, status]);
      const readState = () => admin.query(`SELECT s.status, s.trial_ends_at, s.current_period_start,
        s.current_period_end, t.status AS tenant_status FROM subscription s JOIN tenant t ON t.id=s.tenant_id
        WHERE s.tenant_id=$1`, [workspace.tenantId]);
      const before = await readState();
      await expect(changeTenantPlan(command(workspace.tenantId, 'growth', `overdue-${status}`)))
        .resolves.toMatchObject({ changed: true, plan_code: 'growth' });
      expect((await readState()).rows).toEqual(before.rows);
      const payments = await admin.query<{ count: number }>('SELECT count(*)::int AS count FROM subscription_payment WHERE tenant_id=$1', [workspace.tenantId]);
      expect(payments.rows[0]?.count).toBe(0);
    },
  );

  it('allows the exact limits despite pending invitations and retains normal reservation checks', async () => {
    const workspace = await createStorefrontWorkspace('boundary_pending');
    await changeTenantPlan(command(workspace.tenantId, 'growth', 'boundary-upgrade'));
    await withTenantTransaction(workspace.tenantId, 'owner-test', (client) => client.query(
      `INSERT INTO physical_asset(tenant_id,branch_id,variant_id,asset_code)
       SELECT $1,$2,$3,'boundary-' || n FROM generate_series(1,298) n`,
      [workspace.tenantId, workspace.branchId, workspace.variantIds.m],
    ));
    await createTestMembership(workspace.tenantId, 'boundary_desk_2', 'frontdesk');
    await createTestMembership(workspace.tenantId, 'boundary_desk_3', 'frontdesk');
    const inactive = await createTestMembership(workspace.tenantId, 'boundary_inactive', 'frontdesk');
    await admin.query("UPDATE membership SET status='suspended' WHERE id=$1", [inactive]);
    await admin.query(`INSERT INTO membership_invitation
      (tenant_id,recipient_email_digest,recipient_email_ciphertext,status,expires_at,clerk_invitation_id,business_key)
      VALUES ($1,'boundary-digest','synthetic-ciphertext','pending',now()+interval '7 days','boundary-clerk','boundary-key')`, [workspace.tenantId]);
    await expect(changeTenantPlan(command(workspace.tenantId, 'standard', 'boundary-downgrade')))
      .resolves.toMatchObject({ changed: true, plan_code: 'standard' });
    const invitations = await admin.query<{ status: string }>('SELECT status FROM membership_invitation WHERE tenant_id=$1', [workspace.tenantId]);
    expect(invitations.rows).toEqual([{ status: 'pending' }]);
    await expect(withTenantTransaction(workspace.tenantId, 'owner-test', (client) =>
      assertFrontDeskSeatCapacity(client, workspace.tenantId, 1),
    )).rejects.toMatchObject({ code: 'CAPACITY_CONFLICT' });
  });

  it('reports both exceeded limits and leaves the current plan unchanged', async () => {
    const workspace = await createStorefrontWorkspace('both_capacity');
    await changeTenantPlan(command(workspace.tenantId, 'growth', 'both-upgrade'));
    await withTenantTransaction(workspace.tenantId, 'owner-test', (client) => client.query(
      `INSERT INTO physical_asset(tenant_id,branch_id,variant_id,asset_code)
       SELECT $1,$2,$3,'both-' || n FROM generate_series(1,299) n`,
      [workspace.tenantId, workspace.branchId, workspace.variantIds.m],
    ));
    for (let n = 2; n <= 4; n += 1) await createTestMembership(workspace.tenantId, `both_desk_${n}`, 'frontdesk');
    await expect(changeTenantPlan(command(workspace.tenantId, 'standard', 'both-downgrade'))).rejects.toMatchObject({
      code: 'CAPACITY_CONFLICT',
      message: expect.stringMatching(/active garments: 301 used, 300 allowed; active Front Desk staff: 4 used, 3 allowed/) as unknown,
    });
    const actual = await withTenantTransaction(workspace.tenantId, 'owner-test', (client) => resolveTenantEntitlements(client, workspace.tenantId));
    expect(actual.planCode).toBe('growth');
  });

  it('blocks a plan change while a payment is pending', async () => {
    const workspace = await createStorefrontWorkspace('paid_pending');
    await admin.query(`INSERT INTO subscription_payment(tenant_id,subscription_id,target_plan_id,amount_minor,currency,status,collection_method,business_key)
      SELECT s.tenant_id,s.id,p.id,p.monthly_minor,p.currency,'pending','manual_qr','pending-test'
      FROM subscription s JOIN plan p ON p.id=s.plan_id WHERE s.tenant_id=$1`, [workspace.tenantId]);
    await expect(changeTenantPlan(command(workspace.tenantId, 'growth', 'pending-change'))).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_PENDING' });
  });

  it('keeps the current plan and all garments when a downgrade exceeds its limit', async () => {
    const workspace = await createStorefrontWorkspace('paid_capacity');
    await withTenantTransaction(workspace.tenantId, 'owner-test', (client) => client.query(
      `INSERT INTO physical_asset(tenant_id,branch_id,variant_id,asset_code)
       SELECT $1,$2,$3,'extra-' || n FROM generate_series(1,299) n`,
      [workspace.tenantId, workspace.branchId, workspace.variantIds.m],
    ));
    await changeTenantPlan(command(workspace.tenantId, 'growth', 'upgrade-first'));
    await expect(changeTenantPlan(command(workspace.tenantId, 'standard', 'over-limit'))).rejects.toMatchObject({ code: 'CAPACITY_CONFLICT' });
    const actual = await withTenantTransaction(workspace.tenantId, 'owner-test', (client) => resolveTenantEntitlements(client, workspace.tenantId));
    expect(actual.planCode).toBe('growth');
    const count = await admin.query<{ count: number }>('SELECT count(*)::int AS count FROM physical_asset WHERE tenant_id=$1', [workspace.tenantId]);
    expect(count.rows[0]?.count).toBe(301);
  });
});
