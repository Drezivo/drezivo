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
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
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
        `SELECT id FROM plan WHERE code = 'starter' AND version = 1 AND active = true`,
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
