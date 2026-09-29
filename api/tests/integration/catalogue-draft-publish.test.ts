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
process.env.OBJECT_STORAGE_REGION ??= 'test';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE ??= 'private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC ??= 'public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ??= 'test';

describe('CLT-072 draft clothing publish', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { getCatalogueClothingList, publishClothing } = await import(
    '../../src/modules/catalogue/catalogue.service.js'
  );
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

  it('publishes a valid draft, activates an eligible variant, and replays idempotently', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt072_publish' });
    const seeded = await seedDraft(tenant.id, 'user_clt072_publish', { withImage: true, withAsset: true });
    const context = commandContext(tenant.id, seeded.branchId, 'user_clt072_publish');

    const first = await publishClothing({
      ...context,
      requestId: 'req-clt072-publish',
      idempotencyKey: 'testtest66',
      productId: seeded.productId,
      request: { expected_updated_at: seeded.updatedAt },
    });
    const replay = await publishClothing({
      ...context,
      requestId: 'req-clt072-publish-replay',
      idempotencyKey: 'testtest66',
      productId: seeded.productId,
      request: { expected_updated_at: seeded.updatedAt },
    });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      success: true,
      data: {
        product_id: seeded.productId,
        status: 'active',
        activated_variant_count: 1,
      },
    });

    const state = await withTenantTransaction(tenant.id, context.principalId, async (client) => {
      const product = await client.query<{ status: string }>(
        'SELECT status FROM product WHERE tenant_id = $1 AND id = $2',
        [tenant.id, seeded.productId],
      );
      const variant = await client.query<{ status: string }>(
        'SELECT status FROM product_variant WHERE tenant_id = $1 AND id = $2',
        [tenant.id, seeded.variantId],
      );
      return { product: product.rows[0]?.status, variant: variant.rows[0]?.status };
    });
    expect(state).toEqual({ product: 'active', variant: 'active' });

    const activeList = await getCatalogueClothingList(context, {
      limit: 20,
      sort: 'name_asc',
      product_status: 'active',
    });
    expect(activeList.items.map((item) => item.product_id)).toContain(seeded.productId);
  });

  it('keeps a draft unchanged when it has no accepted catalogue image', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt072_no_image' });
    const seeded = await seedDraft(tenant.id, 'user_clt072_no_image', { withImage: false, withAsset: true });
    const context = commandContext(tenant.id, seeded.branchId, 'user_clt072_no_image');

    const result = await publishClothing({
      ...context,
      requestId: 'req-clt072-no-image',
      idempotencyKey: 'clt072-no-image',
      productId: seeded.productId,
      request: { expected_updated_at: seeded.updatedAt },
    });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ success: false });
    const status = await withTenantTransaction(tenant.id, context.principalId, async (client) => {
      const product = await client.query<{ status: string }>(
        'SELECT status FROM product WHERE tenant_id = $1 AND id = $2',
        [tenant.id, seeded.productId],
      );
      return product.rows[0]?.status;
    });
    expect(status).toBe('draft');
  });

  it('keeps a draft unchanged when no variant has an active physical piece', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt072_no_piece' });
    const seeded = await seedDraft(tenant.id, 'user_clt072_no_piece', { withImage: true, withAsset: false });
    const context = commandContext(tenant.id, seeded.branchId, 'user_clt072_no_piece');

    const result = await publishClothing({
      ...context,
      requestId: 'req-clt072-no-piece',
      idempotencyKey: 'testtest77',
      productId: seeded.productId,
      request: { expected_updated_at: seeded.updatedAt },
    });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ success: false });
    const status = await withTenantTransaction(tenant.id, context.principalId, async (client) => {
      const product = await client.query<{ status: string }>(
        'SELECT status FROM product WHERE tenant_id = $1 AND id = $2',
        [tenant.id, seeded.productId],
      );
      return product.rows[0]?.status;
    });
    expect(status).toBe('draft');
  });

  it('rejects a stale publish token without activating the draft', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt072_stale' });
    const seeded = await seedDraft(tenant.id, 'user_clt072_stale', { withImage: true, withAsset: true });
    const context = commandContext(tenant.id, seeded.branchId, 'user_clt072_stale');

    await withTenantTransaction(tenant.id, context.principalId, async (client) => {
      await client.query(
        `UPDATE product
            SET updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
          WHERE tenant_id = $1 AND id = $2`,
        [tenant.id, seeded.productId],
      );
    });

    const result = await publishClothing({
      ...context,
      requestId: 'req-clt072-stale',
      idempotencyKey: 'clt072-stale',
      productId: seeded.productId,
      request: { expected_updated_at: seeded.updatedAt },
    });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ success: false, error: { code: 'STALE_VERSION' } });
  });

  async function seedDraft(
    tenantId: string,
    principalId: string,
    options: { withImage: boolean; withAsset: boolean },
  ) {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active')
         RETURNING id`,
        [tenantId],
      );
      const branchId = branch.rows[0]?.id;
      if (!branchId) throw new Error('Expected test tenant branch.');

      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10)
         RETURNING id`,
        [tenantId],
      );
      const categoryId = category.rows[0]?.id;
      if (!categoryId) throw new Error('Expected category.');

      const product = await client.query<{ id: string; updated_at: Date }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, 'CLT072-GOWN', 'Draft Evening Gown', 'Ready to publish', 'draft')
         RETURNING id, updated_at`,
        [tenantId, categoryId],
      );
      const productRow = product.rows[0];
      if (!productRow) throw new Error('Expected product.');

      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
            measurement_mode, rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'CLT072-GOWN-M', 'M', 'Emerald', '{}'::jsonb, 'cm', 'none',
                 150000, 50000, 'PHP', 'daily', 1440, 150000, 0, 1440, 'draft')
         RETURNING id`,
        [tenantId, productRow.id],
      );
      const variantId = variant.rows[0]?.id;
      if (!variantId) throw new Error('Expected variant.');

      if (options.withAsset) {
        await client.query(
          `INSERT INTO physical_asset
             (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind,
              measurement_overrides, version)
           VALUES ($1, $2, $3, 'CLT072-AST-001', 'active', 'ready', 'at_branch', '{}'::jsonb, 1)`,
          [tenantId, branchId, variantId],
        );
      }

      if (options.withImage) {
        const file = await client.query<{ id: string }>(
          `INSERT INTO file_object
             (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
              lifecycle_status, is_private, upload_expires_at, frozen_at)
           VALUES ($1, 'catalogue_image', 'catalogue/clt072-cover.webp', 'v1', 'clt072-sha',
                   'image/webp', 512, 'accepted', true, now() + interval '10 minutes', now())
           RETURNING id`,
          [tenantId],
        );
        const fileId = file.rows[0]?.id;
        if (!fileId) throw new Error('Expected image file.');
        await client.query(
          `INSERT INTO product_image (tenant_id, product_id, file_id, display_order)
           VALUES ($1, $2, $3, 0)`,
          [tenantId, productRow.id, fileId],
        );
      }

      return {
        branchId,
        productId: productRow.id,
        variantId,
        updatedAt: productRow.updated_at.toISOString(),
      };
    });
  }
});

function commandContext(tenantId: string, branchId: string, principalId: string) {
  return {
    tenantId,
    branchId,
    membershipId: '00000000-0000-4000-8000-0000000000aa',
    principalId,
    permissionCodes: ['assets.manage'] as PermissionCode[],
    effectiveTenantStatus: 'active' as const,
  };
}
