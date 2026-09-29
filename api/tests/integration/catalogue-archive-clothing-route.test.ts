import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const clerk = vi.hoisted(() => ({
  getAuth: vi.fn(),
}));

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: clerk.getAuth,
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
process.env.OBJECT_STORAGE_REGION ??= 'test';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE ??= 'private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC ??= 'public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ??= 'test';

describe('CLT-032 clothing archive command', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { computeAvailability, findPublishedStorefrontBySlug } = await import(
    '../../src/modules/storefront/storefront.repository.js'
  );
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  beforeEach(() => {
    clerk.getAuth.mockReset();
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('archives new intake while preserving reservation history, blocking allocations, and unsafe assets', async () => {
    const seed = await seedArchiveCatalogue('org_clt032_history', 'user_clt032_history');
    useClerk(seed);

    const beforeStorefront = await findPublishedStorefrontBySlug(seed.storefrontSlug);
    expect(beforeStorefront?.products.some((product) => product.id === seed.productId)).toBe(true);

    const previewInterval = futureInterval(20, 21);
    const beforeAvailability = await computeAvailability(
      seed.storefrontSlug,
      seed.primaryVariantId,
      previewInterval.start,
      previewInterval.end,
    );
    expect(beforeAvailability?.[0]?.available_units).toBeGreaterThan(0);

    const response = await request(createApp())
      .post(`/api/v1/catalogue/clothing/${seed.productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt032-history-archive')
      .send({ expected_updated_at: seed.productUpdatedAt });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        product_id: seed.productId,
        status: 'archived',
        archived_variant_count: 2,
        retired_asset_count: 1,
        pending_asset_resolution_count: 3,
      },
    });

    const afterStorefront = await findPublishedStorefrontBySlug(seed.storefrontSlug);
    expect(afterStorefront?.products.some((product) => product.id === seed.productId)).toBe(false);

    const activeStaffList = await request(createApp()).get(
      '/api/v1/catalogue/clothing?product_status=active&sort=name_asc&limit=20',
    );
    expect(activeStaffList.status).toBe(200);
    expect(readItems(activeStaffList.body).some((item) => readString(item.product_id) === seed.productId)).toBe(false);

    const archivedStaffList = await request(createApp()).get(
      '/api/v1/catalogue/clothing?product_status=archived&sort=name_asc&limit=20',
    );
    expect(archivedStaffList.status).toBe(200);
    expect(readItems(archivedStaffList.body).some((item) => readString(item.product_id) === seed.productId)).toBe(true);

    const afterAvailability = await computeAvailability(
      seed.storefrontSlug,
      seed.primaryVariantId,
      previewInterval.start,
      previewInterval.end,
    );
    expect(afterAvailability?.[0]?.available_units).toBe(0);

    const detail = await request(createApp()).get(`/api/v1/catalogue/clothing/${seed.productId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      success: true,
      data: {
        product_id: seed.productId,
        status: 'archived',
      },
    });
    const detailData = readData(detail.body);
    const variants = readArray(detailData.variants);
    expect(variants).toHaveLength(2);
    expect(variants.every((variant) => readString(variant.status) === 'archived')).toBe(true);

    const state = await readArchiveState(seed);
    expect(state.product.status).toBe('archived');
    expect(state.variantStatuses).toEqual(['archived', 'archived']);
    expect(state.assets).toEqual([
      {
        asset_code: 'ARC-BOOKED',
        lifecycle_status: 'active',
        readiness: 'ready',
        custody_kind: 'at_branch',
        version: 1,
      },
      {
        asset_code: 'ARC-CUSTODY',
        lifecycle_status: 'active',
        readiness: 'unready',
        custody_kind: 'with_customer',
        version: 1,
      },
      {
        asset_code: 'ARC-MAINT',
        lifecycle_status: 'active',
        readiness: 'needs_repair',
        custody_kind: 'at_branch',
        version: 1,
      },
      {
        asset_code: 'ARC-SAFE',
        lifecycle_status: 'retired',
        readiness: 'unready',
        custody_kind: 'at_branch',
        version: 2,
      },
    ]);
    expect(state.reservationSnapshot).toEqual(seed.reservationSnapshot);
    expect(state.reservationAllocation).toEqual({
      asset_id: seed.bookedAssetId,
      reservation_line_id: seed.reservationLineId,
      is_blocking: true,
      released_at: null,
      kind: 'reservation_confirmed',
    });
    expect(state.maintenanceAllocation).toEqual({
      asset_id: seed.maintenanceAssetId,
      is_blocking: true,
      released_at: null,
      kind: 'maintenance',
    });
    expect(state.auditActions).toEqual(['catalogue.clothing.archived']);
  });

  it('restores only pieces auto-retired by product archive and can publish the clothing again', async () => {
    const seed = await seedArchiveCatalogue('org_clt073_restore', 'user_clt073_restore');
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness,
            custody_kind, version, created_at, updated_at)
         VALUES ($1, $2, $3, 'ARC-MANUAL', 'retired', 'unready', 'at_branch', 2, now(), now())`,
        [seed.tenantId, seed.branchId, seed.primaryVariantId],
      );
      const image = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'catalogue_image', $2, 'version-archive-restore', 'image/png', 512,
                 'accepted', true, now() + interval '10 minutes', now())
         RETURNING id`,
        [seed.tenantId, `tenant-files/${seed.tenantId}/archive-restore-cover/source`],
      );
      const imageId = requireRow(image.rows, 'archive restore image').id;
      await client.query(
        `INSERT INTO product_image (tenant_id, product_id, file_id, display_order)
         VALUES ($1, $2, $3, 0)`,
        [seed.tenantId, seed.productId, imageId],
      );
    });
    useClerk(seed);
    const app = createApp();

    const archived = await request(app)
      .post(`/api/v1/catalogue/clothing/${seed.productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt073-archive-first')
      .send({ expected_updated_at: seed.productUpdatedAt });
    expect(archived.status).toBe(200);
    const archivedData = readData(archived.body);
    const archivedUpdatedAt = readString(archivedData.updated_at);

    const restored = await request(app)
      .post(`/api/v1/catalogue/clothing/${seed.productId}/restore`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt073-restore')
      .send({ expected_updated_at: archivedUpdatedAt });

    expect(restored.status).toBe(200);
    const replay = await request(app)
      .post(`/api/v1/catalogue/clothing/${seed.productId}/restore`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt073-restore')
      .send({ expected_updated_at: archivedUpdatedAt });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(restored.body);
    expect(restored.body).toMatchObject({
      success: true,
      data: {
        product_id: seed.productId,
        status: 'draft',
        restored_variant_count: 2,
      },
    });

    const state = await readArchiveState(seed);
    expect(state.product.status).toBe('draft');
    expect(state.variantStatuses).toEqual(['draft', 'draft']);
    expect(state.assets).toEqual([
      {
        asset_code: 'ARC-BOOKED',
        lifecycle_status: 'active',
        readiness: 'ready',
        custody_kind: 'at_branch',
        version: 1,
      },
      {
        asset_code: 'ARC-CUSTODY',
        lifecycle_status: 'active',
        readiness: 'unready',
        custody_kind: 'with_customer',
        version: 1,
      },
      {
        asset_code: 'ARC-MAINT',
        lifecycle_status: 'active',
        readiness: 'needs_repair',
        custody_kind: 'at_branch',
        version: 1,
      },
      {
        asset_code: 'ARC-MANUAL',
        lifecycle_status: 'retired',
        readiness: 'unready',
        custody_kind: 'at_branch',
        version: 2,
      },
      {
        asset_code: 'ARC-SAFE',
        lifecycle_status: 'active',
        readiness: 'ready',
        custody_kind: 'at_branch',
        version: 3,
      },
    ]);
    expect(state.reservationSnapshot).toEqual(seed.reservationSnapshot);
    expect(state.reservationAllocation).toEqual({
      asset_id: seed.bookedAssetId,
      reservation_line_id: seed.reservationLineId,
      is_blocking: true,
      released_at: null,
      kind: 'reservation_confirmed',
    });
    expect(state.maintenanceAllocation).toEqual({
      asset_id: seed.maintenanceAssetId,
      is_blocking: true,
      released_at: null,
      kind: 'maintenance',
    });
    expect(state.auditActions).toEqual([
      'catalogue.clothing.archived',
      'catalogue.clothing.restored_to_draft',
    ]);

    useClerk(seed);
    const published = await request(app)
      .post(`/api/v1/catalogue/clothing/${seed.productId}/publish`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt073-publish-after-restore')
      .send({ expected_updated_at: readString(readData(restored.body).updated_at) });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body).toMatchObject({
      success: true,
      data: { product_id: seed.productId, status: 'active' },
    });
  });

  it('controls variant lifecycle safely, preserves referenced history, and only hard-deletes an unused draft variant', async () => {
    const seed = await seedArchiveCatalogue('org_clt074_variant_lifecycle', 'user_clt074_variant_lifecycle');
    useClerk(seed);
    const app = createApp();

    const initialDetail = await request(app).get(`/api/v1/catalogue/clothing/${seed.productId}`);
    expect(initialDetail.status).toBe(200);
    const variants = readArray(readData(initialDetail.body).variants);
    const primary = variants.find((variant) => readString(variant.id) === seed.primaryVariantId);
    const secondary = variants.find((variant) => readString(variant.id) === seed.secondaryVariantId);
    if (!primary || !secondary) throw new Error('Expected both seeded variants in detail.');

    const drafted = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.primaryVariantId}/lifecycle`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt074-primary-draft')
      .send({ expected_updated_at: readString(primary.updated_at), status: 'draft' });
    expect(drafted.status).toBe(200);
    const draftedReplay = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.primaryVariantId}/lifecycle`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt074-primary-draft')
      .send({ expected_updated_at: readString(primary.updated_at), status: 'draft' });
    expect(draftedReplay.status).toBe(200);
    expect(draftedReplay.body).toEqual(drafted.body);
    expect(drafted.body).toMatchObject({ success: true, data: { status: 'draft', outcome: 'updated' } });

    const afterDraft = await readArchiveState(seed);
    expect(afterDraft.reservationSnapshot).toEqual(seed.reservationSnapshot);
    expect(afterDraft.reservationAllocation).toEqual({
      asset_id: seed.bookedAssetId,
      reservation_line_id: seed.reservationLineId,
      is_blocking: true,
      released_at: null,
      kind: 'reservation_confirmed',
    });

    const draftedData = readData(drafted.body);
    const removedReferenced = await request(app)
      .post(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.primaryVariantId}/remove`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'testtest44')
      .send({ expected_updated_at: readString(draftedData.updated_at) });
    expect(removedReferenced.status).toBe(200);
    expect(removedReferenced.body).toMatchObject({
      success: true,
      data: { variant_id: seed.primaryVariantId, status: 'archived', outcome: 'updated' },
    });

    const preserved = await readArchiveState(seed);
    expect(preserved.reservationSnapshot).toEqual(seed.reservationSnapshot);
    expect(preserved.reservationAllocation.released_at).toBeNull();
    expect(preserved.reservationAllocation.is_blocking).toBe(true);

    const lastActiveBlocked = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.secondaryVariantId}/lifecycle`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt074-last-active')
      .send({ expected_updated_at: readString(secondary.updated_at), status: 'archived' });
    expect(lastActiveBlocked.status).toBe(409);
    expectSafeError(lastActiveBlocked.body, 'STATE_CONFLICT');

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `UPDATE product_variant
            SET updated_at = updated_at + interval '1 second'
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.secondaryVariantId],
      );
    });
    const staleLifecycle = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.secondaryVariantId}/lifecycle`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt074-stale-lifecycle')
      .send({ expected_updated_at: readString(secondary.updated_at), status: 'draft' });
    expect(staleLifecycle.status).toBe(409);
    expectSafeError(staleLifecycle.body, 'STALE_VERSION');

    const unused = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ id: string; updated_at: Date }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
            measurement_mode, rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'ARC-UNUSED-DRAFT', 'XL', null, '{}'::jsonb, 'cm', 'none',
                 10000, 5000, 'PHP', 'daily', 1440, 0, 0, 0, 'draft')
         RETURNING id, updated_at`,
        [seed.tenantId, seed.productId],
      );
      return requireRow(result.rows, 'unused draft variant');
    });

    const removedUnused = await request(app)
      .post(`/api/v1/catalogue/clothing/${seed.productId}/variants/${unused.id}/remove`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt074-unused-remove')
      .send({ expected_updated_at: unused.updated_at.toISOString() });
    expect(removedUnused.status).toBe(200);
    expect(removedUnused.body).toMatchObject({
      success: true,
      data: { variant_id: unused.id, outcome: 'deleted', updated_at: null },
    });

    const finalEvidence = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const deleted = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM product_variant WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, unused.id],
      );
      const audit = await client.query<{ action: string; entity_id: string }>(
        `SELECT action, entity_id
           FROM audit_event
          WHERE tenant_id = $1
            AND entity_id = ANY($2::uuid[])
            AND action IN (
              'catalogue.clothing.variant_lifecycle_updated',
              'catalogue.clothing.variant_archived',
              'catalogue.clothing.variant_deleted'
            )
          ORDER BY occurred_at ASC`,
        [seed.tenantId, [seed.primaryVariantId, unused.id]],
      );
      return {
        deletedCount: deleted.rows[0]?.count ?? -1,
        audit: audit.rows,
      };
    });
    expect(finalEvidence.deletedCount).toBe(0);
    expect(finalEvidence.audit).toEqual([
      { action: 'catalogue.clothing.variant_lifecycle_updated', entity_id: seed.primaryVariantId },
      { action: 'catalogue.clothing.variant_archived', entity_id: seed.primaryVariantId },
      { action: 'catalogue.clothing.variant_deleted', entity_id: unused.id },
    ]);
  });

  it('requires assets.manage for variant lifecycle mutations', async () => {
    const seed = await seedArchiveCatalogue(
      'org_clt074_variant_permission',
      'user_clt074_variant_permission',
      ['assets.archive'],
    );
    useClerk(seed);
    const updatedAt = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ updated_at: Date }>(
        `SELECT updated_at FROM product_variant WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.primaryVariantId],
      );
      return requireRow(result.rows, 'variant permission timestamp').updated_at.toISOString();
    });

    const forbidden = await request(createApp())
      .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.primaryVariantId}/lifecycle`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt074-no-manage-permission')
      .send({ expected_updated_at: updatedAt, status: 'draft' });
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');
  });

  it('rejects stale restore intent and requires archive authority', async () => {
    const staleSeed = await seedArchiveCatalogue('org_clt073_stale_restore', 'user_clt073_stale_restore');
    useClerk(staleSeed);
    const app = createApp();
    const archived = await request(app)
      .post(`/api/v1/catalogue/clothing/${staleSeed.productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt073-stale-archive')
      .send({ expected_updated_at: staleSeed.productUpdatedAt });
    expect(archived.status).toBe(200);
    const archivedUpdatedAt = readString(readData(archived.body).updated_at);

    await withTenantTransaction(staleSeed.tenantId, staleSeed.principalId, async (client) => {
      await client.query(
        `UPDATE product SET updated_at = updated_at + interval '1 second' WHERE tenant_id = $1 AND id = $2`,
        [staleSeed.tenantId, staleSeed.productId],
      );
    });
    const stale = await request(app)
      .post(`/api/v1/catalogue/clothing/${staleSeed.productId}/restore`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt073-stale-restore')
      .send({ expected_updated_at: archivedUpdatedAt });
    expect(stale.status).toBe(409);
    expectSafeError(stale.body, 'STALE_VERSION');

    const permissionSeed = await seedArchiveCatalogue('org_clt073_restore_permission', 'user_clt073_restore_permission');
    useClerk(permissionSeed);
    const permissionArchive = await request(app)
      .post(`/api/v1/catalogue/clothing/${permissionSeed.productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt073-permission-archive')
      .send({ expected_updated_at: permissionSeed.productUpdatedAt });
    expect(permissionArchive.status).toBe(200);
    const permissionArchivedAt = readString(readData(permissionArchive.body).updated_at);
    await withTenantTransaction(permissionSeed.tenantId, permissionSeed.principalId, async (client) => {
      await client.query(
        `UPDATE branch_membership SET permission_codes = '["assets.manage"]'::jsonb WHERE tenant_id = $1`,
        [permissionSeed.tenantId],
      );
    });
    const forbidden = await request(app)
      .post(`/api/v1/catalogue/clothing/${permissionSeed.productId}/restore`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt073-no-archive-permission')
      .send({ expected_updated_at: permissionArchivedAt });
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');
  });

  it('rejects stale archive intent without changing product, variants, assets, or allocations', async () => {
    const seed = await seedArchiveCatalogue('org_clt032_stale', 'user_clt032_stale');
    useClerk(seed);

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `UPDATE product
            SET description = 'Concurrent edit',
                updated_at = updated_at + interval '1 second'
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.productId],
      );
    });

    const response = await request(createApp())
      .post(`/api/v1/catalogue/clothing/${seed.productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt032-stale-archive')
      .send({ expected_updated_at: seed.productUpdatedAt });

    expect(response.status).toBe(409);
    expectSafeError(response.body, 'STALE_VERSION');

    const state = await readArchiveState(seed);
    expect(state.product.status).toBe('active');
    expect(state.variantStatuses).toEqual(['active', 'active']);
    expect(state.assets.every((asset) => asset.lifecycle_status === 'active')).toBe(true);
    expect(state.reservationAllocation.is_blocking).toBe(true);
    expect(state.auditActions).toEqual([]);
  });

  it('replays concurrent duplicate archive intent with one lifecycle effect and one audit event', async () => {
    const seed = await seedArchiveCatalogue('org_clt032_duplicate', 'user_clt032_duplicate');
    useClerk(seed);
    const app = createApp();
    const body = { expected_updated_at: seed.productUpdatedAt };

    const [first, duplicate] = await Promise.all([
      request(app)
        .post(`/api/v1/catalogue/clothing/${seed.productId}/archive`)
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'clt032-double-fire') // gitleaks:allow
        .send(body),
      request(app)
        .post(`/api/v1/catalogue/clothing/${seed.productId}/archive`)
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'clt032-double-fire') // gitleaks:allow
        .send(body),
    ]);

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual(first.body);

    const state = await readArchiveState(seed);
    expect(state.product.status).toBe('archived');
    expect(state.assets.find((asset) => asset.asset_code === 'ARC-SAFE')?.version).toBe(2);
    expect(state.auditActions).toEqual(['catalogue.clothing.archived']);
  });

  it('keeps archive permission-scoped and rejects allocation-release authority from the browser', async () => {
    const forbiddenSeed = await seedArchiveCatalogue(
      'org_clt032_forbidden',
      'user_clt032_forbidden',
      [],
    );
    useClerk(forbiddenSeed);

    const forbidden = await request(createApp())
      .post(`/api/v1/catalogue/clothing/${forbiddenSeed.productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt032-no-permission') // gitleaks:allow
      .send({ expected_updated_at: forbiddenSeed.productUpdatedAt });
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');

    const strictSeed = await seedArchiveCatalogue('org_clt032_strict', 'user_clt032_strict');
    useClerk(strictSeed);
    const strict = await request(createApp())
      .post(`/api/v1/catalogue/clothing/${strictSeed.productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt032-strict-body') // gitleaks:allow
      .send({
        expected_updated_at: strictSeed.productUpdatedAt,
        release_allocations: true,
      });
    expect(strict.status).toBe(422);
    expectSafeError(strict.body, 'VALIDATION_FAILED');
  });

  function useClerk(seed: { principalId: string; clerkOrgId: string }) {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }

  async function seedArchiveCatalogue(
    clerkOrgId: string,
    principalId: string,
    permissions: string[] = ['assets.manage', 'assets.archive'],
  ) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');

    const seeded = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active')
         RETURNING id`,
        [tenant.id],
      );
      const branchId = requireRow(branch.rows, 'branch').id;
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, branchId, membershipId, JSON.stringify(permissions)],
      );

      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'starter' AND version = 1 AND active = true LIMIT 1`,
      );
      const planId = requireRow(plan.rows, 'starter plan').id;
      await client.query(
        `INSERT INTO subscription
           (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );

      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10)
         RETURNING id`,
        [tenant.id],
      );
      const categoryId = requireRow(category.rows, 'category').id;

      const product = await client.query<{ id: string; updated_at: Date }>(
        `INSERT INTO product
           (tenant_id, category_id, code, name, description, status, created_at, updated_at)
         VALUES ($1, $2, 'ARC-001', 'Archive Emerald Gown', 'Archive command fixture', 'active', now(), now())
         RETURNING id, updated_at`,
        [tenant.id, categoryId],
      );
      const productRow = requireRow(product.rows, 'product');

      const variants = await client.query<{ id: string; sku: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
            measurement_mode, rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes,
            status, created_at, updated_at)
         VALUES
           ($1, $2, 'ARC-001-M', 'M', 'Emerald', '{}'::jsonb, 'cm', 'none',
            10000, 5000, 'PHP', 'daily', 1440, 10000, 0, 1440, 'active', now(), now()),
           ($1, $2, 'ARC-001-L', 'L', 'Emerald', '{}'::jsonb, 'cm', 'none',
            12000, 5000, 'PHP', 'daily', 1440, 12000, 0, 1440, 'active', now(), now())
         RETURNING id, sku`,
        [tenant.id, productRow.id],
      );
      const primaryVariantId = requireSku(variants.rows, 'ARC-001-M').id;
      const secondaryVariantId = requireSku(variants.rows, 'ARC-001-L').id;

      const assets = await client.query<{ id: string; asset_code: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind,
            version, created_at, updated_at)
         VALUES
           ($1, $2, $3, 'ARC-SAFE', 'active', 'ready', 'at_branch', 1, now(), now()),
           ($1, $2, $3, 'ARC-BOOKED', 'active', 'ready', 'at_branch', 1, now(), now()),
           ($1, $2, $4, 'ARC-CUSTODY', 'active', 'unready', 'with_customer', 1, now(), now()),
           ($1, $2, $4, 'ARC-MAINT', 'active', 'needs_repair', 'at_branch', 1, now(), now())
         RETURNING id, asset_code`,
        [tenant.id, branchId, primaryVariantId, secondaryVariantId],
      );
      const safeAssetId = requireAsset(assets.rows, 'ARC-SAFE').id;
      const bookedAssetId = requireAsset(assets.rows, 'ARC-BOOKED').id;
      const custodyAssetId = requireAsset(assets.rows, 'ARC-CUSTODY').id;
      const maintenanceAssetId = requireAsset(assets.rows, 'ARC-MAINT').id;

      const storefrontSlug = `archive-${tenant.id.slice(0, 8)}`;
      const storefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact, published_at)
         VALUES ($1, $2, $3, 'published', '{}'::jsonb, '{}'::jsonb, now())
         RETURNING id`,
        [tenant.id, branchId, storefrontSlug],
      );
      const storefrontId = requireRow(storefront.rows, 'storefront').id;
      const policy = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
            delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 'Archive fixture privacy notice', now())
         RETURNING id`,
        [tenant.id, storefrontId],
      );
      const policyId = requireRow(policy.rows, 'policy').id;
      const paymentMethod = await client.query<{ id: string }>(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES ($1, 'Cash', 'cash', '{}'::jsonb, true, 1)
         RETURNING id`,
        [tenant.id],
      );
      const paymentMethodId = requireRow(paymentMethod.rows, 'payment method').id;

      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservation
           (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, price_snapshot,
            currency, rental_total_minor, security_required_minor, due_now_minor,
            hold_acquired_at, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, 'ARC-RES-001', 'confirmed',
                 now() + interval '5 days', now() + interval '7 days', 'Asia/Manila',
                 $6::jsonb, 'PHP', 10000, 5000, 15000, now(), now())
         RETURNING id`,
        [
          tenant.id,
          branchId,
          storefrontId,
          policyId,
          paymentMethodId,
          JSON.stringify({ mode: 'daily', rental_price_minor: '10000', security_deposit_minor: '5000' }),
        ],
      );
      const reservationId = requireRow(reservation.rows, 'reservation').id;
      const reservationSnapshot = {
        name_snapshot: 'Archive Emerald Gown',
        measurements_snapshot: { size: 'M' },
        pricing_snapshot: { rental_price_minor: '10000', security_deposit_minor: '5000' },
        rental_minor: 10000,
        deposit_minor: 5000,
        currency: 'PHP',
      };
      const reservationLine = await client.query<{ id: string }>(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
         RETURNING id`,
        [
          tenant.id,
          reservationId,
          primaryVariantId,
          reservationSnapshot.name_snapshot,
          JSON.stringify(reservationSnapshot.measurements_snapshot),
          JSON.stringify(reservationSnapshot.pricing_snapshot),
          reservationSnapshot.rental_minor,
          reservationSnapshot.deposit_minor,
          reservationSnapshot.currency,
        ],
      );
      const reservationLineId = requireRow(reservationLine.rows, 'reservation line').id;
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'reservation_confirmed',
                 tstzrange(now() + interval '4 days', now() + interval '8 days', '[)'), true)`,
        [tenant.id, branchId, bookedAssetId, reservationLineId],
      );

      const maintenance = await client.query<{ id: string }>(
        `INSERT INTO maintenance_work_order
           (tenant_id, branch_id, asset_id, kind, status, reason, opened_at)
         VALUES ($1, $2, $3, 'repair', 'open', 'Repair before next use', now())
         RETURNING id`,
        [tenant.id, branchId, maintenanceAssetId],
      );
      const maintenanceId = requireRow(maintenance.rows, 'maintenance work order').id;
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, maintenance_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'maintenance',
                 tstzrange(now() + interval '9 days', now() + interval '11 days', '[)'), true)`,
        [tenant.id, branchId, maintenanceAssetId, maintenanceId],
      );

      return {
        branchId,
        productId: productRow.id,
        productUpdatedAt: productRow.updated_at.toISOString(),
        primaryVariantId,
        secondaryVariantId,
        safeAssetId,
        bookedAssetId,
        custodyAssetId,
        maintenanceAssetId,
        storefrontSlug,
        reservationLineId,
        reservationSnapshot,
      };
    });

    return {
      tenantId: tenant.id,
      clerkOrgId: tenant.clerkOrgId,
      principalId,
      ...seeded,
    };
  }

  async function readArchiveState(seed: Awaited<ReturnType<typeof seedArchiveCatalogue>>) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const product = await client.query<{ status: string; updated_at: Date }>(
        `SELECT status, updated_at
           FROM product
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.productId],
      );
      const variants = await client.query<{ status: string }>(
        `SELECT status
           FROM product_variant
          WHERE tenant_id = $1 AND product_id = $2
          ORDER BY sku ASC`,
        [seed.tenantId, seed.productId],
      );
      const assets = await client.query<{
        asset_code: string;
        lifecycle_status: string;
        readiness: string;
        custody_kind: string;
        version: number;
      }>(
        `SELECT pa.asset_code, pa.lifecycle_status, pa.readiness, pa.custody_kind, pa.version
           FROM physical_asset pa
           JOIN product_variant pv
             ON pv.tenant_id = pa.tenant_id
            AND pv.id = pa.variant_id
          WHERE pa.tenant_id = $1
            AND pv.product_id = $2
          ORDER BY pa.asset_code ASC`,
        [seed.tenantId, seed.productId],
      );
      const reservationLine = await client.query<{
        name_snapshot: string;
        measurements_snapshot: Record<string, unknown>;
        pricing_snapshot: Record<string, unknown>;
        rental_minor: number;
        deposit_minor: number;
        currency: string;
      }>(
        `SELECT name_snapshot, measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency
           FROM reservation_line
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.reservationLineId],
      );
      const reservationAllocation = await client.query<{
        asset_id: string;
        reservation_line_id: string;
        is_blocking: boolean;
        released_at: Date | null;
        kind: string;
      }>(
        `SELECT asset_id, reservation_line_id, is_blocking, released_at, kind
           FROM asset_allocation
          WHERE tenant_id = $1
            AND reservation_line_id = $2`,
        [seed.tenantId, seed.reservationLineId],
      );
      const maintenanceAllocation = await client.query<{
        asset_id: string;
        is_blocking: boolean;
        released_at: Date | null;
        kind: string;
      }>(
        `SELECT asset_id, is_blocking, released_at, kind
           FROM asset_allocation
          WHERE tenant_id = $1
            AND asset_id = $2
            AND maintenance_id IS NOT NULL`,
        [seed.tenantId, seed.maintenanceAssetId],
      );
      const audit = await client.query<{ action: string }>(
        `SELECT action
           FROM audit_event
          WHERE tenant_id = $1
            AND entity_id = $2
            AND action IN ('catalogue.clothing.archived', 'catalogue.clothing.restored_to_draft')
          ORDER BY occurred_at ASC`,
        [seed.tenantId, seed.productId],
      );

      return {
        product: requireRow(product.rows, 'product state'),
        variantStatuses: variants.rows.map((row) => row.status),
        assets: assets.rows,
        reservationSnapshot: requireRow(reservationLine.rows, 'reservation snapshot'),
        reservationAllocation: requireRow(reservationAllocation.rows, 'reservation allocation'),
        maintenanceAllocation: requireRow(maintenanceAllocation.rows, 'maintenance allocation'),
        auditActions: audit.rows.map((row) => row.action),
      };
    });
  }

  function futureInterval(startDays: number, endDays: number): { start: string; end: string } {
    const dayMs = 24 * 60 * 60 * 1_000;
    return {
      start: new Date(Date.now() + startDays * dayMs).toISOString(),
      end: new Date(Date.now() + endDays * dayMs).toISOString(),
    };
  }

  function readData(body: unknown): Record<string, unknown> {
    const envelope = body as { data?: unknown };
    if (!envelope.data || typeof envelope.data !== 'object') {
      throw new Error('Expected success envelope data.');
    }
    return envelope.data as Record<string, unknown>;
  }

  function readArray(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) throw new Error('Expected array value.');
    return value as Array<Record<string, unknown>>;
  }

  function readItems(body: unknown): Array<Record<string, unknown>> {
    return readArray(readData(body).items);
  }

  function readString(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Expected string value.');
    return value;
  }

  function asEnvelope(body: unknown): {
    success?: unknown;
    error?: { code?: unknown; message?: unknown; stack?: unknown };
    request_id?: unknown;
  } {
    return body as {
      success?: unknown;
      error?: { code?: unknown; message?: unknown; stack?: unknown };
      request_id?: unknown;
    };
  }

  function expectSafeError(body: unknown, code: string) {
    const parsed = asEnvelope(body);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.code).toBe(code);
    expect(parsed.error?.message).toEqual(expect.any(String));
    expect(parsed.error?.stack).toBeUndefined();
    expect(parsed.request_id).toEqual(expect.any(String));
  }

  function requireSku<T extends { sku: string }>(rows: T[], sku: string): T {
    const row = rows.find((candidate) => candidate.sku === sku);
    if (!row) throw new Error(`Expected variant ${sku}.`);
    return row;
  }

  function requireAsset<T extends { asset_code: string }>(rows: T[], assetCode: string): T {
    const row = rows.find((candidate) => candidate.asset_code === assetCode);
    if (!row) throw new Error(`Expected asset ${assetCode}.`);
    return row;
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} query to return a row.`);
    return row;
  }
});
