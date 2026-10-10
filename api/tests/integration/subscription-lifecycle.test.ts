import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX ??= '10';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('TBF-033 subscription lifecycle and gates', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { changeTrialPlan, reconcileTenantLifecycle } =
    await import('../../src/modules/billing/billing.service.js');
  const { resolveActorContext } = await import('../../src/modules/tenancy/tenancy.repository.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('transitions an expired trial to past_due and preserves the seven-day grace boundary', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_tbf033_trial' });
    const ownerId = 'user_tbf033_trial';
    await createTestMembership(tenant.id, ownerId, 'owner');
    await seedSubscription(tenant.id, 'standard', "now() - interval '1 second'");

    const result = await withTenantTransaction(tenant.id, ownerId, (client) =>
      reconcileTenantLifecycle(client, tenant.id, {
        actorKey: ownerId,
        requestId: 'req-tbf033-trial',
      }),
    );

    expect(result.transitions).toEqual(['past_due']);
    const state = await readLifecycleState(tenant.id);
    expect(state.subscription_status).toBe('past_due');
    expect(state.tenant_status).toBe('active');
    if (!state.grace_ends_at || !state.trial_ends_at) throw new Error('Missing trial boundary');
    expect(new Date(state.grace_ends_at).getTime()).toBe(
      new Date(state.trial_ends_at).getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    expect(state.event_count).toBe(1);
    expect(state.audit_count).toBe(1);
  });

  it('catches up an overdue grace period without extending it and is replay-safe', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_tbf033_grace' });
    const ownerId = 'user_tbf033_grace';
    await createTestMembership(tenant.id, ownerId, 'owner');
    await seedSubscription(tenant.id, 'standard', "now() - interval '15 days'");

    const first = await withTenantTransaction(tenant.id, ownerId, (client) =>
      reconcileTenantLifecycle(client, tenant.id, {
        actorKey: ownerId,
        requestId: 'req-tbf033-grace',
      }),
    );
    const second = await withTenantTransaction(tenant.id, ownerId, (client) =>
      reconcileTenantLifecycle(client, tenant.id, {
        actorKey: ownerId,
        requestId: 'req-tbf033-grace-replay',
      }),
    );

    expect(first.transitions).toEqual(['past_due', 'restricted']);
    expect(second.transitions).toEqual([]);
    const state = await readLifecycleState(tenant.id);
    expect(state.subscription_status).toBe('restricted');
    expect(state.tenant_status).toBe('restricted');
    if (!state.grace_ends_at || !state.trial_ends_at) throw new Error('Missing grace boundary');
    expect(new Date(state.grace_ends_at).getTime()).toBe(
      new Date(state.trial_ends_at).getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    expect(state.event_count).toBe(2);
    expect(state.audit_count).toBe(2);
  });

  // Pilot (SUBSCRIPTION_LIFECYCLE_SWEEP_ENABLED=false): reading the actor context must not move the
  // subscription; access is derived from the stored dates instead (billing/access.ts).
  it('derives read-only access for an ended trial without rewriting lifecycle state', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_tbf033_context' });
    const ownerId = 'user_tbf033_context';
    const membershipId = await createTestMembership(tenant.id, ownerId, 'owner');
    await seedWorkspaceBranch(tenant.id, membershipId, ownerId);
    await seedSubscription(tenant.id, 'standard', "now() - interval '15 days'");

    const result = await resolveActorContext({
      principalId: ownerId,
      clerkOrgId: tenant.clerkOrgId,
      requestId: 'req-tbf033-context',
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.context.subscription.status).toBe('trialing');
      expect(result.context.tenant.status).toBe('active');
      expect(result.context.access).toMatchObject({
        level: 'read_only',
        reason: 'trial_ended',
        storefront_online: false,
      });
    }
    const state = await readLifecycleState(tenant.id);
    expect(state.subscription_status).toBe('trialing');
    expect(state.event_count).toBe(0);
  });

  it('does not allow a workspace to switch tiers after setup', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_tbf033_plan_change' });
    const ownerId = 'user_tbf033_plan_change';
    const membershipId = await createTestMembership(tenant.id, ownerId, 'owner');
    await seedSubscription(tenant.id, 'standard', "now() + interval '6 days'");

    const result = await changeTrialPlan({
      tenantId: tenant.id,
      membershipId,
      principalId: ownerId,
      requestId: 'req-tbf033-plan-change',
      idempotencyKey: 'tbf033-plan-change-key',
      request: { plan_code: 'starter' },
    });

    expect(result).toMatchObject({
      status: 409,
      body: { success: false, error: { code: 'STATE_CONFLICT' } },
    });
    const events = await withTenantTransaction(tenant.id, ownerId, (client) =>
      client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM subscription_event WHERE tenant_id = $1 AND event_type = 'plan_changed'`,
        [tenant.id],
      ),
    );
    expect(events.rows[0]?.count).toBe(0);
  });

  it('rejects plan changes from a Front Desk membership', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_tbf033_owner_only' });
    const ownerId = 'user_tbf033_owner_only';
    await createTestMembership(tenant.id, ownerId, 'owner');
    const frontdeskMembershipId = await createTestMembership(
      tenant.id,
      'user_tbf033_frontdesk',
      'frontdesk',
    );
    await seedSubscription(tenant.id, 'standard', "now() + interval '6 days'");

    await expect(
      changeTrialPlan({
        tenantId: tenant.id,
        membershipId: frontdeskMembershipId,
        principalId: 'user_tbf033_frontdesk',
        requestId: 'req-tbf033-owner-only',
        idempotencyKey: 'tbf033-owner-only-key',
        request: { plan_code: 'standard' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  async function seedSubscription(
    tenantId: string,
    planCode: 'standard',
    trialEndsExpression: string,
  ): Promise<void> {
    await withTenantTransaction(tenantId, `seed:${tenantId}`, async (client) => {
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = $1 AND version = 1 AND active = true`,
        [planCode],
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error(`Missing ${planCode} seed`);
      await client.query(
        `INSERT INTO subscription
           (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
         VALUES ($1, $2, 'trialing', ${trialEndsExpression}, now(), now() + interval '14 days')`,
        [tenantId, planId],
      );
    });
  }

  async function seedWorkspaceBranch(
    tenantId: string,
    membershipId: string,
    principalId: string,
  ): Promise<void> {
    await withTenantTransaction(tenantId, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'main', true, 'Asia/Manila', 'active')
         RETURNING id`,
        [tenantId],
      );
      const branchId = branch.rows[0]?.id;
      if (!branchId) throw new Error('Missing branch');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenantId, branchId, membershipId, JSON.stringify(['assets.manage'])],
      );
    });
  }

  async function readLifecycleState(tenantId: string) {
    const result = await withTenantTransaction(tenantId, `read:${tenantId}`, (client) =>
      client.query<{
        tenant_status: string;
        subscription_status: string;
        trial_ends_at: Date | null;
        grace_ends_at: Date | null;
        event_count: number;
        audit_count: number;
      }>(
        `SELECT t.status AS tenant_status, s.status AS subscription_status,
                s.trial_ends_at, s.grace_ends_at,
                (SELECT count(*)::int FROM subscription_event e WHERE e.tenant_id = t.id) AS event_count,
                (SELECT count(*)::int FROM audit_event a WHERE a.tenant_id = t.id) AS audit_count
           FROM tenant t JOIN subscription s ON s.tenant_id = t.id
          WHERE t.id = $1`,
        [tenantId],
      ),
    );
    const state = result.rows[0];
    if (!state) throw new Error('Missing lifecycle state');
    return state;
  }
});
