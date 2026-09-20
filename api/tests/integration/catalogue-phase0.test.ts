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
