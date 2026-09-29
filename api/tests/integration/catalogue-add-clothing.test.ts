import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  createClothingRequest,
  fileObjectId,
  measurementGuideId,
  type CreateClothingRequest,
  type FileObjectId,
  type MeasurementGuideId,
  type PermissionCode,
} from '@drezivo/contracts';

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
process.env.OBJECT_STORAGE_REGION ??= 'test';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE ??= 'private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC ??= 'public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ??= 'test';

describe('CLT-020 Add Clothing transactional service', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { createClothing } = await import('../../src/modules/catalogue/catalogue.service.js');
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

  it('creates one product, one variant and one active physical asset per selected size atomically', async () => {
    const seed = await seedCommandTenant('org_clt020_atomic', 'user_clt020_atomic');
    const guideId = await seedMeasurementGuide(seed.tenantId, 'user_clt020_atomic', {
      name: 'Guide A',
      isDefault: true,
    });
    const imageId = await seedAcceptedImage(seed.tenantId, 'user_clt020_atomic', 'atomic');
    const request = makeRequest(seed.categoryId, {
      code: 'EMERALD-001',
      color_label: null,
      image_file_ids: [imageId],
      sizes: [
        {
          size_label: 'M',
          measurement_mode: 'default_guide',
          measurement_guide_id: guideId,
          measurement_unit: 'cm',
          measurements: {},
        },
        {
          size_label: 'L',
          measurement_mode: 'custom',
          measurement_unit: 'cm',
          measurements: { bust: 94, waist: 76 },
        },
      ],
      pricing: {
        mode: 'fixed_duration',
        rental_price_minor: '150000',
        security_deposit_minor: '50000',
        extra_day_price_minor: '30000',
        included_days: 3,
        prep_minutes: 0,
        turnaround_minutes: 1440,
      },
      activate: true,
    });

    const response = await createClothing({
      ...seed.context,
      requestId: 'req-clt020-atomic',
      idempotencyKey: 'clt020-atomic-1',
      request,
    });

    expect(response.status).toBe(201);
    if (!response.body.success) throw new Error('Expected successful clothing create response.');
    expect(response.body.data).toMatchObject({
      code: 'EMERALD-001',
      variant_count: 2,
      physical_piece_count: 2,
      status: 'active',
    });

    const state = await readCreatedGraph(seed.tenantId, 'user_clt020_atomic', 'EMERALD-001');
    expect(state.productCount).toBe(1);
    expect(state.variants).toHaveLength(2);
    expect(state.assets).toHaveLength(2);
    expect(state.assets.every((asset) => asset.lifecycle_status === 'active')).toBe(true);
    expect(new Set(state.assets.map((asset) => asset.variant_id)).size).toBe(2);
    expect(state.auditCount).toBe(1);
    expect(state.idempotencyCount).toBe(1);

    const medium = state.variants.find((variant) => variant.size_label === 'M');
    const large = state.variants.find((variant) => variant.size_label === 'L');
    expect(medium).toMatchObject({
      color_label: null,
      measurement_mode: 'default_guide',
      measurement_guide_id: guideId,
      rental_price_minor: 150000,
      security_deposit_minor: 50000,
      extra_day_price_minor: 30000,
      included_duration_minutes: 4320,
      currency: 'PHP',
    });
    expect(large).toMatchObject({
      color_label: null,
      measurement_mode: 'custom',
      measurement_guide_id: null,
      measurements: { bust: 94, waist: 76 },
    });
  });

  it('replays the same intent sequentially without creating a second catalogue graph', async () => {
    const seed = await seedCommandTenant('org_clt020_sequential', 'user_clt020_sequential');
    const request = makeRequest(seed.categoryId, { code: 'SEQ-001' });
    const command = {
      ...seed.context,
      requestId: 'req-clt020-sequential',
      idempotencyKey: 'testidem01',
      request,
    };

    const first = await createClothing(command);
    const replay = await createClothing(command);

    expect(first).toEqual(replay);
    expect(first.status).toBe(201);
    const state = await readCreatedGraph(seed.tenantId, 'user_clt020_sequential', 'SEQ-001');
    expect(state.productCount).toBe(1);
    expect(state.variants).toHaveLength(1);
    expect(state.assets).toHaveLength(1);
    expect(state.auditCount).toBe(1);
    expect(state.idempotencyCount).toBe(1);
  });

  it('collapses concurrent double-fire at the quota edge into one catalogue graph and one quota claim', async () => {
    const seed = await seedCommandTenant('org_clt020_concurrent', 'user_clt020_concurrent');
    await seedQuotaAssets(seed.tenantId, seed.branchId, 'user_clt020_concurrent', 124);
    const request = makeRequest(seed.categoryId, { code: 'RACE-001' });
    const command = {
      ...seed.context,
      requestId: 'req-clt020-concurrent',
      idempotencyKey: 'clt020-concurrent-1',
      request,
    };

    const [first, second] = await Promise.all([createClothing(command), createClothing(command)]);

    expect(first.status).toBe(201);
    expect(second).toEqual(first);
    const state = await readCreatedGraph(seed.tenantId, 'user_clt020_concurrent', 'RACE-001');
    expect(state.productCount).toBe(1);
    expect(state.variants).toHaveLength(1);
    expect(state.assets).toHaveLength(1);
    expect(state.auditCount).toBe(1);
    expect(state.idempotencyCount).toBe(1);
    const totalActiveAssets = await withTenantTransaction(
      seed.tenantId,
      'user_clt020_concurrent',
      async (client) => {
        const result = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM physical_asset
            WHERE tenant_id = $1 AND lifecycle_status = 'active'`,
          [seed.tenantId],
        );
        return result.rows[0]?.count ?? -1;
      },
    );
    expect(totalActiveAssets).toBe(125);
  });

  it('validates the closed create contract inside the service before opening a write transaction', async () => {
    const seed = await seedCommandTenant('org_clt020_contract', 'user_clt020_contract');
    const valid = makeRequest(seed.categoryId, { code: 'CONTRACT-001' });
    const invalid = {
      ...valid,
      tenant_id: seed.tenantId,
    } as unknown as CreateClothingRequest;

    await expect(
      createClothing({
        ...seed.context,
        requestId: 'req-clt020-contract',
        idempotencyKey: 'clt020-contract',
        request: invalid,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const idempotencyCount = await withTenantTransaction(
      seed.tenantId,
      'user_clt020_contract',
      async (client) => {
        const result = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM idempotency_record
            WHERE tenant_id = $1 AND operation = 'catalogue.clothing.create'`,
          [seed.tenantId],
        );
        return result.rows[0]?.count ?? -1;
      },
    );
    expect(idempotencyCount).toBe(0);
  });

  it('denies a caller without the server-resolved assets.manage permission before any write', async () => {
    const seed = await seedCommandTenant('org_clt020_permission', 'user_clt020_permission');

    await expect(
      createClothing({
        ...seed.context,
        permissionCodes: [],
        requestId: 'req-clt020-permission',
        idempotencyKey: 'testidem02',
        request: makeRequest(seed.categoryId, { code: 'PERMISSION-001' }),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const productCount = await withTenantTransaction(
      seed.tenantId,
      'user_clt020_permission',
      async (client) => {
        const result = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM product WHERE tenant_id = $1`,
          [seed.tenantId],
        );
        return result.rows[0]?.count ?? -1;
      },
    );
    expect(productCount).toBe(0);
  });

  it('rejects changed payload reuse of an idempotency key without creating another product', async () => {
    const seed = await seedCommandTenant('org_clt020_reuse', 'user_clt020_reuse');
    const firstRequest = makeRequest(seed.categoryId, { code: 'REUSE-001', name: 'First Gown' });
    const changedRequest = makeRequest(seed.categoryId, { code: 'REUSE-002', name: 'Changed Gown' });

    await createClothing({
      ...seed.context,
      requestId: 'req-clt020-reuse-1',
      idempotencyKey: 'clt020-reused-key',
      request: firstRequest,
    });

    await expect(
      createClothing({
        ...seed.context,
        requestId: 'req-clt020-reuse-2',
        idempotencyKey: 'clt020-reused-key',
        request: changedRequest,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    const counts = await withTenantTransaction(seed.tenantId, 'user_clt020_reuse', async (client) => {
      const products = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM product WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      const assets = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM physical_asset WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      return {
        products: products.rows[0]?.count ?? -1,
        assets: assets.rows[0]?.count ?? -1,
      };
    });
    expect(counts).toEqual({ products: 1, assets: 1 });
  });

  it('serializes competing creates at the physical-asset plan limit', async () => {
    const seed = await seedCommandTenant('org_clt020_quota', 'user_clt020_quota');
    await seedQuotaAssets(seed.tenantId, seed.branchId, 'user_clt020_quota', 124);

    const [a, b] = await Promise.all([
      createClothing({
        ...seed.context,
        requestId: 'req-clt020-quota-a',
        idempotencyKey: 'clt020-quota-a',
        request: makeRequest(seed.categoryId, { code: 'QUOTA-A' }),
      }),
      createClothing({
        ...seed.context,
        requestId: 'req-clt020-quota-b',
        idempotencyKey: 'clt020-quota-b',
        request: makeRequest(seed.categoryId, { code: 'QUOTA-B' }),
      }),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const rejected = a.status === 409 ? a : b;
    if (rejected.body.success) throw new Error('Expected one quota failure response.');
    expect(rejected.body.error.code).toBe('CAPACITY_CONFLICT');

    const state = await withTenantTransaction(seed.tenantId, 'user_clt020_quota', async (client) => {
      const assets = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM physical_asset
          WHERE tenant_id = $1 AND lifecycle_status = 'active'`,
        [seed.tenantId],
      );
      const newProducts = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM product
          WHERE tenant_id = $1 AND code IN ('QUOTA-A', 'QUOTA-B')`,
        [seed.tenantId],
      );
      return {
        assets: assets.rows[0]?.count ?? -1,
        newProducts: newProducts.rows[0]?.count ?? -1,
      };
    });
    expect(state).toEqual({ assets: 125, newProducts: 1 });
  });

  it('keeps the exact measurement-guide reference when the tenant default later changes', async () => {
    const seed = await seedCommandTenant('org_clt020_guide', 'user_clt020_guide');
    const guideA = await seedMeasurementGuide(seed.tenantId, 'user_clt020_guide', {
      name: 'Original Default',
      isDefault: true,
    });
    const request = makeRequest(seed.categoryId, {
      code: 'GUIDE-001',
      sizes: [
        {
          size_label: 'M',
          measurement_mode: 'default_guide',
          measurement_guide_id: guideA,
          measurement_unit: 'cm',
          measurements: {},
        },
      ],
    });

    const created = await createClothing({
      ...seed.context,
      requestId: 'req-clt020-guide',
      idempotencyKey: 'clt020-guide-1',
      request,
    });
    expect(created.status).toBe(201);

    const guideB = await seedMeasurementGuide(seed.tenantId, 'user_clt020_guide', {
      name: 'Replacement Default',
      isDefault: false,
    });
    await withTenantTransaction(seed.tenantId, 'user_clt020_guide', async (client) => {
      await client.query(
        `UPDATE measurement_guide SET is_default = false, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, guideA],
      );
      await client.query(
        `UPDATE measurement_guide SET is_default = true, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, guideB],
      );
    });

    const variant = await withTenantTransaction(seed.tenantId, 'user_clt020_guide', async (client) => {
      const result = await client.query<{ measurement_guide_id: string | null }>(
        `SELECT pv.measurement_guide_id
           FROM product_variant pv
           JOIN product p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
          WHERE pv.tenant_id = $1 AND p.code = 'GUIDE-001'`,
        [seed.tenantId],
      );
      return result.rows[0];
    });
    expect(variant?.measurement_guide_id).toBe(guideA);
    expect(variant?.measurement_guide_id).not.toBe(guideB);
  });

  it('rejects inactive categories, archived guides, and out-of-range money without partial catalogue writes', async () => {
    const seed = await seedCommandTenant('org_clt020_validation', 'user_clt020_validation');
    const archivedGuide = await seedMeasurementGuide(seed.tenantId, 'user_clt020_validation', {
      name: 'Archived Guide',
      isDefault: false,
      status: 'archived',
    });

    await withTenantTransaction(seed.tenantId, 'user_clt020_validation', async (client) => {
      await client.query(`UPDATE category SET status = 'inactive' WHERE tenant_id = $1 AND id = $2`, [
        seed.tenantId,
        seed.categoryId,
      ]);
    });
    const inactiveCategory = await createClothing({
      ...seed.context,
      requestId: 'req-clt020-inactive-category',
      idempotencyKey: 'clt020-inactive-category',
      request: makeRequest(seed.categoryId, { code: 'INVALID-CAT' }),
    });
    expectFailure(inactiveCategory, 422, 'INVALID_CATEGORY');

    await withTenantTransaction(seed.tenantId, 'user_clt020_validation', async (client) => {
      await client.query(`UPDATE category SET status = 'active' WHERE tenant_id = $1 AND id = $2`, [
        seed.tenantId,
        seed.categoryId,
      ]);
    });
    const archivedGuideResult = await createClothing({
      ...seed.context,
      requestId: 'req-clt020-archived-guide',
      idempotencyKey: 'clt020-archived-guide',
      request: makeRequest(seed.categoryId, {
        code: 'INVALID-GUIDE',
        sizes: [
          {
            size_label: 'M',
            measurement_mode: 'default_guide',
            measurement_guide_id: archivedGuide,
            measurement_unit: 'cm',
            measurements: {},
          },
        ],
      }),
    });
    expectFailure(archivedGuideResult, 422, 'INVALID_MEASUREMENT_GUIDE');

    const moneyResult = await createClothing({
      ...seed.context,
      requestId: 'req-clt020-money',
      idempotencyKey: 'clt020-money',
      request: makeRequest(seed.categoryId, {
        code: 'INVALID-MONEY',
        pricing: {
          mode: 'daily',
          rental_price_minor: '2147483648',
          security_deposit_minor: '50000',
          extra_day_price_minor: '0',
          prep_minutes: 0,
          turnaround_minutes: 0,
        },
      }),
    });
    expectFailure(moneyResult, 422, 'VALIDATION_FAILED');

    const products = await withTenantTransaction(seed.tenantId, 'user_clt020_validation', async (client) => {
      const result = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM product WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      return result.rows[0]?.count ?? -1;
    });
    expect(products).toBe(0);
  });

  it('rolls the entire graph and idempotency claim back if the server-resolved branch is invalid', async () => {
    const seed = await seedCommandTenant('org_clt020_rollback', 'user_clt020_rollback');
    const foreign = await seedCommandTenant('org_clt020_rollback_foreign', 'user_clt020_foreign');

    await expect(
      createClothing({
        ...seed.context,
        branchId: foreign.branchId,
        requestId: 'req-clt020-rollback',
        idempotencyKey: 'clt020-rollback',
        request: makeRequest(seed.categoryId, { code: 'ROLLBACK-001' }),
      }),
    ).rejects.toBeTruthy();

    const state = await withTenantTransaction(seed.tenantId, 'user_clt020_rollback', async (client) => {
      const product = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM product WHERE tenant_id = $1 AND code = 'ROLLBACK-001'`,
        [seed.tenantId],
      );
      const audit = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_event WHERE tenant_id = $1 AND action LIKE 'catalogue.clothing.created_%'`,
        [seed.tenantId],
      );
      const idempotency = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM idempotency_record
          WHERE tenant_id = $1 AND operation = 'catalogue.clothing.create' AND intent_key = 'clt020-rollback'`,
        [seed.tenantId],
      );
      return {
        product: product.rows[0]?.count ?? -1,
        audit: audit.rows[0]?.count ?? -1,
        idempotency: idempotency.rows[0]?.count ?? -1,
      };
    });
    expect(state).toEqual({ product: 0, audit: 0, idempotency: 0 });
  });

  async function seedCommandTenant(clerkOrgId: string, principalId: string) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    const setup = await withTenantTransaction(tenant.id, principalId, async (client) => {
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
        [tenant.id, branchId, membershipId, JSON.stringify(['assets.manage'])],
      );
      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10)
         RETURNING id`,
        [tenant.id],
      );
      return { branchId, categoryId: requireRow(category.rows, 'category').id };
    });
    await createSubscription(tenant.id, principalId, 'starter');
    return {
      tenantId: tenant.id,
      branchId: setup.branchId,
      categoryId: setup.categoryId,
      membershipId,
      context: {
        tenantId: tenant.id,
        branchId: setup.branchId,
        membershipId,
        principalId,
        permissionCodes: ['assets.manage'] as PermissionCode[],
        effectiveTenantStatus: 'active' as const,
      },
    };
  }

  async function createSubscription(
    tenantId: string,
    principalId: string,
    code: 'starter' | 'professional' | 'business',
  ) {
    await withTenantTransaction(tenantId, principalId, async (client) => {
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = $1 AND version = 1 AND active = true`,
        [code],
      );
      const planId = requireRow(plan.rows, `${code} plan`).id;
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenantId, planId],
      );
    });
  }

  async function seedMeasurementGuide(
    tenantId: string,
    principalId: string,
    input: { name: string; isDefault: boolean; status?: 'active' | 'archived' },
  ): Promise<MeasurementGuideId> {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const file = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'measurement_guide', $2, $3, 'image/png', 256, 'accepted', true,
                 now() + interval '1 day', now())
         RETURNING id`,
        [tenantId, `test/guide/${randomUUID()}.png`, `version-${randomUUID()}`],
      );
      const fileId = requireRow(file.rows, 'guide file').id;
      const guide = await client.query<{ id: string }>(
        `INSERT INTO measurement_guide (tenant_id, file_id, name, status, is_default)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [tenantId, fileId, input.name, input.status ?? 'active', input.isDefault],
      );
      return measurementGuideId.parse(requireRow(guide.rows, 'measurement guide').id);
    });
  }

  async function seedQuotaAssets(
    tenantId: string,
    branchId: string,
    principalId: string,
    count: number,
  ): Promise<void> {
    await withTenantTransaction(tenantId, principalId, async (client) => {
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, 'QUOTA-SEED', 'Quota Seed', 'active')
         RETURNING id`,
        [tenantId],
      );
      const productId = requireRow(product.rows, 'quota product').id;
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, rental_price_minor,
            included_duration_minutes, status)
         VALUES ($1, $2, 'QUOTA-SEED-SKU', 'M', 'Black', 1000, 1440, 'active')
         RETURNING id`,
        [tenantId, productId],
      );
      const variantId = requireRow(variant.rows, 'quota variant').id;
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status)
         SELECT $1, $2, $3, 'quota-seed-' || n::text, 'active'
           FROM generate_series(1, $4::int) AS n`,
        [tenantId, branchId, variantId, count],
      );
    });
  }

  async function seedAcceptedImage(
    tenantId: string,
    principalId: string,
    label: string,
  ): Promise<FileObjectId> {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'catalogue_image', $2, $3, $4, 'image/png', 512,
                 'accepted', true, now() + interval '10 minutes', now())
         RETURNING id`,
        [
          tenantId,
          `tenant-files/${tenantId}/${label}.png`,
          `version-${label}`,
          Buffer.alloc(32, 7).toString('base64'),
        ],
      );
      return fileObjectId.parse(requireRow(result.rows, 'accepted catalogue image').id);
    });
  }

  function makeRequest(
    categoryId: string,
    overrides: Partial<Omit<CreateClothingRequest, 'category_id'>> = {},
  ): CreateClothingRequest {
    return createClothingRequest.parse({
      name: 'Emerald Evening Gown',
      code: 'GOWN-001',
      description: 'Elegant formal gown',
      category_id: categoryId,
      color_label: 'Emerald',
      image_file_ids: [],
      sizes: [{ size_label: 'M', measurement_mode: 'none' }],
      pricing: {
        mode: 'daily',
        rental_price_minor: '150000',
        security_deposit_minor: '50000',
        extra_day_price_minor: '0',
        prep_minutes: 0,
        turnaround_minutes: 1440,
      },
      activate: false,
      ...overrides,
    });
  }

  async function readCreatedGraph(tenantId: string, principalId: string, code: string) {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const product = await client.query<{ id: string }>(
        `SELECT id FROM product WHERE tenant_id = $1 AND code = $2`,
        [tenantId, code],
      );
      const productId = product.rows[0]?.id;
      const variants = productId
        ? await client.query<{
            id: string;
            size_label: string;
            color_label: string | null;
            measurement_mode: string;
            measurement_guide_id: string | null;
            measurements: Record<string, number>;
            rental_price_minor: number;
            security_deposit_minor: number;
            currency: string;
            extra_day_price_minor: number;
            included_duration_minutes: number;
          }>(
            `SELECT id, size_label, color_label, measurement_mode, measurement_guide_id, measurements,
                    rental_price_minor, security_deposit_minor, currency, extra_day_price_minor,
                    included_duration_minutes
               FROM product_variant
              WHERE tenant_id = $1 AND product_id = $2
              ORDER BY size_label ASC`,
            [tenantId, productId],
          )
        : { rows: [] };
      const assets = productId
        ? await client.query<{ variant_id: string; lifecycle_status: string }>(
            `SELECT pa.variant_id, pa.lifecycle_status
               FROM physical_asset pa
               JOIN product_variant pv ON pv.tenant_id = pa.tenant_id AND pv.id = pa.variant_id
              WHERE pa.tenant_id = $1 AND pv.product_id = $2`,
            [tenantId, productId],
          )
        : { rows: [] };
      const audit = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM audit_event
          WHERE tenant_id = $1
            AND entity_type = 'product'
            AND action LIKE 'catalogue.clothing.created_%'
            AND ($2::uuid IS NULL OR entity_id = $2::uuid)`,
        [tenantId, productId ?? null],
      );
      const idempotency = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM idempotency_record
          WHERE tenant_id = $1 AND operation = 'catalogue.clothing.create'`,
        [tenantId],
      );
      return {
        productCount: product.rows.length,
        variants: variants.rows,
        assets: assets.rows,
        auditCount: audit.rows[0]?.count ?? -1,
        idempotencyCount: idempotency.rows[0]?.count ?? -1,
      };
    });
  }

  function expectFailure(
    response: Awaited<ReturnType<typeof createClothing>>,
    status: number,
    code: string,
  ): void {
    expect(response.status).toBe(status);
    if (response.body.success) throw new Error('Expected failed clothing command.');
    expect(response.body.error.code).toBe(code);
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} insert to return one row.`);
    return row;
  }
});
