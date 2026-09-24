import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { fileObjectId } from '@drezivo/contracts';

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

describe('payment method settings', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { updatePaymentMethodSettings, getPaymentMethodSettings } = await import(
    '../../src/modules/payment-methods/payment-methods.service.js'
  );
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

  async function seed() {
    const principalId = 'user_payment_settings';
    const tenant = await createTestTenant({ clerkOrgId: 'org_payment_settings' });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    const paymentMethodId = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, active, storefront_enabled, version)
         VALUES ($1, 'GCash', 'manual_qr', '{}'::jsonb, true, false, 1)
         RETURNING id`,
        [tenant.id],
      );
      const row = result.rows[0];
      if (!row) throw new Error('expected payment method');
      return row.id;
    });
    return {
      tenantId: tenant.id,
      principalId,
      membershipId,
      paymentMethodId,
      permissionCodes: ['payments.manage'] as const,
      effectiveTenantStatus: 'active' as const,
    };
  }

  function request(version = 1) {
    return {
      version,
      active: true,
      storefront_enabled: true,
      destination: {
        account_name: 'Luna Rentals',
        account_number: '09171234567',
        instructions: 'Send the reservation deposit.',
      },
      qr_file_id: null,
    } as const;
  }

  it('rejects a GCash number that is not exactly 11 digits', async () => {
    const context = await seed();
    const result = await updatePaymentMethodSettings({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-payment-settings-invalid-gcash-number',
      idempotencyKey: 'payment-settings-invalid-gcash-number-001',
      paymentMethodId: context.paymentMethodId,
      request: {
        ...request(),
        destination: {
          ...request().destination,
          account_number: '094512345678',
        },
      },
    });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      success: false,
      error: { message: 'GCash number must be exactly 11 digits.' },
    });
  });

  it('keeps an enabled QR method hidden from storefront readiness until a QR is configured', async () => {
    const context = await seed();
    const result = await updatePaymentMethodSettings({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-payment-settings-ready',
      idempotencyKey: 'payment-settings-ready-001',
      paymentMethodId: context.paymentMethodId,
      request: request(),
    });
    expect(result.status).toBe(200);

    const settings = await getPaymentMethodSettings({
      ...context,
      permissionCodes: [...context.permissionCodes],
    });
    expect(settings.items[0]).toMatchObject({
      name: 'GCash',
      active: true,
      storefront_enabled: true,
      storefront_ready: false,
      version: 2,
    });
  });

  it('marks a storefront-enabled QR method ready only after an accepted workspace QR is attached', async () => {
    const context = await seed();
    const qrFileId = await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'storefront_asset', $2, 'image/png', 512, 'accepted', true,
                 now() + interval '10 minutes', now())
         RETURNING id`,
        [context.tenantId, `tenant-files/${context.tenantId}/gcash-qr/source`],
      );
      const row = result.rows[0];
      if (!row) throw new Error('expected QR file');
      return fileObjectId.parse(row.id);
    });

    const result = await updatePaymentMethodSettings({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-payment-settings-qr',
      idempotencyKey: 'payment-settings-qr-001',
      paymentMethodId: context.paymentMethodId,
      request: { ...request(), qr_file_id: qrFileId },
    });
    expect(result.status).toBe(200);
    if (!result.body.success) throw new Error('expected successful settings update');
    expect(result.body.data).toMatchObject({ storefront_enabled: true, storefront_ready: true });
  });

  it('replays sequential duplicate updates without a second business effect', async () => {
    const context = await seed();
    const input = {
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-payment-settings-sequential',
      idempotencyKey: 'payment-settings-sequential-001',
      paymentMethodId: context.paymentMethodId,
      request: request(),
    };

    const first = await updatePaymentMethodSettings(input);
    const second = await updatePaymentMethodSettings(input);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const state = await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const method = await client.query<{ version: number }>(
        'SELECT version FROM payment_method WHERE tenant_id = $1 AND id = $2',
        [context.tenantId, context.paymentMethodId],
      );
      const audits = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_event
         WHERE tenant_id = $1 AND entity_type = 'payment_method' AND entity_id = $2`,
        [context.tenantId, context.paymentMethodId],
      );
      return { version: method.rows[0]?.version, auditCount: audits.rows[0]?.count };
    });
    expect(state).toEqual({ version: 2, auditCount: 1 });
  });

  it('allows only one business effect for concurrent duplicate updates', async () => {
    const context = await seed();
    const input = {
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-payment-settings-concurrent',
      idempotencyKey: 'payment-settings-concurrent-001',
      paymentMethodId: context.paymentMethodId,
      request: request(),
    };

    const results = await Promise.allSettled([
      updatePaymentMethodSettings(input),
      updatePaymentMethodSettings(input),
    ]);
    const successfulResponses = results
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof updatePaymentMethodSettings>>> => result.status === 'fulfilled')
      .map((result) => result.value);
    expect(successfulResponses.some((result) => result.status === 200)).toBe(true);

    const state = await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const method = await client.query<{ version: number }>(
        'SELECT version FROM payment_method WHERE tenant_id = $1 AND id = $2',
        [context.tenantId, context.paymentMethodId],
      );
      const audits = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_event
         WHERE tenant_id = $1 AND entity_type = 'payment_method' AND entity_id = $2`,
        [context.tenantId, context.paymentMethodId],
      );
      return { version: method.rows[0]?.version, auditCount: audits.rows[0]?.count };
    });
    expect(state).toEqual({ version: 2, auditCount: 1 });
  });
});
