import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ClerkServerAdapter } from '../../src/integrations/clerk/clerk.adapter.js';

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

describe('TBF-042 verified invitation claim', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { createMembershipInvitation } = await import(
    '../../src/modules/membership-invitations/membership-invitations.service.js'
  );
  const { claimMembershipInvitation } = await import(
    '../../src/modules/membership-invitations/membership-invitation-claim.service.js'
  );
  const { createTestMembership, createTestTenant, testKey } = await import('./helpers/factories.js');
  const { actorContext } = await import('@drezivo/contracts');
  const { randomUUID } = await import('node:crypto');

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

  it('creates one local Front Desk membership and replays the safe actor context', async () => {
    const tenant = await createTestTenant({ clerkOrgId: `org_tbf042_${randomUUID()}` });
    const ownerUserId = `user_owner_${randomUUID()}`;
    const ownerMembershipId = await createTestMembership(tenant.id, ownerUserId, 'owner');
    const branch = await withTenantTransaction(tenant.id, ownerUserId, async (client) => {
      const branchResult = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, address, operating_hours)
         VALUES (
           $1,
           'Main Branch',
           'main',
           true,
           'Asia/Manila',
           '{}'::jsonb,
           '{"opens_local":"08:00","closes_local":"20:00","closed_weekdays":["sunday"]}'::jsonb
         )
         RETURNING id`,
        [tenant.id],
      );
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'professional' AND version = 1 AND active = true`,
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('Professional plan seed is missing.');
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, trial_ends_at,
           current_period_start, current_period_end)
         VALUES ($1, $2, 'trialing', now() + interval '14 days', now(), now() + interval '14 days')`,
        [tenant.id, planId],
      );
      return branchResult.rows[0]?.id;
    });
    if (!branch) throw new Error('Main branch factory returned no row.');

    const invitation = await createMembershipInvitation({
      tenantId: tenant.id,
      membershipId: ownerMembershipId,
      principalId: ownerUserId,
      requestId: 'req-tbf042-create',
      idempotencyKey: 'tbf042-create',
      request: { email: 'claimant@example.test' },
    });
    const invitationId = String((invitation.body.data as { id: string }).id);
    const claimantUserId = `user_claimant_${randomUUID()}`;
    const providerInvitation = {
      id: `orginv_${randomUUID()}`,
      organizationId: tenant.clerkOrgId,
      emailAddress: 'redacted@example.test',
      role: 'org:member' as const,
      status: 'accepted' as const,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
    const providerMembership = {
      id: `orgmem_${randomUUID()}`,
      organizationId: tenant.clerkOrgId,
      userId: claimantUserId,
      role: 'org:member' as const,
    };
    const getOrganizationMembership = vi.fn().mockResolvedValue(providerMembership);
    const clerk = {
      findInvitationByDispatchMarker: vi
        .fn()
        .mockResolvedValueOnce(providerInvitation)
        .mockResolvedValueOnce(null),
      findInvitation: vi.fn().mockResolvedValue(providerInvitation),
      getOrganizationMembership,
    } as unknown as ClerkServerAdapter;

    const first = await claimMembershipInvitation({
      invitationId,
      clerkUserId: claimantUserId,
      clerkOrgId: tenant.clerkOrgId,
      requestId: 'req-tbf042-claim-1',
      idempotencyKey: testKey('tbf042-claim'),
      clerk,
    });
    const replay = await claimMembershipInvitation({
      invitationId,
      clerkUserId: claimantUserId,
      clerkOrgId: tenant.clerkOrgId,
      requestId: 'req-tbf042-claim-2',
      idempotencyKey: testKey('tbf042-claim'),
      clerk,
    });

    expect(first.status).toBe(200);
    expect(actorContext.safeParse((first.body as { data: unknown }).data).success).toBe(true);
    expect(replay).toEqual(first);
    expect(getOrganizationMembership).toHaveBeenCalledTimes(1);

    const rows = await withTenantTransaction(tenant.id, claimantUserId, (client) =>
      client.query<{ membership_count: number; accepted_count: number; grant: unknown }>(
        `SELECT
           (SELECT count(*)::int FROM membership WHERE tenant_id = $1 AND clerk_user_id = $2) AS membership_count,
           (SELECT count(*)::int FROM membership_invitation WHERE tenant_id = $1 AND id = $3 AND status = 'accepted') AS accepted_count,
           (SELECT permission_codes FROM branch_membership WHERE tenant_id = $1 AND membership_id =
              (SELECT id FROM membership WHERE tenant_id = $1 AND clerk_user_id = $2)) AS grant`,
        [tenant.id, claimantUserId, invitationId],
      ),
    );
    const row = rows.rows[0];
    expect(row?.membership_count).toBe(1);
    expect(row?.accepted_count).toBe(1);
    expect(Array.isArray(row?.grant)).toBe(true);
    if (Array.isArray(row?.grant)) {
      expect(row.grant).toEqual(expect.arrayContaining(['assets.manage', 'exports.request']));
    }
  });
});
