import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../src/config/load-env.js';

/* Supertest response bodies are intentionally untyped in these envelope assertions. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const clerk = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getUserProfiles: vi.fn(),
  identity: { userId: null as string | null, orgId: null as string | null },
}));

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: clerk.getAuth,
}));

vi.mock('../../src/integrations/clerk/clerk.adapter.js', () => ({
  createClerkServerAdapter: () => ({
    getUserVerificationState: vi.fn().mockResolvedValue({ primaryEmailVerified: true }),
    getUserProfiles: clerk.getUserProfiles,
  }),
}));

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX ??= '10';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 2).toString('base64url');
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

interface TestWorkspace {
  tenantId: string;
  clerkOrgId: string;
  ownerId: string;
  ownerMembershipId: string;
  frontdeskId: string;
  frontdeskMembershipId: string;
}

describe('Owner member and invitation APIs', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withSystemTenantTransaction, withTenantTransaction } = await import('../../src/db/client.js');
  const { createMemberRemovalDispatchHandler, MEMBER_REMOVAL_EVENT_TYPE } =
    await import('../../src/modules/members/members.removal-dispatcher.js');
  const { digestRecipientEmail, encryptRecipientEmail } =
    await import('../../src/shared/protected-recipient.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  beforeEach(() => {
    clerk.getAuth.mockImplementation(() => clerk.identity);
    clerk.getUserProfiles.mockReset();
  });
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('returns active tenant members and seat usage, and shows recipient emails only to the owner', async () => {
    const workspace = await createWorkspace('members_owner', 'user_members_owner');
    const foreignWorkspace = await createWorkspace('members_foreign', 'user_members_foreign');
    await seedInvitation(workspace, 'pending@example.test', 'pending', 7);
    await seedInvitation(workspace, 'expired@example.test', 'pending', -1);
    await seedInvitation(foreignWorkspace, 'foreign@example.test', 'pending', 7);

    clerk.identity = { userId: workspace.ownerId, orgId: workspace.clerkOrgId };
    clerk.getUserProfiles.mockResolvedValue([
      { userId: workspace.ownerId, name: 'Owner Example', email: 'owner@example.test' },
      { userId: workspace.frontdeskId, name: 'Front Desk Example', email: 'staff@example.test' },
      { userId: foreignWorkspace.ownerId, name: 'Foreign Owner', email: 'foreign@example.test' },
    ]);

    const roster = await request(createApp()).get('/api/v1/members');
    expect(roster.status).toBe(200);
    expect(roster.body.data).toEqual({
      members: [
        {
          id: workspace.ownerMembershipId,
          name: 'Owner Example',
          email: 'owner@example.test',
          role: 'owner',
        },
        {
          id: workspace.frontdeskMembershipId,
          name: 'Front Desk Example',
          email: 'staff@example.test',
          role: 'frontdesk',
        },
      ],
      frontdesk_seats: { used: 2, max: 3 },
    });
    expect(clerk.getUserProfiles).toHaveBeenCalledWith([workspace.ownerId, workspace.frontdeskId]);

    const invitations = await request(createApp()).get('/api/v1/membership-invitations?limit=10');
    expect(invitations.status).toBe(200);
    expect(invitations.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'pending@example.test', status: 'pending' }),
        expect.objectContaining({ email: 'expired@example.test', status: 'expired' }),
      ]),
    );
    expect(invitations.body.data.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'foreign@example.test' })]),
    );
  });

  it('denies Front Desk access to the roster and invitation recipient identities', async () => {
    const workspace = await createWorkspace('members_frontdesk', 'user_members_owner_fd');
    clerk.identity = { userId: workspace.frontdeskId, orgId: workspace.clerkOrgId };
    clerk.getUserProfiles.mockResolvedValue([]);

    const roster = await request(createApp()).get('/api/v1/members');
    const invitations = await request(createApp()).get('/api/v1/membership-invitations');

    expect(roster.status).toBe(403);
    expect(invitations.status).toBe(403);
    expect(JSON.stringify(roster.body)).not.toContain('@example.test');
    expect(JSON.stringify(invitations.body)).not.toContain('@example.test');
    expect(clerk.getUserProfiles).not.toHaveBeenCalled();
  });

  it('lets the Owner remove a Front Desk member once, ending their access right away', async () => {
    const workspace = await createWorkspace('members_remove', 'user_members_remove_owner');
    clerk.identity = { userId: workspace.ownerId, orgId: workspace.clerkOrgId };
    const remove = (key: string) =>
      request(createApp())
        .post(`/api/v1/members/${workspace.frontdeskMembershipId}/remove`)
        .set('Idempotency-Key', key)
        .send({});

    // Concurrent double-fire of one intent: one removal, the same answer twice.
    const [first, second] = await Promise.all([remove('remove-member-1'), remove('remove-member-1')]);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ membership_id: workspace.frontdeskMembershipId, status: 'removed' });
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    // Sequential replay of the same intent returns the stored answer.
    const replay = await remove('remove-member-1');
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    // A new intent for an already-removed member is refused, not repeated.
    const again = await remove('remove-member-2');
    expect(again.status).toBe(409);

    const facts = await withTenantTransaction(workspace.tenantId, workspace.ownerId, async (client) => {
      const member = await client.query<{ status: string; authz_version: number }>(
        'SELECT status, authz_version FROM membership WHERE id = $1',
        [workspace.frontdeskMembershipId],
      );
      const outbox = await client.query<{ event_type: string; payload: Record<string, unknown> }>(
        'SELECT event_type, payload FROM outbox_event WHERE tenant_id = $1 AND event_type = $2',
        [workspace.tenantId, MEMBER_REMOVAL_EVENT_TYPE],
      );
      const audit = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM audit_event WHERE tenant_id = $1 AND action = $2',
        [workspace.tenantId, 'membership.removed'],
      );
      return { member: member.rows[0], outbox: outbox.rows, audit: audit.rows[0]?.n };
    });
    expect(facts.member).toEqual({ status: 'removed', authz_version: 2 });
    expect(facts.outbox).toEqual([
      {
        event_type: MEMBER_REMOVAL_EVENT_TYPE,
        payload: { membership_id: workspace.frontdeskMembershipId, authz_version: 2 },
      },
    ]);
    expect(facts.audit).toBe(1);

    // The removed member is denied on their next request; the roster and seats no longer count them.
    clerk.identity = { userId: workspace.frontdeskId, orgId: workspace.clerkOrgId };
    expect((await request(createApp()).get('/api/v1/actor-context')).status).toBe(403);
    clerk.identity = { userId: workspace.ownerId, orgId: workspace.clerkOrgId };
    clerk.getUserProfiles.mockResolvedValue([]);
    const roster = await request(createApp()).get('/api/v1/members');
    const rosterData = (roster.body as { data: { members: Array<{ id: string }>; frontdesk_seats: { used: number } } }).data;
    expect(rosterData.members.map((member) => member.id)).toEqual([workspace.ownerMembershipId]);
    expect(rosterData.frontdesk_seats.used).toBe(0);
  });

  it('refuses removal by Front Desk, of the Owner, and of unknown or malformed members', async () => {
    const workspace = await createWorkspace('members_remove_guard', 'user_members_guard_owner');
    const post = (membershipId: string, key: string | null) => {
      const call = request(createApp()).post(`/api/v1/members/${membershipId}/remove`);
      return (key ? call.set('Idempotency-Key', key) : call).send({});
    };

    clerk.identity = { userId: workspace.frontdeskId, orgId: workspace.clerkOrgId };
    expect((await post(workspace.ownerMembershipId, 'remove-guard-fd-1')).status).toBe(403);
    expect((await post(workspace.frontdeskMembershipId, 'remove-guard-fd-2')).status).toBe(403);

    clerk.identity = { userId: workspace.ownerId, orgId: workspace.clerkOrgId };
    expect((await post(workspace.ownerMembershipId, 'remove-guard-owner')).status).toBe(409);
    expect((await post('6f1c2b8e-0d3a-4c55-9a51-2f3e4d5c6b7a', 'remove-guard-unknown')).status).toBe(404);
    expect((await post('not-a-uuid', 'remove-guard-bad')).status).toBe(422);
    expect((await post(workspace.frontdeskMembershipId, null)).status).toBe(422);

    const statuses = await withTenantTransaction(workspace.tenantId, workspace.ownerId, async (client) =>
      (
        await client.query<{ status: string }>(
          'SELECT status FROM membership WHERE tenant_id = $1 ORDER BY role',
          [workspace.tenantId],
        )
      ).rows,
    );
    expect(statuses).toEqual([{ status: 'active' }, { status: 'active' }]);
  });

  it('removes the member from the Clerk organization once and skips stale or finished requests', async () => {
    const workspace = await createWorkspace('members_remove_worker', 'user_members_worker_owner');
    clerk.identity = { userId: workspace.ownerId, orgId: workspace.clerkOrgId };
    await request(createApp())
      .post(`/api/v1/members/${workspace.frontdeskMembershipId}/remove`)
      .set('Idempotency-Key', 'remove-worker-1')
      .send({});
    const row = await withTenantTransaction(workspace.tenantId, workspace.ownerId, async (client) => {
      const result = await client.query<{ id: string; dedupe_key: string; payload: Record<string, unknown> }>(
        'SELECT id, dedupe_key, payload FROM outbox_event WHERE tenant_id = $1 AND event_type = $2',
        [workspace.tenantId, MEMBER_REMOVAL_EVENT_TYPE],
      );
      const event = result.rows[0];
      if (!event) throw new Error('Member removal event was not queued.');
      return {
        ...event,
        tenant_id: workspace.tenantId,
        event_type: MEMBER_REMOVAL_EVENT_TYPE,
        attempts: 0,
        max_attempts: 5,
      };
    });

    const getOrganizationMembership = vi.fn().mockResolvedValue({ id: 'orgmem_1' });
    const deleteMembership = vi.fn().mockResolvedValue({ id: 'orgmem_1' });
    const handler = createMemberRemovalDispatchHandler({
      clerk: { getOrganizationMembership, deleteMembership } as never,
      runTenantTransaction: withSystemTenantTransaction,
    });
    await handler(row);
    expect(deleteMembership).toHaveBeenCalledWith({
      organizationId: workspace.clerkOrgId,
      userId: workspace.frontdeskId,
    });

    // Retried after Clerk already removed them: nothing left to delete.
    getOrganizationMembership.mockResolvedValueOnce(null);
    await handler(row);
    expect(deleteMembership).toHaveBeenCalledTimes(1);

    // Re-invited before the event ran: the stale removal must not touch the provider.
    await withTenantTransaction(workspace.tenantId, workspace.ownerId, (client) =>
      client.query("UPDATE membership SET status = 'active' WHERE id = $1", [workspace.frontdeskMembershipId]),
    );
    await handler(row);
    expect(getOrganizationMembership).toHaveBeenCalledTimes(2);
    expect(deleteMembership).toHaveBeenCalledTimes(1);
  });

  async function createWorkspace(label: string, ownerId: string): Promise<TestWorkspace> {
    const tenant = await createTestTenant({ clerkOrgId: `org_${label}` });
    const ownerMembershipId = await createTestMembership(tenant.id, ownerId, 'owner');
    const frontdeskId = `user_${label}_frontdesk`;
    const frontdeskMembershipId = await createTestMembership(tenant.id, frontdeskId, 'frontdesk');

    await withTenantTransaction(tenant.id, ownerId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'main', true, 'Asia/Manila', 'active')
         RETURNING id`,
        [tenant.id],
      );
      const branchId = branch.rows[0]?.id;
      if (!branchId) throw new Error('Test branch insert returned no row.');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, '[]'::jsonb), ($1, $2, $4, '[]'::jsonb)`,
        [tenant.id, branchId, ownerMembershipId, frontdeskMembershipId],
      );
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true`,
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('Standard plan fixture is unavailable.');
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );
    });

    return {
      tenantId: tenant.id,
      clerkOrgId: tenant.clerkOrgId,
      ownerId,
      ownerMembershipId,
      frontdeskId,
      frontdeskMembershipId,
    };
  }

  // Created two weeks back so an already-expired invitation still satisfies
  // membership_invitation_expiry_after_creation (expires_at > created_at).
  async function seedInvitation(
    workspace: TestWorkspace,
    email: string,
    status: 'pending',
    expiresInDays: number,
  ): Promise<void> {
    await withTenantTransaction(workspace.tenantId, workspace.ownerId, async (client) => {
      const digest = digestRecipientEmail(email);
      await client.query(
        `INSERT INTO membership_invitation
           (tenant_id, recipient_email_digest, recipient_email_ciphertext, business_key, status, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() - interval '14 days', now() + make_interval(days => $6::int))`,
        [
          workspace.tenantId,
          digest,
          encryptRecipientEmail(email),
          `membership-invitation:${workspace.tenantId}:${digest}`,
          status,
          expiresInDays,
        ],
      );
    });
  }
});
