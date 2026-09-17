import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { PoolClient } from 'pg';

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

describe('TBF-022 webhook inbox and deferred repair', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { ensureAccount } = await import('../../src/modules/accounts/account.repository.js');
  const { reconcileDeferredClerkEvent, reconcileOrganizationCreatedMarker } = await import(
    '../../src/modules/webhooks/clerk.reconciliation.js'
  );
  const {
    claimReceivedClerkWebhookRows,
    insertClerkWebhookInbox,
    markClerkWebhookProcessed,
  } = await import('../../src/modules/webhooks/webhook-inbox.repository.js');
  const { getCurrentOwnerOnboarding, createOrResumeOnboarding } = await import(
    '../../src/modules/onboarding/onboarding.repository.js'
  );

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await ensureWorkerRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('lets the API insert and deduplicate without read/update/delete access, while worker owns status transitions', async () => {
    const app = new Client({ connectionString: buildAppRoleDatabaseUrl(adminUrl) });
    const worker = new Client({ connectionString: buildWorkerRoleDatabaseUrl(adminUrl) });
    await app.connect();
    await worker.connect();
    try {
      const input = {
        providerEventId: 'evt_privilege_1',
        eventType: 'organization.updated' as const,
        payloadDigest: 'a'.repeat(64),
        safePayload: { organization_id: 'org_privilege_1' },
      };
      expect(await insertClerkWebhookInbox(app as unknown as PoolClient, input)).toBe('inserted');
      expect(await insertClerkWebhookInbox(app as unknown as PoolClient, input)).toBe('duplicate');
      await expect(app.query('SELECT id FROM webhook_inbox')).rejects.toMatchObject({ code: '42501' });
      await expect(app.query('UPDATE webhook_inbox SET status = $1', ['processed'])).rejects.toMatchObject({
        code: '42501',
      });
      await expect(app.query('DELETE FROM webhook_inbox')).rejects.toMatchObject({ code: '42501' });

      await worker.query('BEGIN');
      const claimed = await claimReceivedClerkWebhookRows(worker as unknown as PoolClient, 10);
      expect(claimed).toHaveLength(1);
      const first = claimed[0];
      if (!first) throw new Error('expected one claimed webhook row');
      expect(await markClerkWebhookProcessed(worker as unknown as PoolClient, first.id, 'processed')).toBe(true);
      await worker.query('COMMIT');
      const status = await worker.query<{ status: string }>(
        'SELECT status FROM webhook_inbox WHERE provider_event_id = $1',
        [input.providerEventId],
      );
      expect(status.rows[0]?.status).toBe('processed');
      await expect(worker.query('DELETE FROM webhook_inbox')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
      await worker.end();
    }
  });

  it('repairs only a matching incomplete onboarding and creates no tenant-side effect', async () => {
    const account = await ensureAccount('user_webhook_repair');
    const marker = {
      source: 'owner_onboarding_v1' as const,
      account_id: account.id,
      attempt_id: '22222222-2222-4222-8222-222222222222',
    };
    const repaired = await reconcileDeferredClerkEvent({
      eventType: 'organization.created',
      safePayload: { organization_id: 'org_webhook_repair', drezivo_onboarding: marker },
    });
    expect(repaired.kind).toBe('repaired');
    expect(await getCurrentOwnerOnboarding('user_webhook_repair')).toMatchObject({ status: 'incomplete' });

    const replay = await reconcileOrganizationCreatedMarker({
      organizationId: 'org_webhook_repair',
      marker,
    });
    expect(replay.kind).toBe('already_present');

    const app = new Client({ connectionString: buildAppRoleDatabaseUrl(adminUrl) });
    await app.connect();
    try {
      const effects = await app.query<{ tenants: number; branches: number; memberships: number; subscriptions: number; trial_consumed: number }>(
        `SELECT
           (SELECT count(*)::int FROM tenant) AS tenants,
           (SELECT count(*)::int FROM branch) AS branches,
           (SELECT count(*)::int FROM membership) AS memberships,
           (SELECT count(*)::int FROM subscription) AS subscriptions,
           (SELECT count(*)::int FROM account WHERE trial_consumed_at IS NOT NULL) AS trial_consumed`,
      );
      expect(effects.rows[0]).toEqual({
        tenants: 0,
        branches: 0,
        memberships: 0,
        subscriptions: 0,
        trial_consumed: 0,
      });
    } finally {
      await app.end();
    }
  });

  it('skips malformed/unmatched markers and competing active onboarding', async () => {
    await expect(
      reconcileDeferredClerkEvent({
        eventType: 'organization.created',
        safePayload: { organization_id: 'org_bad', drezivo_onboarding: { source: 'wrong' } },
      }),
    ).resolves.toEqual({ kind: 'skipped' });
    await expect(
      reconcileDeferredClerkEvent({
        eventType: 'organization.created',
        safePayload: {
          organization_id: 'org_unknown',
          drezivo_onboarding: {
            source: 'owner_onboarding_v1',
            account_id: '11111111-1111-4111-8111-111111111111',
            attempt_id: '22222222-2222-4222-8222-222222222222',
          },
        },
      }),
    ).resolves.toEqual({ kind: 'skipped' });

    const account = await ensureAccount('user_webhook_competing');
    const active = await createOrResumeOnboarding(account.id, 'org_webhook_existing', 'user_webhook_competing');
    expect(active.kind).toBe('created');
    await expect(
      reconcileOrganizationCreatedMarker({
        organizationId: 'org_webhook_competing',
        marker: {
          source: 'owner_onboarding_v1',
          account_id: account.id,
          attempt_id: '33333333-3333-4333-8333-333333333333',
        },
      }),
    ).resolves.toEqual({ kind: 'skipped' });
  });
});
