import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { BranchId, PermissionCode, ProductVariantId, TenantId } from '@drezivo/contracts';

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
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 2).toString('base64url');
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

const AVAILABILITY_WINDOW = {
  start: '2026-10-10T00:00:00.000Z',
  end: '2026-10-11T00:00:00.000Z',
} as const;

const RESERVATION_ALLOCATION = {
  start: '2026-11-10T10:00:00.000Z',
  end: '2026-11-13T10:00:00.000Z',
} as const;

describe('CLT-078 catalogue lifecycle propagation', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const {
    archiveClothing,
    publishClothing,
    restoreClothing,
    updateClothingVariantLifecycle,
    updatePhysicalAssetState,
  } = await import('../../src/modules/catalogue/catalogue.service.js');
  const { resolveReservationCatalogueSelection } = await import(
    '../../src/modules/catalogue/catalogue-allocation.service.js'
  );
  const { computeAvailability } = await import('../../src/modules/storefront/storefront.repository.js');
  const { publicStorefrontService } = await import('../../src/modules/storefront/storefront.service.js');
  const { createTestTenant } = await import('./helpers/factories.js');

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

  it('keeps storefront visibility and reservation candidates aligned through product and variant lifecycle changes', async () => {
    const seed = await seedLifecycleGraph();
    const context = commandContext(seed.tenantId, seed.branchId, seed.principalId);

    expect(await publicVariantIds(seed.storefrontSlug, seed.productId)).toEqual([]);
    expect(await reservationSelection(seed, seed.mediumVariantId)).toBeNull();

    const published = await publishClothing({
      ...context,
      requestId: 'req-clt078-publish',
      idempotencyKey: 'testtest00',
      productId: seed.productId,
      request: { expected_updated_at: seed.productUpdatedAt },
    });
    expect(published.status).toBe(200);

    expect(await publicVariantIds(seed.storefrontSlug, seed.productId)).toEqual(
      [seed.largeVariantId, seed.mediumVariantId].sort(),
    );
    expect((await reservationSelection(seed, seed.mediumVariantId))?.candidate_asset_ids).toEqual([
      seed.mediumAssetId,
    ]);
    expect(await availableUnits(seed.storefrontSlug, seed.mediumVariantId)).toBe(1);

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(`UPDATE category SET status = 'inactive' WHERE tenant_id = $1 AND id = $2`, [
        seed.tenantId,
        seed.categoryId,
      ]),
    );
    expect(await publicVariantIds(seed.storefrontSlug, seed.productId)).toEqual([]);
    expect(await reservationSelection(seed, seed.mediumVariantId)).toBeNull();
    expect(await availableUnits(seed.storefrontSlug, seed.mediumVariantId)).toBe(0);

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(`UPDATE category SET status = 'active' WHERE tenant_id = $1 AND id = $2`, [
        seed.tenantId,
        seed.categoryId,
      ]),
    );

    const dirtyAsset = await updatePhysicalAssetState({
      ...context,
      requestId: 'req-clt078-needs-cleaning',
      idempotencyKey: 'clt078-needs-cleaning',
      assetId: seed.mediumAssetId,
      request: { expected_version: 1, readiness: 'needs_cleaning' },
    });
    expect(dirtyAsset.status).toBe(200);
    expect((await reservationSelection(seed, seed.mediumVariantId))?.candidate_asset_ids).toEqual([]);
    expect(await availableUnits(seed.storefrontSlug, seed.mediumVariantId)).toBe(0);

    const mediumVersion = await readAssetVersion(seed, seed.mediumAssetId);
    const readyAsset = await updatePhysicalAssetState({
      ...context,
      requestId: 'req-clt078-ready',
      idempotencyKey: 'clt078-ready',
      assetId: seed.mediumAssetId,
      request: { expected_version: mediumVersion, readiness: 'ready' },
    });
    expect(readyAsset.status).toBe(200);
    expect((await reservationSelection(seed, seed.mediumVariantId))?.candidate_asset_ids).toEqual([
      seed.mediumAssetId,
    ]);
    expect(await availableUnits(seed.storefrontSlug, seed.mediumVariantId)).toBe(1);

    const mediumBeforeArchive = await readVariantUpdatedAt(seed, seed.mediumVariantId);
    const archivedMedium = await updateClothingVariantLifecycle({
      ...context,
      requestId: 'req-clt078-variant-archive',
      idempotencyKey: 'clt078-variant-archive',
      productId: seed.productId,
      variantId: seed.mediumVariantId,
      request: { expected_updated_at: mediumBeforeArchive, status: 'archived' },
    });
    expect(archivedMedium.status).toBe(200);
    expect(await publicVariantIds(seed.storefrontSlug, seed.productId)).toEqual([seed.largeVariantId]);
    expect(await reservationSelection(seed, seed.mediumVariantId)).toBeNull();
    expect((await reservationSelection(seed, seed.largeVariantId))?.candidate_asset_ids).toEqual([
      seed.largeAssetId,
    ]);

    const mediumBeforeDraft = await readVariantUpdatedAt(seed, seed.mediumVariantId);
    const restoredMediumToDraft = await updateClothingVariantLifecycle({
      ...context,
      requestId: 'req-clt078-variant-draft',
      idempotencyKey: 'clt078-variant-draft',
      productId: seed.productId,
      variantId: seed.mediumVariantId,
      request: { expected_updated_at: mediumBeforeDraft, status: 'draft' },
    });
    expect(restoredMediumToDraft.status).toBe(200);
    expect(await publicVariantIds(seed.storefrontSlug, seed.productId)).toEqual([seed.largeVariantId]);
    expect(await reservationSelection(seed, seed.mediumVariantId)).toBeNull();

    const mediumBeforePublish = await readVariantUpdatedAt(seed, seed.mediumVariantId);
    const republishedMedium = await updateClothingVariantLifecycle({
      ...context,
      requestId: 'req-clt078-variant-active',
      idempotencyKey: 'clt078-variant-active',
      productId: seed.productId,
      variantId: seed.mediumVariantId,
      request: { expected_updated_at: mediumBeforePublish, status: 'active' },
    });
    expect(republishedMedium.status).toBe(200);
    expect(await publicVariantIds(seed.storefrontSlug, seed.productId)).toEqual(
      [seed.largeVariantId, seed.mediumVariantId].sort(),
    );
    expect((await reservationSelection(seed, seed.mediumVariantId))?.candidate_asset_ids).toEqual([
      seed.mediumAssetId,
    ]);

    const reservationSnapshot = await seedConfirmedReservation(seed);
    const beforeArchiveHistory = await readReservationHistory(seed, reservationSnapshot.lineId);

    const productBeforeArchive = await readProductUpdatedAt(seed);
    const archivedProduct = await archiveClothing({
      ...context,
      requestId: 'req-clt078-product-archive',
      idempotencyKey: 'clt078-product-archive',
      productId: seed.productId,
      request: { expected_updated_at: productBeforeArchive },
    });
    expect(archivedProduct.status).toBe(200);
    expect(await publicVariantIds(seed.storefrontSlug, seed.productId)).toEqual([]);
    expect(await reservationSelection(seed, seed.mediumVariantId)).toBeNull();
    expect(await reservationSelection(seed, seed.largeVariantId)).toBeNull();
    expect(await readReservationHistory(seed, reservationSnapshot.lineId)).toEqual(beforeArchiveHistory);

    const productBeforeRestore = await readProductUpdatedAt(seed);
    const restoredProduct = await restoreClothing({
      ...context,
      requestId: 'req-clt078-product-restore',
      idempotencyKey: 'clt078-product-restore',
      productId: seed.productId,
      request: { expected_updated_at: productBeforeRestore },
    });
    expect(restoredProduct.status).toBe(200);
    expect(await publicVariantIds(seed.storefrontSlug, seed.productId)).toEqual([]);
    expect(await reservationSelection(seed, seed.largeVariantId)).toBeNull();

    const productBeforeRepublish = await readProductUpdatedAt(seed);
    const republishedProduct = await publishClothing({
      ...context,
      requestId: 'req-clt078-product-republish',
      idempotencyKey: 'clt078-product-republish',
      productId: seed.productId,
      request: { expected_updated_at: productBeforeRepublish },
    });
    expect(republishedProduct.status).toBe(200);

    expect(await publicVariantIds(seed.storefrontSlug, seed.productId)).toEqual(
      [seed.largeVariantId, seed.mediumVariantId].sort(),
    );
    expect((await reservationSelection(seed, seed.mediumVariantId))?.candidate_asset_ids).toEqual([
      seed.mediumAssetId,
    ]);
    expect((await reservationSelection(seed, seed.largeVariantId))?.candidate_asset_ids).toEqual([
      seed.largeAssetId,
    ]);
    expect(await readReservationHistory(seed, reservationSnapshot.lineId)).toEqual(beforeArchiveHistory);
  });

  it('uses only the storefront branch garment for public availability and excludes blocking allocations from both reads', async () => {
    const seed = await seedLifecycleGraph();
    const context = commandContext(seed.tenantId, seed.branchId, seed.principalId);

    const published = await publishClothing({
      ...context,
      requestId: 'req-clt078-branch-publish',
      idempotencyKey: 'clt078-branch-publish',
      productId: seed.productId,
      request: { expected_updated_at: seed.productUpdatedAt },
    });
    expect(published.status).toBe(200);

    expect(await availableUnits(seed.storefrontSlug, seed.mediumVariantId)).toBe(1);
    expect((await reservationSelection(seed, seed.mediumVariantId))?.candidate_asset_ids).toEqual([
      seed.mediumAssetId,
    ]);

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `UPDATE physical_asset
            SET readiness = 'needs_cleaning', recovery_managed_readiness = true
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.mediumAssetId],
      ),
    );
    expect(await availableUnits(seed.storefrontSlug, seed.mediumVariantId)).toBe(1);
    expect((await reservationSelection(seed, seed.mediumVariantId))?.candidate_asset_ids).toEqual([
      seed.mediumAssetId,
    ]);
    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `UPDATE physical_asset
            SET readiness = 'ready', recovery_managed_readiness = false
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.mediumAssetId],
      ),
    );

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const workOrder = await client.query<{ id: string }>(
        `INSERT INTO maintenance_work_order
           (tenant_id, branch_id, asset_id, kind, status, reason, opened_at)
         VALUES ($1, $2, $3, 'cleaning', 'open', 'CLT-078 cleaning block', now())
         RETURNING id`,
        [seed.tenantId, seed.branchId, seed.mediumAssetId],
      );
      const maintenanceId = requireRow(workOrder.rows, 'maintenance work order').id;
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, maintenance_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'maintenance', tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
        [
          seed.tenantId,
          seed.branchId,
          seed.mediumAssetId,
          maintenanceId,
          AVAILABILITY_WINDOW.start,
          AVAILABILITY_WINDOW.end,
        ],
      );
    });

    expect(await availableUnits(seed.storefrontSlug, seed.mediumVariantId)).toBe(0);
    expect((await reservationSelection(seed, seed.mediumVariantId))?.candidate_asset_ids).toEqual([]);
  });

  async function seedLifecycleGraph() {
    const principalId = `user_clt078_${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await createTestTenant({
      clerkOrgId: `org_clt078_${Math.random().toString(36).slice(2, 8)}`,
    });

    const seeded = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const branches = await client.query<{ id: string; code: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES
           ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active'),
           ($1, 'Other Branch', 'OTHER', false, 'Asia/Manila', 'active')
         RETURNING id, code`,
        [tenant.id],
      );
      const branchId = requireNamedRow(branches.rows, 'MAIN').id;
      const otherBranchId = requireNamedRow(branches.rows, 'OTHER').id;

      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10)
         RETURNING id`,
        [tenant.id],
      );
      const categoryId = requireRow(category.rows, 'category').id;

      const product = await client.query<{ id: string; updated_at: Date }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, 'CLT078-GWN', 'Lifecycle Emerald Gown', 'CLT-078 product', 'draft')
         RETURNING id, updated_at`,
        [tenant.id, categoryId],
      );
      const productRow = requireRow(product.rows, 'product');

      const variants = await client.query<{ id: string; sku: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
            measurement_mode, rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES
           ($1, $2, 'CLT078-M', 'M', 'Emerald', '{}'::jsonb, 'cm', 'none', 100000, 25000, 'PHP', 'daily', 1440, 100000, 0, 1440, 'draft'),
           ($1, $2, 'CLT078-L', 'L', 'Emerald', '{}'::jsonb, 'cm', 'none', 110000, 25000, 'PHP', 'daily', 1440, 110000, 0, 1440, 'draft')
         RETURNING id, sku`,
        [tenant.id, productRow.id],
      );
      const mediumVariantId = requireNamedRow(variants.rows, 'CLT078-M').id;
      const largeVariantId = requireNamedRow(variants.rows, 'CLT078-L').id;

      const assets = await client.query<{ id: string; asset_code: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind,
            measurement_overrides, version)
         VALUES
           ($1, $2, $3, 'CLT078-M-MAIN', 'active', 'ready', 'at_branch', '{}'::jsonb, 1),
           ($1, $4, $3, 'CLT078-M-OTHER', 'active', 'ready', 'at_branch', '{}'::jsonb, 1),
           ($1, $2, $5, 'CLT078-L-MAIN', 'active', 'ready', 'at_branch', '{}'::jsonb, 1)
         RETURNING id, asset_code`,
        [tenant.id, branchId, mediumVariantId, otherBranchId, largeVariantId],
      );
      const mediumAssetId = requireAsset(assets.rows, 'CLT078-M-MAIN').id;
      const mediumOtherBranchAssetId = requireAsset(assets.rows, 'CLT078-M-OTHER').id;
      const largeAssetId = requireAsset(assets.rows, 'CLT078-L-MAIN').id;

      const file = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'catalogue_image', 'catalogue/clt078-cover.webp', 'v1', 'clt078-sha',
                 'image/webp', 512, 'accepted', true, now() + interval '10 minutes', now())
         RETURNING id`,
        [tenant.id],
      );
      const fileId = requireRow(file.rows, 'catalogue image').id;
      await client.query(
        `INSERT INTO product_image (tenant_id, product_id, file_id, display_order)
         VALUES ($1, $2, $3, 0)`,
        [tenant.id, productRow.id, fileId],
      );

      const storefrontSlug = `clt078-${tenant.id.slice(0, 8)}`;
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
                 'CLT-078 privacy notice', now())
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

      return {
        branchId,
        otherBranchId,
        categoryId,
        productId: productRow.id,
        productUpdatedAt: productRow.updated_at.toISOString(),
        mediumVariantId,
        largeVariantId,
        mediumAssetId,
        mediumOtherBranchAssetId,
        largeAssetId,
        storefrontSlug,
        storefrontId,
        policyId,
        paymentMethodId,
      };
    });

    return {
      tenantId: tenant.id,
      principalId,
      ...seeded,
    };
  }

  async function reservationSelection(
    seed: Awaited<ReturnType<typeof seedLifecycleGraph>>,
    variantId: string,
  ) {
    return withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      resolveReservationCatalogueSelection(client, {
        tenantId: seed.tenantId as TenantId,
        branchId: seed.branchId as BranchId,
        variantId: variantId as ProductVariantId,
        blockedInterval: AVAILABILITY_WINDOW,
      }),
    );
  }

  async function publicVariantIds(slug: string, productId: string): Promise<string[]> {
    // A hidden product (or one with no active size) is a public 404, i.e. no public sizes.
    const item = await publicStorefrontService.getItem(slug, productId).catch(() => null);
    return item ? item.variants.map((variant) => variant.variant_id as string).sort() : [];
  }

  async function availableUnits(slug: string, variantId: string): Promise<number> {
    const slots = await computeAvailability(
      slug,
      variantId,
      AVAILABILITY_WINDOW.start,
      AVAILABILITY_WINDOW.end,
    );
    return slots?.[0]?.available_units ?? 0;
  }

  async function readProductUpdatedAt(seed: Awaited<ReturnType<typeof seedLifecycleGraph>>): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ updated_at: Date }>(
        `SELECT updated_at FROM product WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.productId],
      );
      return requireRow(result.rows, 'product timestamp').updated_at.toISOString();
    });
  }

  async function readVariantUpdatedAt(
    seed: Awaited<ReturnType<typeof seedLifecycleGraph>>,
    variantId: string,
  ): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ updated_at: Date }>(
        `SELECT updated_at FROM product_variant WHERE tenant_id = $1 AND product_id = $2 AND id = $3`,
        [seed.tenantId, seed.productId, variantId],
      );
      return requireRow(result.rows, 'variant timestamp').updated_at.toISOString();
    });
  }

  async function readAssetVersion(
    seed: Awaited<ReturnType<typeof seedLifecycleGraph>>,
    assetId: string,
  ): Promise<number> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ version: number }>(
        `SELECT version FROM physical_asset WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, assetId],
      );
      return requireRow(result.rows, 'asset version').version;
    });
  }

  async function seedConfirmedReservation(seed: Awaited<ReturnType<typeof seedLifecycleGraph>>) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservation
           (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, price_snapshot,
            currency, rental_total_minor, security_required_minor, due_now_minor,
            hold_acquired_at, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, 'CLT078-RES-001', 'confirmed',
                 $6::timestamptz, $7::timestamptz, 'Asia/Manila', $8::jsonb,
                 'PHP', 110000, 25000, 135000, now(), now())
         RETURNING id`,
        [
          seed.tenantId,
          seed.branchId,
          seed.storefrontId,
          seed.policyId,
          seed.paymentMethodId,
          RESERVATION_ALLOCATION.start,
          RESERVATION_ALLOCATION.end,
          JSON.stringify({ mode: 'daily', rental_price_minor: '110000', security_deposit_minor: '25000' }),
        ],
      );
      const reservationId = requireRow(reservation.rows, 'reservation').id;
      const line = await client.query<{ id: string }>(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, 'Lifecycle Emerald Gown — L', $4::jsonb, $5::jsonb,
                 110000, 25000, 'PHP')
         RETURNING id`,
        [
          seed.tenantId,
          reservationId,
          seed.largeVariantId,
          JSON.stringify({ size: 'L' }),
          JSON.stringify({ mode: 'daily', rental_price_minor: '110000', security_deposit_minor: '25000' }),
        ],
      );
      const lineId = requireRow(line.rows, 'reservation line').id;
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'reservation_confirmed',
                 tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
        [
          seed.tenantId,
          seed.branchId,
          seed.largeAssetId,
          lineId,
          RESERVATION_ALLOCATION.start,
          RESERVATION_ALLOCATION.end,
        ],
      );
      return { lineId };
    });
  }

  async function readReservationHistory(
    seed: Awaited<ReturnType<typeof seedLifecycleGraph>>,
    lineId: string,
  ) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const line = await client.query<{
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
        [seed.tenantId, lineId],
      );
      const allocations = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM asset_allocation
          WHERE tenant_id = $1 AND reservation_line_id = $2 AND is_blocking = true`,
        [seed.tenantId, lineId],
      );
      return {
        line: requireRow(line.rows, 'reservation snapshot'),
        blockingAllocationCount: requireRow(allocations.rows, 'reservation allocation count').count,
      };
    });
  }

  function commandContext(tenantId: string, branchId: string, principalId: string) {
    return {
      tenantId,
      branchId,
      membershipId: '00000000-0000-4000-8000-000000000078',
      principalId,
      permissionCodes: ['assets.manage', 'assets.archive'] as PermissionCode[],
      effectiveTenantStatus: 'active' as const,
    };
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label}.`);
    return row;
  }

  function requireNamedRow<T extends { code?: string; sku?: string }>(rows: T[], name: string): T {
    const row = rows.find((candidate) => candidate.code === name || candidate.sku === name);
    if (!row) throw new Error(`Expected row ${name}.`);
    return row;
  }

  function requireAsset<T extends { asset_code: string }>(rows: T[], assetCode: string): T {
    const row = rows.find((candidate) => candidate.asset_code === assetCode);
    if (!row) throw new Error(`Expected asset ${assetCode}.`);
    return row;
  }
});
