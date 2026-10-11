import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
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
  const { closePool, withSystemTenantTransaction, withTenantTransaction } =
    await import('../../src/db/client.js');
  const { createMembershipInvitation } =
    await import('../../src/modules/membership-invitations/membership-invitations.service.js');
  const { claimMembershipInvitation } =
    await import('../../src/modules/membership-invitations/membership-invitation-claim.service.js');
  const { removeTenantMember } = await import('../../src/modules/members/members.service.js');
  const { createMemberRemovalDispatchHandler, MEMBER_REMOVAL_EVENT_TYPE } =
    await import('../../src/modules/members/members.removal-dispatcher.js');
  const { createMembershipInvitationDispatchHandler } =
    await import('../../src/modules/membership-invitations/membership-invitations.dispatcher.js');
  const { DeferredOutboxError } = await import('../../src/worker/runner.js');
  const { createTestMembership, createTestTenant, testKey } =
    await import('./helpers/factories.js');
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
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true`,
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('Standard plan seed is missing.');
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

  it('re-invites a removed member with a fresh link and restores the same membership only after acceptance', async () => {
    const tenant = await createTestTenant({ clerkOrgId: `org_tbf042_reinvite_${randomUUID()}` });
    const ownerUserId = `user_owner_${randomUUID()}`;
    const ownerMembershipId = await createTestMembership(tenant.id, ownerUserId, 'owner');
    const branch = await withTenantTransaction(tenant.id, ownerUserId, async (client) => {
      const branchResult = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, address, operating_hours)
         VALUES ($1, 'Main Branch', 'main', true, 'Asia/Manila', '{}'::jsonb,
           '{"opens_local":"08:00","closes_local":"20:00","closed_weekdays":[]}'::jsonb)
         RETURNING id`,
        [tenant.id],
      );
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true`,
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('Standard plan seed is missing.');
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, trial_ends_at,
           current_period_start, current_period_end)
         VALUES ($1, $2, 'trialing', now() + interval '14 days', now(), now() + interval '14 days')`,
        [tenant.id, planId],
      );
      return branchResult.rows[0]?.id;
    });
    if (!branch) throw new Error('Main branch fixture is missing.');

    const firstInvite = await createMembershipInvitation({
      tenantId: tenant.id,
      membershipId: ownerMembershipId,
      principalId: ownerUserId,
      requestId: 'req-tbf042-reinvite-first',
      idempotencyKey: testKey('tbf042-reinvite-first'),
      request: { email: 'former-member@example.test' },
    });
    const firstInvitationId = String((firstInvite.body.data as { id: string }).id);
    const claimantUserId = `user_claimant_${randomUUID()}`;
    type TestProviderInvitation = {
      id: string;
      organizationId: string;
      emailAddress: string;
      role: 'org:member';
      status: 'accepted' | 'pending';
      expiresAt: Date;
    };
    const providerInvitations = new Map<string, TestProviderInvitation>();
    providerInvitations.set(firstInvitationId, {
      id: `orginv_${randomUUID()}`,
      organizationId: tenant.clerkOrgId,
      emailAddress: 'former-member@example.test',
      role: 'org:member',
      status: 'accepted',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    let providerMembership: {
      id: string;
      organizationId: string;
      userId: string;
      role: 'org:member';
    } | null = {
      id: `orgmem_${randomUUID()}`,
      organizationId: tenant.clerkOrgId,
      userId: claimantUserId,
      role: 'org:member',
    };
    const freshDispatch = { invitation: null as TestProviderInvitation | null };
    const createInvitation = vi.fn((request: { organizationId: string; emailAddress: string }) => {
      const invitation: TestProviderInvitation = {
        id: `orginv_${randomUUID()}`,
        organizationId: request.organizationId,
        emailAddress: request.emailAddress,
        role: 'org:member',
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      freshDispatch.invitation = invitation;
      return invitation;
    });
    const clerk = {
      findInvitationByDispatchMarker: vi.fn(
        (_orgId: string, marker: { invitationId: string; operation: string }) =>
          marker.operation === 'create'
            ? (providerInvitations.get(marker.invitationId) ?? null)
            : null,
      ),
      findInvitation: vi.fn(
        (_orgId: string, providerId: string) =>
          [...providerInvitations.values()].find((invitation) => invitation.id === providerId) ??
          null,
      ),
      findInvitationsByInvitationId: vi.fn().mockResolvedValue([]),
      getOrganizationMembership: vi.fn(() => providerMembership),
      deleteMembership: vi.fn(() => providerMembership),
      createInvitation,
      revokeInvitationIfPresent: vi.fn().mockResolvedValue(null),
    } as unknown as ClerkServerAdapter;

    const firstClaim = await claimMembershipInvitation({
      invitationId: firstInvitationId,
      clerkUserId: claimantUserId,
      clerkOrgId: tenant.clerkOrgId,
      requestId: 'req-tbf042-reinvite-claim-first',
      idempotencyKey: testKey('tbf042-reinvite-claim-first'),
      clerk,
    });
    expect(firstClaim.status).toBe(200);
    const originalMembership = await withTenantTransaction(
      tenant.id,
      claimantUserId,
      async (client) => {
        const result = await client.query<{ id: string; claimed_membership_id: string | null }>(
          `SELECT m.id, i.claimed_membership_id
           FROM membership m
           JOIN membership_invitation i
             ON i.tenant_id = m.tenant_id AND i.claimed_membership_id = m.id
          WHERE m.tenant_id = $1 AND m.clerk_user_id = $2 AND i.id = $3`,
          [tenant.id, claimantUserId, firstInvitationId],
        );
        return result.rows[0];
      },
    );
    expect(originalMembership?.claimed_membership_id).toBe(originalMembership?.id);
    if (!originalMembership) throw new Error('Claim did not persist the local membership link.');

    // Simulate a legacy accepted row and run the actual migration backfill against its claim audit.
    await withTenantTransaction(tenant.id, claimantUserId, (client) =>
      client.query('UPDATE membership_invitation SET claimed_membership_id = NULL WHERE id = $1', [
        firstInvitationId,
      ]),
    );
    const migrationSql = await readFile(
      new URL(
        '../../src/db/migrations/0077_membership_invitation_claimed_membership.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const backfillSql = migrationSql.match(/DO \$\$[\s\S]*?END \$\$;/)?.[0];
    if (!backfillSql) throw new Error('Invitation membership-link backfill block is missing.');
    const adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    try {
      await adminClient.query(backfillSql);
    } finally {
      await adminClient.end();
    }
    const backfilledId = await withTenantTransaction(tenant.id, claimantUserId, async (client) => {
      const result = await client.query<{ claimed_membership_id: string }>(
        'SELECT claimed_membership_id FROM membership_invitation WHERE tenant_id = $1 AND id = $2',
        [tenant.id, firstInvitationId],
      );
      return result.rows[0]?.claimed_membership_id;
    });
    expect(backfilledId).toBe(originalMembership.id);

    const removal = await removeTenantMember({
      tenantId: tenant.id,
      membershipId: ownerMembershipId,
      principalId: ownerUserId,
      requestId: 'req-tbf042-reinvite-remove',
      idempotencyKey: testKey('tbf042-reinvite-remove'),
      targetMembershipId: originalMembership.id,
    });
    expect(removal.status).toBe(200);

    const oldLinkAttempt = await claimMembershipInvitation({
      invitationId: firstInvitationId,
      clerkUserId: claimantUserId,
      clerkOrgId: tenant.clerkOrgId,
      requestId: 'req-tbf042-reinvite-old-link',
      idempotencyKey: testKey('tbf042-reinvite-old-link'),
      clerk,
    });
    expect(oldLinkAttempt.status).toBe(404);
    const removedStatus = await withTenantTransaction(tenant.id, claimantUserId, async (client) => {
      const result = await client.query<{ status: string }>(
        'SELECT status FROM membership WHERE tenant_id = $1 AND id = $2',
        [tenant.id, originalMembership.id],
      );
      return result.rows[0]?.status;
    });
    expect(removedStatus).toBe('removed');

    const freshInvite = await createMembershipInvitation({
      tenantId: tenant.id,
      membershipId: ownerMembershipId,
      principalId: ownerUserId,
      requestId: 'req-tbf042-reinvite-fresh',
      idempotencyKey: testKey('tbf042-reinvite-fresh'),
      request: { email: ' Former-Member@Example.Test ' },
    });
    const freshInvitationId = String((freshInvite.body.data as { id: string }).id);
    expect(freshInvite.status).toBe(200);
    expect(freshInvitationId).not.toBe(firstInvitationId);
    expect(freshInvite.body.data).toMatchObject({ id: freshInvitationId, status: 'pending' });

    const outbox = await withSystemTenantTransaction(
      tenant.id,
      'worker:test-outbox',
      async (client) => {
        const rows = await client.query<{
          id: string;
          dedupe_key: string;
          event_type: string;
          payload: Record<string, unknown>;
          attempts: number;
          max_attempts: number;
        }>(
          `SELECT id, dedupe_key, event_type, payload, attempts, max_attempts
           FROM outbox_event
          WHERE tenant_id = $1
            AND event_type IN ($2, 'clerk.invitation.dispatch_requested')
          ORDER BY created_at`,
          [tenant.id, MEMBER_REMOVAL_EVENT_TYPE],
        );
        return rows.rows;
      },
    );
    const removalEvent = outbox.find((row) => row.event_type === MEMBER_REMOVAL_EVENT_TYPE);
    const inviteEvent = outbox.find(
      (row) =>
        row.event_type === 'clerk.invitation.dispatch_requested' &&
        row.payload.invitation_id === freshInvitationId,
    );
    if (!removalEvent || !inviteEvent)
      throw new Error('Expected removal and fresh-invite outbox events.');
    const removeHandler = createMemberRemovalDispatchHandler({
      clerk,
      runTenantTransaction: withSystemTenantTransaction,
    });
    const inviteHandler = createMembershipInvitationDispatchHandler({
      clerk,
      decryptEmail: () => 'former-member@example.test',
      runTenantTransaction: withSystemTenantTransaction,
      staffAppUrl: 'http://localhost:3000',
    });
    await expect(
      inviteHandler({ ...inviteEvent, tenant_id: tenant.id, _leaseToken: 'invite-lease' }),
    ).rejects.toBeInstanceOf(DeferredOutboxError);
    expect(createInvitation).not.toHaveBeenCalled();

    await removeHandler({ ...removalEvent, tenant_id: tenant.id, _leaseToken: 'remove-lease' });
    await withSystemTenantTransaction(tenant.id, 'worker:test-outbox', (client) =>
      client.query("UPDATE outbox_event SET status = 'succeeded' WHERE id = $1", [removalEvent.id]),
    );
    providerMembership = null;
    await inviteHandler({ ...inviteEvent, tenant_id: tenant.id, _leaseToken: 'invite-lease-2' });
    expect(createInvitation).toHaveBeenCalledTimes(1);

    const createdFreshInvitation = freshDispatch.invitation;
    if (!createdFreshInvitation) {
      throw new Error('Fresh invitation dispatch did not create a provider invitation.');
    }
    const acceptedFreshInvitation = { ...createdFreshInvitation, status: 'accepted' as const };
    providerInvitations.set(freshInvitationId, acceptedFreshInvitation);
    providerMembership = {
      id: `orgmem_${randomUUID()}`,
      organizationId: tenant.clerkOrgId,
      userId: claimantUserId,
      role: 'org:member',
    };
    const freshClaim = await claimMembershipInvitation({
      invitationId: freshInvitationId,
      clerkUserId: claimantUserId,
      clerkOrgId: tenant.clerkOrgId,
      requestId: 'req-tbf042-reinvite-claim-fresh',
      idempotencyKey: testKey('tbf042-reinvite-claim-fresh'),
      clerk,
    });
    expect(freshClaim.status).toBe(200);

    const finalState = await withTenantTransaction(tenant.id, claimantUserId, async (client) => {
      const result = await client.query<{
        membership_count: number;
        membership_id: string;
        member_status: string;
        old_invitation_status: string;
        old_claimed_membership_id: string;
        fresh_invitation_status: string;
        fresh_claimed_membership_id: string;
      }>(
        `SELECT
           (SELECT count(*)::int FROM membership WHERE tenant_id = $1 AND clerk_user_id = $2) AS membership_count,
           m.id AS membership_id,
           m.status AS member_status,
           old_invite.status AS old_invitation_status,
           old_invite.claimed_membership_id AS old_claimed_membership_id,
           new_invite.status AS fresh_invitation_status,
           new_invite.claimed_membership_id AS fresh_claimed_membership_id
         FROM membership m
         JOIN membership_invitation old_invite ON old_invite.tenant_id = m.tenant_id AND old_invite.id = $3
         JOIN membership_invitation new_invite ON new_invite.tenant_id = m.tenant_id AND new_invite.id = $4
         WHERE m.tenant_id = $1 AND m.clerk_user_id = $2`,
        [tenant.id, claimantUserId, firstInvitationId, freshInvitationId],
      );
      return result.rows[0];
    });
    expect(finalState).toMatchObject({
      membership_count: 1,
      membership_id: originalMembership.id,
      member_status: 'active',
      old_invitation_status: 'accepted',
      old_claimed_membership_id: originalMembership.id,
      fresh_invitation_status: 'accepted',
      fresh_claimed_membership_id: originalMembership.id,
    });
  });
});
