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
  const { config } = await import('../../src/config/index.js');
  const { updatePaymentMethodSettings, getPaymentMethodSettings, updatePaymentRenterSteps } =
    await import('../../src/modules/payment-methods/payment-methods.service.js');
  const { createTestMembership, createTestSubscription, createTestTenant } = await import('./helpers/factories.js');

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
    // Storefront payment methods are a paid-plan feature.
    await createTestSubscription(tenant.id);
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    const branchId = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main', 'MAIN', true, 'Asia/Manila', 'active') RETURNING id`,
        [tenant.id],
      );
      const id = branch.rows[0]?.id;
      if (!id) throw new Error('expected branch');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, id, membershipId, JSON.stringify(['payments.manage'])],
      );
      return id;
    });
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
      branchId,
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

  it('shows the owner an application media route for the saved QR, and none for an unfinished upload', async () => {
    const context = await seed();
    const insertQr = (status: 'accepted' | 'pending_upload', label: string) =>
      withTenantTransaction(context.tenantId, context.principalId, async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO file_object
             (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
              is_private, upload_expires_at, frozen_at)
           VALUES ($1, 'storefront_asset', $2, $3, 'image/png', 512, $4, true,
                   now() + interval '10 minutes', CASE WHEN $4 = 'accepted' THEN now() END)
           RETURNING id`,
          [context.tenantId, `tenant-files/${context.tenantId}/${label}/source`, `version-${label}`, status],
        );
        const row = result.rows[0];
        if (!row) throw new Error('expected QR file');
        return fileObjectId.parse(row.id);
      });
    const list = () =>
      getPaymentMethodSettings({ ...context, permissionCodes: [...context.permissionCodes] });

    expect((await list()).items[0]).toMatchObject({ qr_file_id: null, qr_image_url: null, material_url: null });

    const qrFileId = await insertQr('accepted', 'preview-qr');
    const saved = await updatePaymentMethodSettings({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-payment-preview',
      idempotencyKey: 'payment-preview-001',
      paymentMethodId: context.paymentMethodId,
      request: { ...request(), qr_file_id: qrFileId },
    });
    if (!saved.body.success) throw new Error('expected successful settings update');
    // Stored command responses are replayed later, so they never carry a signed link.
    expect(saved.body.data).not.toHaveProperty('qr_image_url');

    const item = (await list()).items[0];
    expect(item?.qr_file_id).toBe(qrFileId);
    expect(item?.qr_image_url).toBe(
      `/api/media/staff/${qrFileId}?branch_id=${context.branchId}&w=960`,
    );

    // A file that never finished uploading is not signed, even if a row points at it.
    const unfinished = await insertQr('pending_upload', 'unfinished-qr');
    await withTenantTransaction(context.tenantId, context.principalId, (client) =>
      client.query('UPDATE payment_method SET qr_file_id = $3 WHERE tenant_id = $1 AND id = $2', [
        context.tenantId,
        context.paymentMethodId,
        unfinished,
      ]),
    );
    expect((await list()).items[0]).toMatchObject({ qr_file_id: unfinished, qr_image_url: null });
  });

  it('saves one shared renter guide idempotently and audits only one change', async () => {
    const context = await seed();
    const input = {
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-renter-steps-shared',
      idempotencyKey: 'renter-steps-shared-001',
      request: { version: 1, text: 'Send payment, then share the receipt.', image_file_id: null },
    };

    const first = await updatePaymentRenterSteps(input);
    const replay = await updatePaymentRenterSteps(input);
    expect(first.status).toBe(200);
    expect(replay).toEqual(first);
    if (!first.body.success) throw new Error('expected shared renter steps to save');
    expect(first.body.data).toMatchObject({ version: 2, text: 'Send payment, then share the receipt.', image: null });

    const settings = await getPaymentMethodSettings({ ...context, permissionCodes: [...context.permissionCodes] });
    expect(settings.renter_steps).toMatchObject({ version: 2, text: 'Send payment, then share the receipt.', legacy_conflicts: [] });
    const audit = await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const result = await client.query<{ count: number; version: number }>(
        `SELECT (SELECT count(*)::int FROM audit_event
                  WHERE tenant_id = $1 AND action = 'payment.renter_steps.updated') AS count,
                (SELECT renter_steps_version FROM tenant_settings WHERE tenant_id = $1) AS version`,
        [context.tenantId],
      );
      return result.rows[0];
    });
    expect(audit).toEqual({ count: 1, version: 2 });
  });

  it('accepts and signs only same-tenant, accepted image files for the shared guide', async () => {
    const context = await seed();
    const accepted = await createPaymentFile(context, 'payment_method_material', 'image/png', 'shared-steps');
    const saved = await updatePaymentRenterSteps({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-renter-steps-image',
      idempotencyKey: 'renter-steps-image-001',
      request: { version: 1, text: null, image_file_id: accepted },
    });
    expect(saved.status).toBe(200);

    const settings = await getPaymentMethodSettings({ ...context, permissionCodes: [...context.permissionCodes] });
    expect(settings.renter_steps.image).toMatchObject({
      file_id: accepted,
      content_type: 'image/png',
    });
    expect(settings.renter_steps.image?.image_url).toMatch(/^https?:\/\//);
  });

  it('rejects PDF, unfinished, and foreign-tenant files as the shared guide image', async () => {
    const context = await seed();
    const otherTenant = await createTestTenant({ clerkOrgId: 'org_payment_steps_foreign' });
    const invalidFiles = [
      await createPaymentFile(context, 'payment_method_material', 'application/pdf', 'steps-pdf'),
      await createPaymentFile(context, 'payment_method_material', 'image/png', 'steps-pending', 'uploaded'),
      await createPaymentFile({ ...context, tenantId: otherTenant.id }, 'payment_method_material', 'image/png', 'steps-foreign'),
    ];

    for (const [index, fileId] of invalidFiles.entries()) {
      const result = await updatePaymentRenterSteps({
        ...context,
        permissionCodes: [...context.permissionCodes],
        requestId: `req-renter-steps-invalid-${index}`,
        idempotencyKey: `renter-steps-invalid-${index}`,
        request: { version: 1, text: null, image_file_id: fileId },
      });
      expect(result.status).toBe(422);
    }

    const settings = await getPaymentMethodSettings({ ...context, permissionCodes: [...context.permissionCodes] });
    expect(settings.renter_steps).toMatchObject({ version: 1, text: null, image: null });
  });

  it('preserves conflicting legacy method guides and surfaces them until a shared guide is saved', async () => {
    const context = await seed();
    await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      await client.query(
        `UPDATE payment_method SET destination_snapshot = $3::jsonb WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, context.paymentMethodId, JSON.stringify({ instructions: 'GCash-specific steps.' })],
      );
      await client.query(
        `INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot, active, storefront_enabled, version)
         VALUES ($1, 'Maya', 'manual_transfer', $2::jsonb, true, true, 1)`,
        [context.tenantId, JSON.stringify({ instructions: 'Maya-specific steps.' })],
      );
    });

    const legacy = await getPaymentMethodSettings({ ...context, permissionCodes: [...context.permissionCodes] });
    expect(legacy.renter_steps.legacy_conflicts).toEqual([
      expect.objectContaining({ payment_method_name: 'GCash', text: 'GCash-specific steps.' }),
      expect.objectContaining({ payment_method_name: 'Maya', text: 'Maya-specific steps.' }),
    ]);

    const empty = await updatePaymentRenterSteps({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-renter-steps-consolidate-empty',
      idempotencyKey: 'renter-steps-consolidate-empty',
      request: { version: 1, text: null, image_file_id: null },
    });
    expect(empty.status).toBe(422);

    const saved = await updatePaymentRenterSteps({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-renter-steps-consolidate',
      idempotencyKey: 'renter-steps-consolidate-001',
      request: { version: 1, text: 'Shared payment steps.', image_file_id: null },
    });
    expect(saved.status).toBe(200);
    expect((await getPaymentMethodSettings({ ...context, permissionCodes: [...context.permissionCodes] })).renter_steps.legacy_conflicts).toEqual([]);
    const preserved = await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const result = await client.query<{ name: string; instructions: string }>(
        `SELECT name, destination_snapshot ->> 'instructions' AS instructions
           FROM payment_method WHERE tenant_id = $1 ORDER BY name`,
        [context.tenantId],
      );
      return result.rows;
    });
    expect(preserved).toEqual([
      { name: 'GCash', instructions: 'GCash-specific steps.' },
      { name: 'Maya', instructions: 'Maya-specific steps.' },
    ]);
  });

  it('prevents replacing a conflicting legacy step image before a shared guide is saved', async () => {
    const context = await seed();
    const legacyImage = await createPaymentFile(context, 'payment_method_material', 'image/png', 'legacy-renter-steps');
    const replacement = await createPaymentFile(context, 'payment_method_material', 'application/pdf', 'method-instructions');
    await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      await client.query(
        `UPDATE payment_method
            SET presentation = 'details', material_file_id = $3,
                destination_snapshot = '{"instructions":"Original renter steps."}'::jsonb
          WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, context.paymentMethodId, legacyImage],
      );
    });

    const result = await updatePaymentMethodSettings({
      ...context,
      permissionCodes: [...context.permissionCodes],
      requestId: 'req-payment-method-replace-legacy-steps',
      idempotencyKey: 'payment-method-replace-legacy-steps-001',
      paymentMethodId: context.paymentMethodId,
      request: {
        ...request(),
        presentation: 'material',
        material_file_id: replacement,
      },
    });
    expect(result.status).toBe(422);
    const conflicts = (await getPaymentMethodSettings({
      ...context,
      permissionCodes: [...context.permissionCodes],
    })).renter_steps.legacy_conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      payment_method_id: context.paymentMethodId,
      payment_method_name: 'GCash',
      text: 'Original renter steps.',
    });
    expect(conflicts[0]?.image?.file_id).toBe(legacyImage);
  });

  it('requires payment-management permission to update shared renter steps', async () => {
    const context = await seed();
    await expect(updatePaymentRenterSteps({
      ...context,
      permissionCodes: [],
      requestId: 'req-renter-steps-forbidden',
      idempotencyKey: 'renter-steps-forbidden-001',
      request: { version: 1, text: 'Shared steps.', image_file_id: null },
    })).rejects.toMatchObject({ status: 403 });
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

  it('keeps payment-method references unchanged while the cleanup producer gate is off', async () => {
    const context = await seed();
    const previousQr = await createPaymentFile(
      context,
      'storefront_asset',
      'image/png',
      'gate-previous-qr',
    );
    const replacementQr = await createPaymentFile(
      context,
      'storefront_asset',
      'image/png',
      'gate-replacement-qr',
    );
    await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      await client.query(
        `UPDATE payment_method SET qr_file_id = $3, version = 1 WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, context.paymentMethodId, previousQr],
      );
    });

    config.FILE_OBJECT_CLEANUP_ENABLED = false;
    try {
      await expect(
        updatePaymentMethodSettings({
          ...context,
          permissionCodes: [...context.permissionCodes],
          requestId: 'req-payment-settings-cleanup-gate',
          idempotencyKey: 'payment-settings-cleanup-gate',
          paymentMethodId: context.paymentMethodId,
          request: { ...request(), qr_file_id: replacementQr },
        }),
      ).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
    } finally {
      config.FILE_OBJECT_CLEANUP_ENABLED = true;
    }

    const state = await withTenantTransaction(
      context.tenantId,
      context.principalId,
      async (client) => {
        const method = await client.query<{ qr_file_id: string | null; version: number }>(
          `SELECT qr_file_id, version FROM payment_method WHERE tenant_id = $1 AND id = $2`,
          [context.tenantId, context.paymentMethodId],
        );
        const cleanup = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM outbox_event
          WHERE tenant_id = $1 AND event_type = 'file.object_cleanup.requested'`,
          [context.tenantId],
        );
        return { method: method.rows[0], cleanupCount: Number(cleanup.rows[0]?.count ?? 0) };
      },
    );
    expect(state).toEqual({ method: { qr_file_id: previousQr, version: 1 }, cleanupCount: 0 });
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
    status: 'accepted' | 'uploaded' = 'accepted',
  ): Promise<FileObjectId> {
    return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, $2, $3, $4, $5, 512, $6, true, now(), CASE WHEN $6 = 'accepted' THEN now() END)
         RETURNING id`,
        [
          context.tenantId,
          purpose,
          `tenant-files/${context.tenantId}/${label}/source`,
          `v-${label}`,
          mimeType,
          status,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('expected accepted payment file');
      return fileObjectId.parse(id);
    });
  }
});
