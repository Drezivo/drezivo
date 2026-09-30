import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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

describe('CLT-002 catalogue integrity', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { updateCatalogueCategoryStatus } = await import('../../src/modules/catalogue/catalogue.service.js');
  const { publicStorefrontService } = await import('../../src/modules/storefront/storefront.service.js');
  const { catalogueQuery } = await import('@drezivo/contracts');
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

  it('enforces case-insensitive tenant-local category and product codes', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt002_names' });

    await withTenantTransaction(tenant.id, 'user_clt002_names', async (client) => {
      await client.query(
        `INSERT INTO category (tenant_id, name, display_order)
         VALUES ($1, 'Gowns', 0)`,
        [tenant.id],
      );

      await expect(
        client.query(
          `INSERT INTO category (tenant_id, name, display_order)
           VALUES ($1, ' gowns ', 1)`,
          [tenant.id],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    await withTenantTransaction(tenant.id, 'user_clt002_codes', async (client) => {
      await client.query(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, 'GWN-001', 'Emerald Gown', 'active')`,
        [tenant.id],
      );

      await expect(
        client.query(
          `INSERT INTO product (tenant_id, code, name, status)
           VALUES ($1, 'gwn-001', 'Another Gown', 'active')`,
          [tenant.id],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('rejects same-tenant relationship mismatches for category and variant parents', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_clt002_tenant_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_clt002_tenant_b' });

    const foreignCategoryId = await withTenantTransaction(
      tenantB.id,
      'user_clt002_tenant_b',
      async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO category (tenant_id, name)
           VALUES ($1, 'Foreign Gowns')
           RETURNING id`,
          [tenantB.id],
        );
        return requireRow(result.rows, 'foreign category').id;
      },
    );

    await withTenantTransaction(tenantA.id, 'user_clt002_tenant_a', async (client) => {
      await expect(
        client.query(
          `INSERT INTO product (tenant_id, category_id, code, name, status)
           VALUES ($1, $2, 'GWN-FOREIGN', 'Invalid Gown', 'active')`,
          [tenantA.id, foreignCategoryId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    const foreignProductId = await withTenantTransaction(
      tenantB.id,
      'user_clt002_tenant_b_product',
      async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id, code, name, status)
           VALUES ($1, 'GWN-B', 'Tenant B Gown', 'active')
           RETURNING id`,
          [tenantB.id],
        );
        return requireRow(result.rows, 'foreign product').id;
      },
    );

    await withTenantTransaction(tenantA.id, 'user_clt002_tenant_a_variant', async (client) => {
      await expect(
        client.query(
          `INSERT INTO product_variant
             (tenant_id, product_id, sku, size_label, color_label, rental_price_minor,
              security_deposit_minor, pricing_mode, included_duration_minutes, status)
           VALUES ($1, $2, 'SKU-FOREIGN', 'M', 'Green', 10000, 0, 'daily', 1440, 'active')`,
          [tenantA.id, foreignProductId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  it('enforces serialized SKU and asset-code identity case-insensitively', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt002_serialized_ids' });
    const seeded = await seedCatalogueGraph(tenant.id, 'user_clt002_serialized_ids');

    await withTenantTransaction(tenant.id, 'user_clt002_serialized_sku', async (client) => {
      await expect(
        client.query(
          `INSERT INTO product_variant
             (tenant_id, product_id, sku, size_label, color_label, rental_price_minor,
              security_deposit_minor, pricing_mode, included_duration_minutes, status)
           VALUES ($1, $2, $3, 'L', 'Green', 10000, 0, 'daily', 1440, 'active')`,
          [tenant.id, seeded.productId, seeded.sku.toLowerCase()],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    await withTenantTransaction(tenant.id, 'user_clt002_serialized_asset', async (client) => {
      await expect(
        client.query(
          `INSERT INTO physical_asset
             (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
           VALUES ($1, $2, $3, $4, 'active', 'ready', 'at_branch')`,
          [tenant.id, seeded.branchId, seeded.variantId, seeded.assetCode.toLowerCase()],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('rejects a physical asset whose branch or variant belongs to another tenant', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_clt002_asset_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_clt002_asset_b' });
    const graphA = await seedCatalogueGraph(tenantA.id, 'user_clt002_asset_a');
    const graphB = await seedCatalogueGraph(tenantB.id, 'user_clt002_asset_b');

    await withTenantTransaction(tenantA.id, 'user_clt002_asset_bad_branch', async (client) => {
      await expect(
        client.query(
          `INSERT INTO physical_asset
             (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
           VALUES ($1, $2, $3, 'BAD-BRANCH', 'active', 'ready', 'at_branch')`,
          [tenantA.id, graphB.branchId, graphA.variantId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    await withTenantTransaction(tenantA.id, 'user_clt002_asset_bad_variant', async (client) => {
      await expect(
        client.query(
          `INSERT INTO physical_asset
             (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
           VALUES ($1, $2, $3, 'BAD-VARIANT', 'active', 'ready', 'at_branch')`,
          [tenantA.id, graphA.branchId, graphB.variantId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  it('toggles category visibility through an idempotent active/inactive command', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt002_category_toggle' });
    const principalId = 'user_clt002_category_toggle';
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    const categoryId = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Costumes', 'active', 50)
         RETURNING id`,
        [tenant.id],
      );
      return requireRow(result.rows, 'toggle category').id;
    });

    const input = {
      tenantId: tenant.id,
      branchId: '00000000-0000-4000-8000-000000000099',
      membershipId,
      principalId,
      permissionCodes: ['assets.manage'] as const,
      effectiveTenantStatus: 'active' as const,
      requestId: 'req-clt002-category-toggle',
      idempotencyKey: 'category-toggle-001',
      categoryId,
      request: { status: 'inactive' as const },
    };

    const results = await Promise.all([
      updateCatalogueCategoryStatus({ ...input, permissionCodes: [...input.permissionCodes] }),
      updateCatalogueCategoryStatus({ ...input, permissionCodes: [...input.permissionCodes] }),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(results.every((result) => result.body.success && result.body.data.status === 'inactive')).toBe(true);

    const state = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const category = await client.query<{ status: string }>(
        'SELECT status FROM category WHERE id = $1 AND tenant_id = $2',
        [categoryId, tenant.id],
      );
      const audits = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM audit_event
          WHERE entity_type = 'category' AND entity_id = $1
            AND action = 'catalogue.category.status_updated'`,
        [categoryId],
      );
      const idempotency = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM idempotency_record
          WHERE operation = 'catalogue.category.status.update'
            AND intent_key = 'category-toggle-001'`,
      );
      return {
        status: category.rows[0]?.status,
        auditCount: audits.rows[0]?.count ?? -1,
        idempotencyCount: idempotency.rows[0]?.count ?? -1,
      };
    });
    expect(state).toEqual({ status: 'inactive', auditCount: 1, idempotencyCount: 1 });

    await expect(
      updateCatalogueCategoryStatus({
        ...input,
        permissionCodes: [...input.permissionCodes],
        requestId: 'req-clt002-category-toggle-reused',
        request: { status: 'active' },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('conceals a foreign category during a category-status mutation', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_clt002_category_foreign_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_clt002_category_foreign_b' });
    const principalB = 'user_clt002_category_foreign_b';
    const membershipB = await createTestMembership(tenantB.id, principalB, 'owner');
    const categoryA = await withTenantTransaction(
      tenantA.id,
      'user_clt002_category_foreign_a',
      async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO category (tenant_id, name, status, display_order)
           VALUES ($1, 'Gowns', 'active', 10)
           RETURNING id`,
          [tenantA.id],
        );
        return requireRow(result.rows, 'foreign toggle category').id;
      },
    );

    const result = await updateCatalogueCategoryStatus({
      tenantId: tenantB.id,
      branchId: '00000000-0000-4000-8000-000000000098',
      membershipId: membershipB,
      principalId: principalB,
      permissionCodes: ['assets.manage'],
      effectiveTenantStatus: 'active',
      requestId: 'req-clt002-category-foreign',
      idempotencyKey: 'category-toggle-foreign-001',
      categoryId: categoryA,
      request: { status: 'inactive' },
    });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('excludes products in inactive categories from the public storefront', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt002_public_category_status' });
    const principalId = 'user_clt002_public_category_status';
    const slug = 'public-category-status-shop';

    await withTenantTransaction(tenant.id, principalId, async (client) => {
      const branchResult = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila')
         RETURNING id`,
        [tenant.id],
      );
      const branchId = requireRow(branchResult.rows, 'public storefront branch').id;

      const categoryResult = await client.query<{ id: string; status: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES
           ($1, 'Gowns', 'active', 10),
           ($1, 'Costumes', 'inactive', 50)
         RETURNING id, status`,
        [tenant.id],
      );
      const activeCategory = categoryResult.rows.find((row) => row.status === 'active');
      const inactiveCategory = categoryResult.rows.find((row) => row.status === 'inactive');
      if (!activeCategory || !inactiveCategory) {
        throw new Error('Expected active and inactive storefront categories');
      }

      const activeProduct = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, category_id, code, name, status)
         VALUES ($1, $2, 'GWN-PUBLIC', 'Public Gown', 'active')
         RETURNING id`,
        [tenant.id, activeCategory.id],
      );
      const hiddenProduct = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, category_id, code, name, status)
         VALUES ($1, $2, 'CST-HIDDEN', 'Hidden Costume', 'active')
         RETURNING id`,
        [tenant.id, inactiveCategory.id],
      );
      const activeProductId = requireRow(activeProduct.rows, 'active public product').id;
      const hiddenProductId = requireRow(hiddenProduct.rows, 'inactive-category product').id;

      await client.query(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, rental_price_minor,
            security_deposit_minor, pricing_mode, included_duration_minutes, status)
         VALUES
           ($1, $2, 'GWN-PUBLIC-M', 'M', 'Green', 10000, 0, 'daily', 1440, 'active'),
           ($1, $3, 'CST-HIDDEN-M', 'M', 'Black', 10000, 0, 'daily', 1440, 'active')`,
        [tenant.id, activeProductId, hiddenProductId],
      );

      // A published storefront is online only while its subscription grants access (billing/access.ts).
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         SELECT $1, id, 'active', now(), now() + interval '30 days'
           FROM plan WHERE code = 'starter' AND version = 1 AND active = true`,
        [tenant.id],
      );
      const storefrontResult = await client.query<{ id: string }>(
        `INSERT INTO storefront
           (tenant_id, branch_id, slug, status, branding, contact, published_at)
         VALUES ($1, $2, $3, 'published', '{}'::jsonb, '{}'::jsonb, now())
         RETURNING id`,
        [tenant.id, branchId, slug],
      );
      const storefrontId = requireRow(storefrontResult.rows, 'published storefront').id;
      await client.query(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules,
            cancellation_rules, delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 'Test privacy notice', now())`,
        [tenant.id, storefrontId],
      );
      const qrFile = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'storefront_asset', $2, 'version-payment-qr', 'image/png', 512, 'accepted', true,
                 now() + interval '10 minutes', now())
         RETURNING id`,
        [tenant.id, `tenant-files/${tenant.id}/payment-qr/source`],
      );
      const qrFileId = requireRow(qrFile.rows, 'payment QR file').id;
      await client.query(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, qr_file_id, active, storefront_enabled, version)
         VALUES
           ($1, 'Cash', 'cash', '{}'::jsonb, NULL, true, false, 1),
           ($1, 'Unconfigured QR', 'manual_qr', '{}'::jsonb, NULL, true, true, 1),
           ($1, 'GCash', 'manual_qr', '{}'::jsonb, $2, true, true, 1)`,
        [tenant.id, qrFileId],
      );
    });

    const catalogue = await publicStorefrontService.getCatalogue(slug, catalogueQuery.parse({}));
    expect(catalogue.items.map((item) => item.name)).toEqual(['Public Gown']);
    const publicStorefront = await publicStorefrontService.getStorefront(slug);
    expect(publicStorefront.payment_methods.map(({ name, rail }) => ({ name, rail }))).toEqual([{ name: 'GCash', rail: 'manual_qr' }]);
  });

  it('keeps catalogue reads and writes isolated by forced RLS for drezivo_app', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_clt002_rls_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_clt002_rls_b' });
    const graphA = await seedCatalogueGraph(tenantA.id, 'user_clt002_rls_a');

    const rowsFromTenantB = await withTenantTransaction(
      tenantB.id,
      'user_clt002_rls_b',
      async (client) => {
        const result = await client.query<{ id: string }>(
          'SELECT id FROM product WHERE id = $1',
          [graphA.productId],
        );
        return result.rows;
      },
    );
    expect(rowsFromTenantB).toEqual([]);

    await withTenantTransaction(tenantB.id, 'user_clt002_rls_b_write', async (client) => {
      await expect(
        client.query(
          `INSERT INTO category (tenant_id, name)
           VALUES ($1, 'Cross tenant write')`,
          [tenantA.id],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`Expected ${label} insert to return one row`);
    }
    return row;
  }

  async function seedCatalogueGraph(
    tenantId: string,
    principalId: string,
  ): Promise<{
    branchId: string;
    productId: string;
    variantId: string;
    sku: string;
    assetCode: string;
  }> {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const branchResult = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      );
      const branchId = requireRow(branchResult.rows, 'branch').id;

      const productResult = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, 'GWN-SEED', 'Seed Gown', 'active')
         RETURNING id`,
        [tenantId],
      );
      const productId = requireRow(productResult.rows, 'product').id;
      const sku = 'GWN-SEED-M-GREEN';
      const variantResult = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, rental_price_minor,
            security_deposit_minor, pricing_mode, included_duration_minutes, status)
         VALUES ($1, $2, $3, 'M', 'Green', 10000, 0, 'daily', 1440, 'active')
         RETURNING id`,
        [tenantId, productId, sku],
      );
      const variantId = requireRow(variantResult.rows, 'variant').id;
      const assetCode = 'GWN-SEED-A1';
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, $4, 'active', 'ready', 'at_branch')`,
        [tenantId, branchId, variantId, assetCode],
      );

      return { branchId, productId, variantId, sku, assetCode };
    });
  }
});
