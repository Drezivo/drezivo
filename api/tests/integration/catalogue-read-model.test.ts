import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PermissionCode } from '@drezivo/contracts';

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

class FakeReadStorage {
  constructor(private readonly failingStorageKeys = new Set<string>()) {}

  readonly authorizedReads: Array<{
    storageKey: string;
    versionId?: string | null;
    expiresInSeconds: number;
  }> = [];

  authorizeUpload() {
    return Promise.reject(new Error('Upload authorization is not used by catalogue read tests.'));
  }

  authorizeRead(input: {
    storageKey: string;
    versionId?: string | null;
    expiresInSeconds: number;
  }) {
    this.authorizedReads.push(input);
    if (this.failingStorageKeys.has(input.storageKey)) {
      return Promise.reject(new Error('Simulated read authorization failure.'));
    }
    return Promise.resolve({
      readUrl: `https://reads.example.test/${encodeURIComponent(input.storageKey)}?version=${encodeURIComponent(input.versionId ?? '')}`,
      expiresAt: new Date('2026-09-21T00:05:00.000Z'),
    });
  }

  inspectUploadedObject() {
    return Promise.reject(new Error('Object inspection is not used by catalogue read tests.'));
  }
}

describe('CLT Phase 1 catalogue read model', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const {
    getCatalogueCategories,
    getCatalogueClothingDetail,
    getCatalogueClothingList,
  } = await import('../../src/modules/catalogue/catalogue.service.js');
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

  it('paginates a large tenant catalogue deterministically and applies server-side filters', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt010_large' });
    const seeded = await seedLargeCatalogue(tenant.id, 'user_clt010_large');
    const context = catalogueContext(tenant.id, seeded.branchId, 'user_clt010_large');

    const first = await getCatalogueClothingList(context, {
      limit: 25,
      sort: 'name_asc',
    });
    expect(first.items).toHaveLength(25);
    expect(first.page_meta.has_more).toBe(true);
    expect(first.page_meta.next_cursor).toEqual(expect.any(String));
    expect(first.summary).toEqual({
      total_products: 120,
      active_rental_items: 119,
      active_categories: 2,
      archived_products: 1,
      matching_products: 120,
    });

    const second = await getCatalogueClothingList(context, {
      limit: 25,
      sort: 'name_asc',
      cursor: first.page_meta.next_cursor ?? undefined,
    });
    expect(second.items).toHaveLength(25);
    expect(new Set([...first.items, ...second.items].map((item) => item.product_id)).size).toBe(50);
    const secondFirst = second.items[0];
    const firstLast = first.items.at(-1);
    if (!secondFirst || !firstLast) throw new Error('Expected populated first and second pages.');
    expect(secondFirst.name > firstLast.name).toBe(true);

    const activeOnly = await getCatalogueClothingList(context, {
      limit: 20,
      sort: 'name_asc',
      product_status: 'active',
    });
    expect(activeOnly.summary).toEqual({
      total_products: 120,
      active_rental_items: 119,
      active_categories: 2,
      archived_products: 1,
      matching_products: 119,
    });

    const searched = await getCatalogueClothingList(context, {
      limit: 20,
      sort: 'name_asc',
      search: 'Rental Look 119',
    });
    expect(searched.items.map((item) => item.code)).toEqual(['LOOK-119']);
    expect(searched.summary.matching_products).toBe(1);

    const categoryFiltered = await getCatalogueClothingList(context, {
      limit: 100,
      sort: 'code_asc',
      category_id: seeded.costumesCategoryId as never,
    });
    expect(categoryFiltered.items).toHaveLength(20);
    expect(categoryFiltered.items.every((item) => item.category?.name === 'Costumes')).toBe(true);

    const sizeFiltered = await getCatalogueClothingList(context, {
      limit: 100,
      sort: 'code_asc',
      size_label: 'L',
    });
    expect(sizeFiltered.items).toHaveLength(20);
    expect(sizeFiltered.items.every((item) => item.size_labels.includes('L'))).toBe(true);

    const readinessFiltered = await getCatalogueClothingList(context, {
      limit: 100,
      sort: 'code_asc',
      readiness: 'needs_cleaning',
    });
    expect(readinessFiltered.items).toHaveLength(5);
    expect(readinessFiltered.items.every((item) => item.readiness.needs_cleaning === 1)).toBe(true);

    const archived = await getCatalogueClothingList(context, {
      limit: 20,
      sort: 'code_asc',
      product_status: 'archived',
    });
    expect(archived.items.map((item) => item.code)).toEqual(['LOOK-120']);

    const empty = await getCatalogueClothingList(context, {
      limit: 20,
      sort: 'name_asc',
      search: 'this does not exist',
    });
    expect(empty).toEqual({
      items: [],
      page_meta: { next_cursor: null, has_more: false },
      summary: {
        total_products: 120,
        active_rental_items: 119,
        active_categories: 2,
        archived_products: 1,
        matching_products: 0,
      },
    });
  });

  it('excludes archived variants and their physical pieces from the normal inventory list projection', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt074_list_projection' });
    const seeded = await seedSimpleCatalogue(tenant.id, 'user_clt074_list_projection', {
      productName: 'Projection Gown',
      code: 'PROJ-001',
      categoryName: 'Gowns',
    });
    const context = catalogueContext(tenant.id, seeded.branchId, 'user_clt074_list_projection');

    await withTenantTransaction(tenant.id, 'user_clt074_list_projection', async (client) => {
      const archivedVariant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements,
            measurement_unit, measurement_mode, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, status)
         VALUES ($1, $2, 'SKU-PROJ-001-XL', 'XL', 'Black', '{}'::jsonb, 'cm', 'none',
                 5000, 5000, 'PHP', 'daily', 1440, 'archived')
         RETURNING id`,
        [tenant.id, seeded.productId],
      );
      const archivedVariantId = requireRow(archivedVariant.rows, 'archived projection variant').id;
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'AST-PROJ-001-XL', 'active', 'ready', 'at_branch')`,
        [tenant.id, seeded.branchId, archivedVariantId],
      );
    });

    const list = await getCatalogueClothingList(context, {
      limit: 20,
      sort: 'code_asc',
      search: 'PROJ-001',
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      code: 'PROJ-001',
      size_labels: ['M'],
      price_from_minor: '10000',
      readiness: { active_assets: 1, ready: 1 },
      availability: { active_assets: 1, available_assets: 1 },
    });

    const archivedSizeFilter = await getCatalogueClothingList(context, {
      limit: 20,
      sort: 'code_asc',
      size_label: 'XL',
    });
    expect(archivedSizeFilter.items).toEqual([]);
  });

  it('returns a signed cover image URL for display order zero and null when no cover exists', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt010_cover_image' });
    const seeded = await seedLargeCatalogue(tenant.id, 'user_clt010_cover_image');
    const context = catalogueContext(tenant.id, seeded.branchId, 'user_clt010_cover_image');
    const storage = new FakeReadStorage();

    await withTenantTransaction(tenant.id, 'user_clt010_cover_image', async (client) => {
      const product = await client.query<{ id: string }>(
        `SELECT id FROM product WHERE tenant_id = $1 AND code = 'LOOK-001' LIMIT 1`,
        [tenant.id],
      );
      const productId = requireRow(product.rows, 'cover-image product').id;
      const files = await client.query<{ id: string; storage_key: string; version_id: string | null }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES
           ($1, 'catalogue_image', 'catalogue/look-001-secondary.webp', 'secondary-v1', 'secondary-sha',
            'image/webp', 512, 'accepted', true, now() + interval '10 minutes', now()),
           ($1, 'catalogue_image', 'catalogue/look-001-cover.webp', 'cover-v7', 'cover-sha',
            'image/webp', 512, 'accepted', true, now() + interval '10 minutes', now())
         RETURNING id, storage_key, version_id`,
        [tenant.id],
      );
      const secondary = requireNamedStorageFile(files.rows, 'catalogue/look-001-secondary.webp');
      const cover = requireNamedStorageFile(files.rows, 'catalogue/look-001-cover.webp');
      await client.query(
        `INSERT INTO product_image (tenant_id, product_id, file_id, display_order)
         VALUES ($1, $2, $3, 1), ($1, $2, $4, 0)`,
        [tenant.id, productId, secondary.id, cover.id],
      );
    });

    const withCover = await getCatalogueClothingList(
      context,
      { limit: 10, sort: 'code_asc', search: 'LOOK-001' },
      storage,
    );
    expect(withCover.items).toHaveLength(1);
    expect(withCover.items[0]?.primary_image_url).toBe(
      'https://reads.example.test/catalogue%2Flook-001-cover.webp?version=cover-v7',
    );
    expect(storage.authorizedReads).toEqual([
      {
        storageKey: 'catalogue/look-001-cover.webp',
        versionId: 'cover-v7',
        expiresInSeconds: 300,
      },
    ]);

    const withoutCover = await getCatalogueClothingList(
      context,
      { limit: 10, sort: 'code_asc', search: 'LOOK-002' },
      storage,
    );
    expect(withoutCover.items).toHaveLength(1);
    expect(withoutCover.items[0]?.primary_image_url).toBeNull();
    expect(storage.authorizedReads).toHaveLength(1);
  });

  it('returns signed Clothing Detail image URLs in display order and degrades failed authorizations to null', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt071_detail_images' });
    const seeded = await seedLargeCatalogue(tenant.id, 'user_clt071_detail_images');
    const context = catalogueContext(tenant.id, seeded.branchId, 'user_clt071_detail_images');
    const storage = new FakeReadStorage(new Set(['catalogue/look-001-secondary.webp']));

    const productId = await withTenantTransaction(tenant.id, 'user_clt071_detail_images', async (client) => {
      const product = await client.query<{ id: string }>(
        `SELECT id FROM product WHERE tenant_id = $1 AND code = 'LOOK-001' LIMIT 1`,
        [tenant.id],
      );
      const selectedProductId = requireRow(product.rows, 'detail-image product').id;
      const files = await client.query<{ id: string; storage_key: string; version_id: string | null }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES
           ($1, 'catalogue_image', 'catalogue/look-001-cover.webp', 'cover-v1', 'cover-detail-sha',
            'image/webp', 512, 'accepted', true, now() + interval '10 minutes', now()),
           ($1, 'catalogue_image', 'catalogue/look-001-secondary.webp', 'secondary-v2', 'secondary-detail-sha',
            'image/webp', 512, 'accepted', true, now() + interval '10 minutes', now())
         RETURNING id, storage_key, version_id`,
        [tenant.id],
      );
      const cover = requireNamedStorageFile(files.rows, 'catalogue/look-001-cover.webp');
      const secondary = requireNamedStorageFile(files.rows, 'catalogue/look-001-secondary.webp');
      await client.query(
        `INSERT INTO product_image (tenant_id, product_id, file_id, display_order)
         VALUES ($1, $2, $3, 0), ($1, $2, $4, 1)`,
        [tenant.id, selectedProductId, cover.id, secondary.id],
      );
      return selectedProductId;
    });

    const detail = await getCatalogueClothingDetail(context, productId, storage);
    expect(detail.images).toHaveLength(2);
    expect(typeof detail.images[0]?.file_id).toBe('string');
    expect(detail.images[0]).toMatchObject({
      display_order: 0,
      image_url: 'https://reads.example.test/catalogue%2Flook-001-cover.webp?version=cover-v1',
    });
    expect(typeof detail.images[1]?.file_id).toBe('string');
    expect(detail.images[1]).toMatchObject({
      display_order: 1,
      image_url: null,
    });
    expect(storage.authorizedReads).toEqual([
      {
        storageKey: 'catalogue/look-001-cover.webp',
        versionId: 'cover-v1',
        expiresInSeconds: 300,
      },
      {
        storageKey: 'catalogue/look-001-secondary.webp',
        versionId: 'secondary-v2',
        expiresInSeconds: 300,
      },
    ]);
  });

  it('rejects an invalid or sort-mismatched cursor instead of drifting pagination', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt010_cursor' });
    const seeded = await seedLargeCatalogue(tenant.id, 'user_clt010_cursor');
    const context = catalogueContext(tenant.id, seeded.branchId, 'user_clt010_cursor');

    const first = await getCatalogueClothingList(context, { limit: 5, sort: 'name_asc' });
    const cursor = first.page_meta.next_cursor;
    if (!cursor) throw new Error('Expected the first catalogue page to provide a cursor.');

    await expect(
      getCatalogueClothingList(context, { limit: 5, sort: 'newest', cursor }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      getCatalogueClothingList(context, { limit: 5, sort: 'name_asc', cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('does not enumerate another tenant through search or foreign category filters', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_clt010_isolation_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_clt010_isolation_b' });
    const seededA = await seedSimpleCatalogue(tenantA.id, 'user_clt010_isolation_a', {
      productName: 'Tenant A Gown',
      code: 'A-GOWN',
      categoryName: 'Gowns',
    });
    const seededB = await seedSimpleCatalogue(tenantB.id, 'user_clt010_isolation_b', {
      productName: 'Private Tenant B Dress',
      code: 'PRIVATE-B',
      categoryName: 'Private Category B',
    });
    const contextA = catalogueContext(tenantA.id, seededA.branchId, 'user_clt010_isolation_a');

    const bySearch = await getCatalogueClothingList(contextA, {
      limit: 20,
      sort: 'name_asc',
      search: 'Private Tenant B Dress',
    });
    expect(bySearch.items).toEqual([]);

    const byForeignCategory = await getCatalogueClothingList(contextA, {
      limit: 20,
      sort: 'name_asc',
      category_id: seededB.categoryId as never,
    });
    expect(byForeignCategory.items).toEqual([]);
  });

  it('returns archived detail with distinct variants and every serialized asset without flattening overrides', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt011_detail' });
    const seeded = await seedDetailedCatalogue(tenant.id, 'user_clt011_detail');
    const context = catalogueContext(tenant.id, seeded.branchId, 'user_clt011_detail');

    const archived = await getCatalogueClothingDetail(context, seeded.archivedProductId);
    expect(archived.status).toBe('archived');
    expect(archived.category?.name).toBe('Gowns');
    expect(archived.variants).toHaveLength(2);

    const medium = archived.variants.find((variant) => variant.size_label === 'M');
    if (!medium) throw new Error('Expected M variant in clothing detail.');
    expect(medium.assets).toHaveLength(2);
    expect(new Set(medium.assets.map((asset) => asset.id)).size).toBe(2);
    expect(medium.assets.some((asset) => asset.measurement_overrides?.waist === 71)).toBe(true);
    expect(medium.assets.some((asset) => asset.alteration_note === 'Waist taken in')).toBe(true);

    const small = archived.variants.find((variant) => variant.size_label === 'S');
    if (!small) throw new Error('Expected S variant in clothing detail.');
    expect(small.assets).toHaveLength(1);
    expect(small.measurement_mode).toBe('custom');
    expect(small.measurements).toMatchObject({ bust: 84, waist: 66 });
    expect(archived.upcoming_allocations).toHaveLength(10);
    expect(archived.has_more_upcoming_allocations).toBe(true);
    expect(archived.upcoming_allocations.every((allocation) => allocation.kind === 'maintenance')).toBe(true);
    expect(archived.upcoming_allocations.every((allocation) => allocation.reservation_line_id === null)).toBe(true);

    const active = await getCatalogueClothingDetail(context, seeded.activeProductId);
    expect(active.status).toBe('active');
    expect(active.variants).toHaveLength(1);
  });

  it('conceals a foreign clothing id while retaining an inactive category on authorized historical detail', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_clt011_foreign_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_clt011_foreign_b' });
    const seededA = await seedDetailedCatalogue(tenantA.id, 'user_clt011_foreign_a');
    const seededB = await seedSimpleCatalogue(tenantB.id, 'user_clt011_foreign_b', {
      productName: 'Tenant B Secret',
      code: 'B-SECRET',
      categoryName: 'Secret Category',
    });
    const contextA = catalogueContext(tenantA.id, seededA.branchId, 'user_clt011_foreign_a');

    const ownArchived = await getCatalogueClothingDetail(contextA, seededA.archivedProductId);
    expect(ownArchived.category?.name).toBe('Gowns');

    await expect(
      getCatalogueClothingDetail(contextA, seededB.productId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns tenant-scoped categories in stable display order with explicit active/inactive state', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_clt012_categories_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_clt012_categories_b' });
    const branchA = await seedBranch(tenantA.id, 'user_clt012_categories_a');
    await seedBranch(tenantB.id, 'user_clt012_categories_b');

    await withTenantTransaction(tenantA.id, 'user_clt012_categories_a', async (client) => {
      await client.query(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES
           ($1, 'Formal Wear', 'inactive', 60),
           ($1, 'Dresses', 'active', 20),
           ($1, 'Barong', 'active', 20),
           ($1, 'Gowns', 'active', 10)`,
        [tenantA.id],
      );
    });
    await withTenantTransaction(tenantB.id, 'user_clt012_categories_b', async (client) => {
      await client.query(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Tenant B Only', 'active', 1)`,
        [tenantB.id],
      );
    });

    const categories = await getCatalogueCategories(
      catalogueContext(tenantA.id, branchA, 'user_clt012_categories_a'),
    );
    expect(categories.items.map((category) => `${category.name}:${category.status}`)).toEqual([
      'Gowns:active',
      'Barong:active',
      'Dresses:active',
      'Formal Wear:inactive',
    ]);
    expect(categories.items.some((category) => category.name === 'Tenant B Only')).toBe(false);
  });

  function catalogueContext(tenantId: string, branchId: string, principalId: string) {
    return {
      tenantId,
      branchId,
      membershipId: '00000000-0000-4000-8000-0000000000aa',
      principalId,
      permissionCodes: ['assets.manage'] as PermissionCode[],
      effectiveTenantStatus: 'active' as const,
    };
  }

  async function seedBranch(tenantId: string, principalId: string): Promise<string> {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      );
      return requireRow(result.rows, 'branch').id;
    });
  }

  async function seedLargeCatalogue(
    tenantId: string,
    principalId: string,
  ): Promise<{ branchId: string; gownsCategoryId: string; costumesCategoryId: string }> {
    const branchId = await seedBranch(tenantId, principalId);
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const categories = await client.query<{ id: string; name: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10), ($1, 'Costumes', 'active', 20)
         RETURNING id, name`,
        [tenantId],
      );
      const gownsCategoryId = requireNamedRow(categories.rows, 'Gowns').id;
      const costumesCategoryId = requireNamedRow(categories.rows, 'Costumes').id;

      await client.query(
        `INSERT INTO product
           (tenant_id, category_id, code, name, description, status, created_at, updated_at)
         SELECT
           $1,
           CASE WHEN n > 100 THEN $3::uuid ELSE $2::uuid END,
           'LOOK-' || lpad(n::text, 3, '0'),
           'Rental Look ' || lpad(n::text, 3, '0'),
           'Seeded Phase 1 catalogue item',
           CASE WHEN n = 120 THEN 'archived' ELSE 'active' END,
           timestamptz '2026-01-01 00:00:00+00' + (n * interval '1 minute'),
           timestamptz '2026-01-01 00:00:00+00' + (n * interval '1 minute')
         FROM generate_series(1, 120) AS n`,
        [tenantId, gownsCategoryId, costumesCategoryId],
      );

      await client.query(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements,
            measurement_unit, measurement_mode, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, extra_day_price_minor,
            prep_minutes, turnaround_minutes, status)
         SELECT
           $1,
           p.id,
           'SKU-' || p.code,
           CASE WHEN p.code >= 'LOOK-101' THEN 'L' ELSE 'M' END,
           'Black',
           '{}'::jsonb,
           'cm',
           'none',
           10000 + substring(p.code from 6)::int,
           5000,
           'PHP',
           'daily',
           1440,
           10000,
           0,
           1440,
           p.status
         FROM product p
         WHERE p.tenant_id = $1`,
        [tenantId],
      );

      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         SELECT
           $1,
           $2,
           pv.id,
           'AST-' || pv.sku,
           'active',
           CASE WHEN p.code BETWEEN 'LOOK-001' AND 'LOOK-005' THEN 'needs_cleaning' ELSE 'ready' END,
           'at_branch'
         FROM product_variant pv
         JOIN product p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
         WHERE pv.tenant_id = $1`,
        [tenantId, branchId],
      );

      return { branchId, gownsCategoryId, costumesCategoryId };
    });
  }

  async function seedSimpleCatalogue(
    tenantId: string,
    principalId: string,
    input: { productName: string; code: string; categoryName: string },
  ): Promise<{ branchId: string; categoryId: string; productId: string }> {
    const branchId = await seedBranch(tenantId, principalId);
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, $2, 'active', 10)
         RETURNING id`,
        [tenantId, input.categoryName],
      );
      const categoryId = requireRow(category.rows, 'category').id;
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, $3, $4, '', 'active')
         RETURNING id`,
        [tenantId, categoryId, input.code, input.productName],
      );
      const productId = requireRow(product.rows, 'product').id;
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements,
            measurement_unit, measurement_mode, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, status)
         VALUES ($1, $2, $3, 'M', 'Black', '{}'::jsonb, 'cm', 'none', 10000, 5000,
                 'PHP', 'daily', 1440, 'active')
         RETURNING id`,
        [tenantId, productId, `SKU-${input.code}`],
      );
      const variantId = requireRow(variant.rows, 'variant').id;
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, $4, 'active', 'ready', 'at_branch')`,
        [tenantId, branchId, variantId, `AST-${input.code}`],
      );
      return { branchId, categoryId, productId };
    });
  }

  async function seedDetailedCatalogue(
    tenantId: string,
    principalId: string,
  ): Promise<{ branchId: string; archivedProductId: string; activeProductId: string }> {
    const branchId = await seedBranch(tenantId, principalId);
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'inactive', 10)
         RETURNING id`,
        [tenantId],
      );
      const categoryId = requireRow(category.rows, 'detail category').id;

      const archivedProduct = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, 'ARCH-001', 'Archived Emerald Gown', 'Historical style', 'archived')
         RETURNING id`,
        [tenantId, categoryId],
      );
      const archivedProductId = requireRow(archivedProduct.rows, 'archived product').id;

      const activeProduct = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, 'ACT-001', 'Active Emerald Gown', 'Current style', 'active')
         RETURNING id`,
        [tenantId, categoryId],
      );
      const activeProductId = requireRow(activeProduct.rows, 'active product').id;

      const mediumVariant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements,
            measurement_unit, measurement_mode, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, extra_day_price_minor,
            prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'ARCH-M', 'M', 'Emerald', '{}'::jsonb, 'cm', 'none',
                 150000, 50000, 'PHP', 'daily', 1440, 150000, 60, 1440, 'archived')
         RETURNING id`,
        [tenantId, archivedProductId],
      );
      const mediumVariantId = requireRow(mediumVariant.rows, 'M variant').id;

      const smallVariant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements,
            measurement_unit, measurement_mode, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, extra_day_price_minor,
            prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'ARCH-S', 'S', 'Emerald', '{"bust":84,"waist":66}'::jsonb,
                 'cm', 'custom', 140000, 50000, 'PHP', 'daily', 1440, 140000, 60, 1440, 'archived')
         RETURNING id`,
        [tenantId, archivedProductId],
      );
      const smallVariantId = requireRow(smallVariant.rows, 'S variant').id;

      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind,
            measurement_overrides, alteration_note)
         VALUES
           ($1, $2, $3, 'ARCH-M-A1', 'active', 'ready', 'at_branch', '{"waist":71}'::jsonb, 'Waist taken in'),
           ($1, $2, $3, 'ARCH-M-A2', 'active', 'needs_cleaning', 'at_branch', NULL, NULL),
           ($1, $2, $4, 'ARCH-S-A1', 'retired', 'unready', 'at_branch', NULL, 'Retired after repair')`,
        [tenantId, branchId, mediumVariantId, smallVariantId],
      );
      const allocationAsset = await client.query<{ id: string }>(
        `SELECT id
           FROM physical_asset
          WHERE tenant_id = $1 AND branch_id = $2 AND asset_code = 'ARCH-M-A1'
          LIMIT 1`,
        [tenantId, branchId],
      );
      const allocationAssetId = requireRow(allocationAsset.rows, 'allocation asset').id;
      await client.query(
        `WITH inserted_work AS (
           INSERT INTO maintenance_work_order
             (tenant_id, branch_id, asset_id, kind, status, reason, opened_at)
           SELECT
             $1,
             $2,
             $3,
             'cleaning',
             'open',
             'Future cleaning window ' || n,
             now() + (n * interval '2 days')
           FROM generate_series(1, 11) AS n
           RETURNING id, opened_at
         )
         INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, maintenance_id, kind, period, is_blocking)
         SELECT
           $1,
           $2,
           $3,
           id,
           'maintenance',
           tstzrange(opened_at, opened_at + interval '1 day', '[)'),
           true
         FROM inserted_work`,
        [tenantId, branchId, allocationAssetId],
      );

      const activeVariant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements,
            measurement_unit, measurement_mode, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, status)
         VALUES ($1, $2, 'ACT-M', 'M', 'Emerald', '{}'::jsonb, 'cm', 'none',
                 160000, 50000, 'PHP', 'daily', 1440, 'active')
         RETURNING id`,
        [tenantId, activeProductId],
      );
      const activeVariantId = requireRow(activeVariant.rows, 'active variant').id;
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'ACT-M-A1', 'active', 'ready', 'at_branch')`,
        [tenantId, branchId, activeVariantId],
      );

      return { branchId, archivedProductId, activeProductId };
    });
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} insert to return one row.`);
    return row;
  }

  function requireNamedRow<T extends { name: string }>(rows: T[], name: string): T {
    const row = rows.find((candidate) => candidate.name === name);
    if (!row) throw new Error(`Expected category ${name} to be returned.`);
    return row;
  }

  function requireNamedStorageFile<T extends { storage_key: string }>(rows: T[], storageKey: string): T {
    const row = rows.find((candidate) => candidate.storage_key === storageKey);
    if (!row) throw new Error(`Expected storage file ${storageKey} to be returned.`);
    return row;
  }
});
