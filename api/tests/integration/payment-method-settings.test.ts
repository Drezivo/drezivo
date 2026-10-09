import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { fileObjectId, type FileObjectId } from '@drezivo/contracts';

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
process.env.FILE_OBJECT_CLEANUP_ENABLED = 'true';
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
  const { updatePaymentMethodSettings, getPaymentMethodSettings } =
    await import('../../src/modules/payment-methods/payment-methods.service.js');
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
      error: { message: 'GCash numbers are 11 digits and start with 09.' },
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
    const qrFileId = await withTenantTransaction(
      context.tenantId,
      context.principalId,
      async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'storefront_asset', $2, 'version-gcash-qr', 'image/png', 512, 'accepted', true,
                 now() + interval '10 minutes', now())
         RETURNING id`,
          [context.tenantId, `tenant-files/${context.tenantId}/gcash-qr/source`],
        );
        const row = result.rows[0];
        if (!row) throw new Error('expected QR file');
        return fileObjectId.parse(row.id);
      },
    );

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

  it('queues displaced QR and instructions files when replacing both payment-method assets', async () => {
    const context = await seed();
    const previousQr = await createPaymentFile(
      context,
      'storefront_asset',
      'image/png',
      'previous-qr',
    );
    const nextQr = await createPaymentFile(context, 'storefront_asset', 'image/png', 'next-qr');
    const previousMaterial = await createPaymentFile(
      context,
      'payment_method_material',
      'application/pdf',
      'previous-material',
    );
    const nextMaterial = await createPaymentFile(
      context,
      'payment_method_material',
      'application/pdf',
      'next-material',
    );

    await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      await client.query(
        `UPDATE payment_method
            SET qr_file_id = $3, presentation = 'material', material_file_id = $4, version = 1
          WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, context.paymentMethodId, previousQr, previousMaterial],
      );
    });

    const result = await updatePaymentMethodSettings({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-payment-settings-replace-assets',
      idempotencyKey: 'payment-settings-replace-assets',
      paymentMethodId: context.paymentMethodId,
      request: {
        ...request(),
        qr_file_id: nextQr,
        presentation: 'material',
        material_file_id: nextMaterial,
      },
    });

    expect(result.status).toBe(200);
    const state = await withTenantTransaction(
      context.tenantId,
      context.principalId,
      async (client) => {
        const method = await client.query<{
          qr_file_id: string;
          material_file_id: string;
          version: number;
        }>(
          `SELECT qr_file_id, material_file_id, version
           FROM payment_method WHERE tenant_id = $1 AND id = $2`,
          [context.tenantId, context.paymentMethodId],
        );
        const cleanup = await client.query<{ payload: { file_id: string } }>(
          `SELECT payload FROM outbox_event
          WHERE tenant_id = $1 AND event_type = 'file.object_cleanup.requested'
          ORDER BY dedupe_key`,
          [context.tenantId],
        );
        return {
          method: method.rows[0],
          cleanupCandidates: cleanup.rows.map((row) => row.payload.file_id),
        };
      },
    );

    expect(state.method).toEqual({
      qr_file_id: nextQr,
      material_file_id: nextMaterial,
      version: 2,
    });
    expect(state.cleanupCandidates).toEqual([previousMaterial, previousQr].sort());

    const switchedToDetails = await updatePaymentMethodSettings({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-payment-settings-clear-material',
      idempotencyKey: 'payment-settings-clear-material',
      paymentMethodId: context.paymentMethodId,
      request: {
        ...request(2),
        qr_file_id: nextQr,
        presentation: 'details',
        material_file_id: null,
      },
    });
    expect(switchedToDetails.status).toBe(200);
    const clearedState = await withTenantTransaction(
      context.tenantId,
      context.principalId,
      async (client) => {
        const method = await client.query<{ material_file_id: string | null; version: number }>(
          `SELECT material_file_id, version
           FROM payment_method WHERE tenant_id = $1 AND id = $2`,
          [context.tenantId, context.paymentMethodId],
        );
        const cleanup = await client.query<{ payload: { file_id: string } }>(
          `SELECT payload FROM outbox_event
          WHERE tenant_id = $1 AND event_type = 'file.object_cleanup.requested'
          ORDER BY dedupe_key`,
          [context.tenantId],
        );
        return {
          method: method.rows[0],
          cleanupCandidates: cleanup.rows.map((row) => row.payload.file_id),
        };
      },
    );
    expect(clearedState.method).toEqual({ material_file_id: null, version: 3 });
    expect(clearedState.cleanupCandidates).toEqual([previousMaterial, previousQr].sort());
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

    const state = await withTenantTransaction(
      context.tenantId,
      context.principalId,
      async (client) => {
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
      },
    );
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
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof updatePaymentMethodSettings>>
        > => result.status === 'fulfilled',
      )
      .map((result) => result.value);
    expect(successfulResponses.some((result) => result.status === 200)).toBe(true);

    const state = await withTenantTransaction(
      context.tenantId,
      context.principalId,
      async (client) => {
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
      },
    );
    expect(state).toEqual({ version: 2, auditCount: 1 });
  });

  async function createPaymentFile(
    context: Awaited<ReturnType<typeof seed>>,
    purpose: 'storefront_asset' | 'payment_method_material',
    mimeType: 'image/png' | 'application/pdf',
    label: string,
  ): Promise<FileObjectId> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, $2, $3, $4, $5, 512, 'accepted', true, now(), now())
         RETURNING id`,
        [
          context.tenantId,
          purpose,
          `tenant-files/${context.tenantId}/${label}/source`,
          `v-${label}`,
          mimeType,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('expected accepted payment file');
      return fileObjectId.parse(id);
    });
  }
});
