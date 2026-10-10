import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  buildWorkerRoleDatabaseUrl,
  ensureAppRoleLogin,
  ensureWorkerRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const clerk = vi.hoisted(() => ({
  findInvitationByDispatchMarker: vi.fn(),
  findInvitation: vi.fn(),
  getOrganizationMembership: vi.fn(),
}));

vi.mock('../../src/integrations/clerk/clerk.adapter.js', () => ({
  createClerkServerAdapter: () => clerk,
}));

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildWorkerRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX ??= '10';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

interface SeededWebhook {
  tenantId: string;
  invitationId: string;
  clerkOrgId: string;
  clerkInvitationId: string;
  clerkUserId: string;
  providerEventId: string;
}

async function seedWebhook(status: 'pending' | 'accepted' | 'revoked' = 'pending'): Promise<SeededWebhook> {
  const suffix = randomUUID();
  const clerkOrgId = `org_webhook_${suffix}`;
  const clerkInvitationId = `orginv_${suffix}`;
  const clerkUserId = `user_webhook_${suffix}`;
  const providerEventId = `evt_webhook_${suffix}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const tenant = await admin.query<{ id: string }>(
      `INSERT INTO tenant (clerk_org_id, name, slug)
       VALUES ($1, 'Webhook test shop', $2) RETURNING id`,
      [clerkOrgId, `webhook-${suffix}`],
    );
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw new Error('Tenant fixture was not created.');
    await admin.query(
      `INSERT INTO branch (tenant_id, name, code, is_default, timezone, address, operating_hours)
       VALUES ($1, 'Main', 'main', true, 'Asia/Manila', '{}'::jsonb,
         '{"opens_local":"08:00","closes_local":"20:00","closed_weekdays":[]}'::jsonb)`,
      [tenantId],
    );
    await admin.query(
      `INSERT INTO subscription (tenant_id, plan_id, status, trial_ends_at,
         current_period_start, current_period_end)
       SELECT $1, id, 'trialing', now() + interval '14 days', now(), now() + interval '14 days'
         FROM plan WHERE code = 'standard' AND version = 1`,
      [tenantId],
    );
    const invitation = await admin.query<{ id: string }>(
      `INSERT INTO membership_invitation
         (tenant_id, recipient_email_digest, recipient_email_ciphertext, status,
          expires_at, clerk_invitation_id, business_key)
       VALUES ($1, $2, 'synthetic-ciphertext', $3, now() + interval '7 days', $4, $5)
       RETURNING id`,
      [tenantId, suffix, status, clerkInvitationId, `webhook:${suffix}`],
    );
    const invitationId = invitation.rows[0]?.id;
    if (!invitationId) throw new Error('Invitation fixture was not created.');
    if (status === 'accepted') {
      await admin.query(
        `INSERT INTO membership (tenant_id, clerk_user_id, role, status)
         VALUES ($1, $2, 'frontdesk', 'active')`,
        [tenantId, clerkUserId],
      );
    }
    await admin.query(
      `INSERT INTO webhook_inbox
         (provider, provider_event_id, event_type, payload_digest, safe_payload)
       VALUES ('clerk', $1, 'organization_invitation.accepted', $2, $3::jsonb)`,
      [providerEventId, 'a'.repeat(64), JSON.stringify({
        organization_id: clerkOrgId,
        invitation_id: clerkInvitationId,
        user_id: clerkUserId,
      })],
    );
    return { tenantId, invitationId, clerkOrgId, clerkInvitationId, clerkUserId, providerEventId };
  } finally {
    await admin.end();
  }
}

function configureClerk(seed: SeededWebhook): void {
  const invitation = {
    id: seed.clerkInvitationId,
    organizationId: seed.clerkOrgId,
    emailAddress: 'redacted@example.test',
    role: 'org:member',
    status: 'accepted',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
  clerk.findInvitationByDispatchMarker.mockImplementation(
    (_clerkOrgId: string, marker: { operation: string }) =>
      Promise.resolve(marker.operation === 'create' ? invitation : null),
  );
  clerk.findInvitation.mockResolvedValue(invitation);
  clerk.getOrganizationMembership.mockResolvedValue({
    id: `orgmem_${randomUUID()}`,
    organizationId: seed.clerkOrgId,
    userId: seed.clerkUserId,
    role: 'org:member',
  });
}

async function readState(seed: SeededWebhook): Promise<{
  inboxStatus: string;
  invitationStatus: string;
  membershipCount: number;
  claimAuditCount: number;
  grantCount: number;
}> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const result = await admin.query<{
      inbox_status: string;
      invitation_status: string;
      membership_count: number;
      claim_audit_count: number;
      grant_count: number;
    }>(
      `SELECT
         (SELECT status FROM webhook_inbox WHERE provider_event_id = $2) AS inbox_status,
         (SELECT status FROM membership_invitation WHERE id = $3) AS invitation_status,
         (SELECT count(*)::int FROM membership
           WHERE tenant_id = $1 AND clerk_user_id = $4) AS membership_count,
         (SELECT count(*)::int FROM audit_event
           WHERE tenant_id = $1 AND action = 'membership_invitation.claimed') AS claim_audit_count,
         (SELECT count(*)::int FROM branch_membership WHERE tenant_id = $1) AS grant_count`,
      [seed.tenantId, seed.providerEventId, seed.invitationId, seed.clerkUserId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('State query returned no row.');
    return {
      inboxStatus: row.inbox_status,
      invitationStatus: row.invitation_status,
      membershipCount: row.membership_count,
      claimAuditCount: row.claim_audit_count,
      grantCount: row.grant_count,
    };
  } finally {
    await admin.end();
  }
}

describe('Clerk accepted-invitation webhook resolution', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { findWebhookClaimInvitation } = await import(
    '../../src/modules/membership-invitations/membership-invitation-claim.repository.js'
  );
  const { reconcileNextClerkWebhook } = await import('../../src/worker/handlers/clerk-webhook-reconciler.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await ensureWorkerRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
    vi.resetAllMocks();
  });

  afterAll(async () => {
    await closePool();
  });

  it('resolves only an exact provider invitation and organization under the worker principal', async () => {
    const seed = await seedWebhook();
    const worker = new Client({ connectionString: buildWorkerRoleDatabaseUrl(adminUrl) });
    const app = new Client({ connectionString: buildAppRoleDatabaseUrl(adminUrl) });
    await worker.connect();
    await app.connect();
    try {
      await worker.query('BEGIN');
      await worker.query("SELECT set_config('app.actor_kind', 'system', true)");
      await worker.query("SELECT set_config('app.principal_id', 'clerk:webhook-reconcile', true)");
      await worker.query("SELECT set_config('app.tenant_id', '', true)");
      await expect(findWebhookClaimInvitation(
        worker as unknown as PoolClient, seed.clerkOrgId, seed.clerkInvitationId,
      )).resolves.toEqual({
        tenant: { id: seed.tenantId, clerk_org_id: seed.clerkOrgId, status: 'active' },
        invitationId: seed.invitationId,
      });
      await expect(findWebhookClaimInvitation(
        worker as unknown as PoolClient, 'org_other', seed.clerkInvitationId,
      )).resolves.toBeNull();
      await expect(findWebhookClaimInvitation(
        worker as unknown as PoolClient, seed.clerkOrgId, 'orginv_unknown',
      )).resolves.toBeNull();
      await worker.query("SELECT set_config('app.principal_id', 'clerk:other', true)");
      await expect(findWebhookClaimInvitation(
        worker as unknown as PoolClient, seed.clerkOrgId, seed.clerkInvitationId,
      )).resolves.toBeNull();
      await worker.query("SELECT set_config('app.principal_id', 'clerk:webhook-reconcile', true)");
      await worker.query("SELECT set_config('app.tenant_id', $1, true)", [seed.tenantId]);
      await expect(findWebhookClaimInvitation(
        worker as unknown as PoolClient, seed.clerkOrgId, seed.clerkInvitationId,
      )).resolves.toBeNull();
      await worker.query('COMMIT');

      await expect(app.query(
        'SELECT * FROM public.resolve_membership_invitation_webhook($1, $2)',
        [seed.clerkOrgId, seed.clerkInvitationId],
      )).rejects.toMatchObject({ code: '42501' });

      const admin = new Client({ connectionString: adminUrl });
      await admin.connect();
      try {
        const grants = await admin.query<{ role_name: string; can_execute: boolean }>(
          `SELECT rolname AS role_name,
                  has_function_privilege(rolname,
                    'public.resolve_membership_invitation_webhook(text,text)', 'EXECUTE') AS can_execute
             FROM pg_roles
            WHERE rolname IN ('drezivo_worker', 'drezivo_app', 'anon', 'authenticated', 'service_role')`,
        );
        expect(Object.fromEntries(grants.rows.map((row) => [row.role_name, row.can_execute]))).toMatchObject({
          drezivo_worker: true,
          drezivo_app: false,
        });
        for (const row of grants.rows) {
          if (row.role_name !== 'drezivo_worker') expect(row.can_execute).toBe(false);
        }
        const publicGrant = await admin.query<{ granted: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM pg_proc p,
                    LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
              WHERE p.oid = 'public.resolve_membership_invitation_webhook(text,text)'::regprocedure
                AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
           ) AS granted`,
        );
        expect(publicGrant.rows[0]?.granted).toBe(false);
      } finally {
        await admin.end();
      }
    } finally {
      await worker.end();
      await app.end();
    }
  });

  it('claims a provider-ID webhook once across duplicate delivery', async () => {
    const seed = await seedWebhook();
    configureClerk(seed);
    expect(await reconcileNextClerkWebhook()).toBe(true);
    expect(await readState(seed)).toMatchObject({
      inboxStatus: 'processed', invitationStatus: 'accepted',
      membershipCount: 1, claimAuditCount: 1, grantCount: 1,
    });

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `INSERT INTO webhook_inbox
           (provider, provider_event_id, event_type, payload_digest, safe_payload)
         SELECT provider, $2, event_type, payload_digest, safe_payload
           FROM webhook_inbox WHERE provider_event_id = $1`,
        [seed.providerEventId, `${seed.providerEventId}_replay`],
      );
      expect(await reconcileNextClerkWebhook()).toBe(true);
      expect(await reconcileNextClerkWebhook()).toBe(false);
      const replay = await admin.query<{ status: string }>(
        'SELECT status FROM webhook_inbox WHERE provider_event_id = $1',
        [`${seed.providerEventId}_replay`],
      );
      expect(replay.rows[0]?.status).toBe('processed');
    } finally {
      await admin.end();
    }
    expect(await readState(seed)).toMatchObject({
      membershipCount: 1, claimAuditCount: 1, grantCount: 1,
    });
  });

  it('drains an already accepted invitation without a second membership or audit event', async () => {
    const seed = await seedWebhook('accepted');
    configureClerk(seed);
    expect(await reconcileNextClerkWebhook()).toBe(true);
    expect(await readState(seed)).toMatchObject({
      inboxStatus: 'processed', invitationStatus: 'accepted',
      membershipCount: 1, claimAuditCount: 0, grantCount: 1,
    });
  });

  it('processes unmatched provider and cross-organization events without local access', async () => {
    const foreignOrg = await seedWebhook();
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `UPDATE webhook_inbox
            SET safe_payload = jsonb_set(safe_payload, '{organization_id}', '"org_other"'::jsonb)
          WHERE provider_event_id = $1`,
        [foreignOrg.providerEventId],
      );
      expect(await reconcileNextClerkWebhook()).toBe(true);
      expect(await readState(foreignOrg)).toMatchObject({
        inboxStatus: 'processed', invitationStatus: 'pending', membershipCount: 0,
      });

      const unknownProvider = await seedWebhook();
      await admin.query(
        `UPDATE webhook_inbox
            SET safe_payload = jsonb_set(safe_payload, '{invitation_id}', '"orginv_unknown"'::jsonb)
          WHERE provider_event_id = $1`,
        [unknownProvider.providerEventId],
      );
      expect(await reconcileNextClerkWebhook()).toBe(true);
      expect(await readState(unknownProvider)).toMatchObject({
        inboxStatus: 'processed', invitationStatus: 'pending', membershipCount: 0,
      });
      expect(clerk.findInvitationByDispatchMarker).not.toHaveBeenCalled();
    } finally {
      await admin.end();
    }
  });

  it('ignores revoked and stale-dispatch invitations without granting access', async () => {
    const revoked = await seedWebhook('revoked');
    configureClerk(revoked);
    expect(await reconcileNextClerkWebhook()).toBe(true);
    expect(await readState(revoked)).toMatchObject({
      inboxStatus: 'processed', invitationStatus: 'revoked', membershipCount: 0,
    });

    const stale = await seedWebhook();
    configureClerk(stale);
    clerk.findInvitationByDispatchMarker.mockResolvedValue(null);
    expect(await reconcileNextClerkWebhook()).toBe(true);
    expect(await readState(stale)).toMatchObject({
      inboxStatus: 'processed', invitationStatus: 'pending', membershipCount: 0,
    });
  });

  it('keeps the inbox row received until Clerk membership is visible', async () => {
    const seed = await seedWebhook();
    configureClerk(seed);
    clerk.getOrganizationMembership.mockResolvedValueOnce(null);
    await expect(reconcileNextClerkWebhook()).rejects.toMatchObject({
      name: 'InvitationClaimDeferredError',
    });
    expect(await readState(seed)).toMatchObject({
      inboxStatus: 'received', invitationStatus: 'pending', membershipCount: 0,
    });
    expect(await reconcileNextClerkWebhook()).toBe(true);
    expect(await readState(seed)).toMatchObject({
      inboxStatus: 'processed', invitationStatus: 'accepted', membershipCount: 1,
    });
  });
});
