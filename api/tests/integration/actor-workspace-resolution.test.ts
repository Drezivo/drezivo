import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';
import { STANDARD_PLAN } from './helpers/standard-plan.js';

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

describe('TBF-031 actor and workspace resolution', async () => {
  const { closePool, withGlobalTransaction, withTenantTransaction } =
    await import('../../src/db/client.js');
  const { listActorWorkspaces, resolveActorContext } =
    await import('../../src/modules/tenancy/tenancy.repository.js');
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

  async function createWorkspace(input: {
    principalId: string;
    clerkOrgId: string;
    role?: 'owner' | 'frontdesk';
    tenantStatus?: 'active' | 'restricted' | 'cancelled';
    membershipStatus?: 'active' | 'suspended' | 'removed';
    permissionCodes?: string[];
    branchCount?: number;
  }) {
    const tenant = await createTestTenant({ clerkOrgId: input.clerkOrgId });
    if (input.tenantStatus && input.tenantStatus !== 'active') {
      await withTenantTransaction(tenant.id, input.principalId, (client) =>
        client.query('UPDATE tenant SET status = $1 WHERE id = $2', [input.tenantStatus, tenant.id]),
      );
    }
    const membershipId = await createTestMembership(
      tenant.id,
      input.principalId,
      input.role ?? 'owner',
    );
    if (input.membershipStatus && input.membershipStatus !== 'active') {
      await withTenantTransaction(tenant.id, input.principalId, async (client) => {
        await client.query('UPDATE membership SET status = $1 WHERE id = $2', [
          input.membershipStatus,
          membershipId,
        ]);
      });
    }

    const branchIds: string[] = [];
    const branchCount = input.branchCount ?? 1;
    for (let index = 0; index < branchCount; index += 1) {
      const branchId = await withTenantTransaction(tenant.id, input.principalId, async (client) => {
        const branch = await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
           VALUES ($1, $2, $3, $4, 'Asia/Manila', 'active')
           RETURNING id`,
          [
            tenant.id,
            index === 0 ? 'Main Branch' : `Branch ${index + 1}`,
            index === 0 ? 'main' : `branch-${index + 1}`,
            index === 0,
          ],
        );
        const row = branch.rows[0];
        if (!row) throw new Error('branch insert returned no row');
        await client.query(
          `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [
            tenant.id,
            row.id,
            membershipId,
            JSON.stringify(input.permissionCodes ?? ['assets.manage']),
          ],
        );
        return row.id;
      });
      branchIds.push(branchId);
    }

    await withTenantTransaction(tenant.id, input.principalId, async (client) => {
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true LIMIT 1`,
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('starter plan seed is missing');
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );
    });
    return { ...tenant, membershipId, branchIds };
  }

  it('lists only active memberships and resolves the selected branch grant', async () => {
    const principalId = 'user_tbf031_owner';
    const first = await createWorkspace({
      principalId,
      clerkOrgId: 'org_tbf031_first',
      permissionCodes: ['assets.manage', 'reservations.manage'],
      branchCount: 2,
    });
    await createWorkspace({ principalId, clerkOrgId: 'org_tbf031_second', role: 'frontdesk' });
    await createWorkspace({
      principalId,
      clerkOrgId: 'org_tbf031_suspended',
      membershipStatus: 'suspended',
    });

    const page = await listActorWorkspaces(principalId, undefined, 20);
    expect(page.items.map((item) => item.clerk_org_id).sort()).toEqual([
      'org_tbf031_first',
      'org_tbf031_second',
    ]);
    expect(page.items[0]).not.toHaveProperty('membership_id');
    expect(page.items.find((item) => item.clerk_org_id === 'org_tbf031_second')?.role).toBe(
      'frontdesk',
    );

    const context = await resolveActorContext({
      principalId,
      clerkOrgId: 'org_tbf031_first',
      ...(first.branchIds[1] ? { branchId: first.branchIds[1] } : {}),
    });
    expect(context.kind).toBe('resolved');
    if (context.kind !== 'resolved') throw new Error('expected resolved actor context');
    expect(context.context.active_branch_id).toBe(first.branchIds[1]);
    expect(context.context.branch_grants).toHaveLength(2);
    expect(context.context.activePermissionCodes).toEqual([
      'assets.manage',
      'reservations.manage',
    ]);
    expect(context.context.entitlements).toEqual({
      physical_assets_max: STANDARD_PLAN.physicalAssetsMax,
      frontdesk_seats_max: STANDARD_PLAN.frontdeskSeatsMax,
    });
  });

  it('fails closed for unknown, foreign, suspended, and missing branch contexts', async () => {
    await createWorkspace({
      principalId: 'user_tbf031_suspended',
      clerkOrgId: 'org_tbf031_suspended_only',
      membershipStatus: 'suspended',
    });
    const unknown = await resolveActorContext({
      principalId: 'user_tbf031_owner',
      clerkOrgId: 'org_tbf031_unknown',
    });
    const foreign = await resolveActorContext({
      principalId: 'user_tbf031_other',
      clerkOrgId: 'org_tbf031_suspended_only',
    });
    const suspended = await resolveActorContext({
      principalId: 'user_tbf031_suspended',
      clerkOrgId: 'org_tbf031_suspended_only',
    });
    expect(unknown).toEqual({ kind: 'not_found' });
    expect(foreign).toEqual({ kind: 'forbidden' });
    expect(suspended).toEqual({ kind: 'forbidden' });
  });

  it('keeps global workspace discovery isolated from tenant-scoped transactions', async () => {
    const owner = await createWorkspace({
      principalId: 'user_tbf031_isolation',
      clerkOrgId: 'org_tbf031_isolation',
    });
    const other = await createWorkspace({
      principalId: 'user_tbf031_other_isolation',
      clerkOrgId: 'org_tbf031_other_isolation',
    });

    const foreignPage = await listActorWorkspaces('user_tbf031_other', undefined, 20);
    expect(foreignPage.items).toEqual([]);

    const scoped = await withTenantTransaction(
      owner.id,
      'user_tbf031_isolation',
      async (client) => {
        const memberships = await client.query('SELECT id FROM membership WHERE tenant_id = $1', [
          other.id,
        ]);
        const resolver = await client.query(
          `SELECT tenant_id FROM resolve_actor_workspaces(NULL, NULL, 20)`,
        );
        return { memberships: memberships.rows, resolver: resolver.rows };
      },
    );
    expect(scoped.memberships).toEqual([]);
    expect(scoped.resolver).toEqual([]);

    const ownerPage = await withGlobalTransaction('user_tbf031_isolation', async (client) => {
      const result = await client.query<{ clerk_org_id: string }>(
        `SELECT clerk_org_id FROM resolve_actor_workspaces(NULL, NULL, 20)`,
      );
      return result.rows;
    });
    expect(ownerPage).toEqual([{ clerk_org_id: 'org_tbf031_isolation' }]);
  });

  it('maps restricted and cancelled lifecycle states without denying context resolution', async () => {
    const restricted = await createWorkspace({
      principalId: 'user_tbf031_lifecycle',
      clerkOrgId: 'org_tbf031_restricted',
      tenantStatus: 'restricted',
    });
    const cancelled = await createWorkspace({
      principalId: 'user_tbf031_lifecycle',
      clerkOrgId: 'org_tbf031_cancelled',
      tenantStatus: 'cancelled',
    });
    const restrictedContext = await resolveActorContext({
      principalId: 'user_tbf031_lifecycle',
      clerkOrgId: 'org_tbf031_restricted',
    });
    const cancelledContext = await resolveActorContext({
      principalId: 'user_tbf031_lifecycle',
      clerkOrgId: 'org_tbf031_cancelled',
    });
    expect(restrictedContext.kind).toBe('resolved');
    expect(cancelledContext.kind).toBe('resolved');
    if (restrictedContext.kind === 'resolved' && cancelledContext.kind === 'resolved') {
      expect(restrictedContext.context.effectiveTenantStatus).toBe('restricted');
      expect(cancelledContext.context.effectiveTenantStatus).toBe('cancelled');
      expect(restrictedContext.context.activePermissionCodes).toEqual([]);
      expect(cancelledContext.context.activePermissionCodes).toEqual([]);
      expect(restrictedContext.context.branch_grants.length).toBeGreaterThan(0);
      expect(cancelledContext.context.branch_grants.length).toBeGreaterThan(0);
    }
    expect(restricted.id).not.toBe(cancelled.id);
  });
});
