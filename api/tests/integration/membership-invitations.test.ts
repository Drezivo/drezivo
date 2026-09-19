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

describe('TBF-040 membership invitations', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const {
    cancelMembershipInvitation,
    createMembershipInvitation,
    listMembershipInvitations,
    resendMembershipInvitation,
  } = await import('../../src/modules/membership-invitations/membership-invitations.service.js');
  const { createTestMembership, createTestTenant, testKey } = await import('./helpers/factories.js');

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

  it('creates one protected invitation and reuses it for a normalized recipient', async () => {
    const context = await createOwnerContext('user_tbf040_create');

    const first = await createMembershipInvitation({
      ...context,
      requestId: 'req-tbf040-create-1',
      idempotencyKey: 'create-1',
      request: { email: 'Recipient@Example.com' },
    });
    const second = await createMembershipInvitation({
      ...context,
      requestId: 'req-tbf040-create-2',
      idempotencyKey: 'create-2',
      request: { email: ' recipient@example.com ' },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data).toEqual(second.body.data);
    expect(JSON.stringify(first.body)).not.toContain('recipient@example.com');

    const rows = await withTenantTransaction(context.tenantId, context.principalId, (client) =>
      client.query<{ count: number; outbox_count: number }>(
        `SELECT
           (SELECT count(*)::int FROM membership_invitation WHERE tenant_id = $1) AS count,
           (SELECT count(*)::int FROM outbox_event WHERE tenant_id = $1) AS outbox_count`,
        [context.tenantId],
      ),
    );
    expect(rows.rows[0]).toEqual({ count: 1, outbox_count: 1 });
  });

  it('reserves the Starter seat, releases it on cancellation, and preserves the row on resend', async () => {
    const context = await createOwnerContext('user_tbf040_capacity');
    const first = await createMembershipInvitation({
      ...context,
      requestId: 'req-tbf040-capacity-1',
      idempotencyKey: 'capacity-1',
      request: { email: 'one@example.com' },
    });
    const firstId = String((first.body.data as { id: string }).id);

    const overCap = await createMembershipInvitation({
      ...context,
      requestId: 'req-tbf040-capacity-2',
      idempotencyKey: 'capacity-2',
      request: { email: 'two@example.com' },
    });
    expect(overCap.status).toBe(409);
    expect(overCap.body).toMatchObject({ success: false, error: { code: 'CAPACITY_CONFLICT' } });

    const cancelled = await cancelMembershipInvitation({
      ...context,
      requestId: 'req-tbf040-capacity-cancel',
      idempotencyKey: 'capacity-cancel',
      invitationId: firstId,
    });
    expect(cancelled.body.data).toMatchObject({ id: firstId, status: 'revoked' });

    const resent = await resendMembershipInvitation({
      ...context,
      requestId: 'req-tbf040-capacity-resend',
      idempotencyKey: 'capacity-resend',
      invitationId: firstId,
    });
    expect(resent.body.data).toMatchObject({ id: firstId, status: 'pending' });

    const rows = await withTenantTransaction(context.tenantId, context.principalId, (client) =>
      client.query<{ count: number; dispatch_version: number; outbox_count: number }>(
        `SELECT
           (SELECT count(*)::int FROM membership_invitation WHERE tenant_id = $1) AS count,
           (SELECT dispatch_version FROM membership_invitation WHERE id = $2) AS dispatch_version,
           (SELECT count(*)::int FROM outbox_event WHERE tenant_id = $1) AS outbox_count`,
        [context.tenantId, firstId],
      ),
    );
    expect(rows.rows[0]).toEqual({ count: 1, dispatch_version: 2, outbox_count: 3 });
  });

  it('replays the exact idempotent response and rejects a changed payload', async () => {
    const context = await createOwnerContext('user_tbf040_idempotency');
    const input = {
      ...context,
      requestId: 'req-tbf040-idempotency-1',
      idempotencyKey: testKey('idempotency-1'),
      request: { email: 'same@example.com' },
    };

    const first = await createMembershipInvitation(input);
    const replay = await createMembershipInvitation({
      ...input,
      requestId: 'req-tbf040-idempotency-2',
    });
    expect(replay).toEqual(first);

    await expect(
      createMembershipInvitation({
        ...input,
        request: { email: 'changed@example.com' },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('expires stale pending rows before enforcing the next reservation', async () => {
    const context = await createOwnerContext('user_tbf040_expiry');
    const first = await createMembershipInvitation({
      ...context,
      requestId: 'req-tbf040-expiry-1',
      idempotencyKey: 'expiry-1',
      request: { email: 'expired@example.com' },
    });
    const firstId = String((first.body.data as { id: string }).id);

    await withTenantTransaction(context.tenantId, context.principalId, (client) =>
      client.query(
        `UPDATE membership_invitation
            SET created_at = now() - interval '2 seconds',
                expires_at = now() - interval '1 second'
          WHERE id = $1`,
        [firstId],
      ),
    );

    const second = await createMembershipInvitation({
      ...context,
      requestId: 'req-tbf040-expiry-2',
      idempotencyKey: 'expiry-2',
      request: { email: 'replacement@example.com' },
    });
    expect(second.status).toBe(200);

    const statuses = await withTenantTransaction(context.tenantId, context.principalId, (client) =>
      client.query<{ status: string }>(
        `SELECT status FROM membership_invitation WHERE tenant_id = $1 ORDER BY created_at ASC`,
        [context.tenantId],
      ),
    );
    expect(statuses.rows.map((row) => row.status)).toEqual(['expired', 'pending']);
  });

  it('returns only safe fields from the owner list and denies Front Desk callers', async () => {
    const context = await createOwnerContext('user_tbf040_list_owner');
    await createMembershipInvitation({
      ...context,
      requestId: 'req-tbf040-list-create',
      idempotencyKey: 'list-create',
      request: { email: 'hidden@example.com' },
    });

    const list = await listMembershipInvitations({ ...context, limit: 20 });
    expect(list.items[0]).toHaveProperty('id');
    expect(list.items[0]).not.toHaveProperty('recipient_email');
    expect(list.items[0]).not.toHaveProperty('recipient_email_digest');

    const frontdesk = await createTestMembership(
      context.tenantId,
      'user_tbf040_frontdesk',
      'frontdesk',
    );
    await expect(
      createMembershipInvitation({
        ...context,
        membershipId: frontdesk,
        principalId: 'user_tbf040_frontdesk',
        requestId: 'req-tbf040-list-frontdesk',
        idempotencyKey: 'frontdesk-create',
        request: { email: 'other@example.com' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  async function createOwnerContext(principalId: string) {
    const tenant = await createTestTenant({ clerkOrgId: `org_${principalId}` });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    await withTenantTransaction(tenant.id, principalId, async (client) => {
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'starter' AND version = 1 AND active = true`,
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('Starter plan seed is missing.');
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'trialing', now(), now() + interval '7 days')`,
        [tenant.id, planId],
      );
    });
    return { tenantId: tenant.id, membershipId, principalId };
  }
});
