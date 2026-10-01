import { Client } from 'pg';
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

const SCALE_TEST_TIMEOUT_MS = 30_000;

describe('CLT-061 catalogue scale and query bounds', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { getCatalogueClothingList } = await import('../../src/modules/catalogue/catalogue.service.js');
  const { createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await resetTestDatabase(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('serves bounded keyset pages at the 1,000-active-asset ceiling and stays deterministic across insert/archive churn', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt061_keyset' });
    const seeded = await seedScaleCatalogue(tenant.id, 'user_clt061_keyset');
    const context = catalogueContext(tenant.id, seeded.branchId, 'user_clt061_keyset');

    const first = await getCatalogueClothingList(context, {
      limit: 50,
      sort: 'name_asc',
      product_status: 'active',
    });
    expect(first.items).toHaveLength(50);
    expect(first.page_meta.has_more).toBe(true);
    expect(first.page_meta.next_cursor).toEqual(expect.any(String));

    const firstIds = new Set(first.items.map((item) => item.product_id));
    const firstLast = first.items.at(-1);
    const cursor = first.page_meta.next_cursor;
    if (!firstLast || !cursor) throw new Error('Expected first keyset page.');

    await withTenantTransaction(tenant.id, 'user_clt061_keyset', async (client) => {
      await client.query(`UPDATE product SET status = 'archived' WHERE tenant_id = $1 AND code = 'SCALE-0075'`, [tenant.id]);
      await client.query(
        `UPDATE product_variant SET status = 'archived'
          WHERE tenant_id = $1
            AND product_id = (SELECT id FROM product WHERE tenant_id = $1 AND code = 'SCALE-0075')`,
        [tenant.id],
      );
      await client.query(
        `UPDATE physical_asset SET lifecycle_status = 'retired', readiness = 'unready'
          WHERE tenant_id = $1
            AND variant_id IN (
              SELECT pv.id FROM product_variant pv
              JOIN product p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
              WHERE p.tenant_id = $1 AND p.code = 'SCALE-0075'
            )`,
        [tenant.id],
      );

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO product
           (tenant_id, category_id, code, name, description, status, created_at, updated_at)
         VALUES ($1, $2, 'SCALE-0000', 'Scale Look 0000', 'Inserted between pages', 'active',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
         RETURNING id`,
        [tenant.id, seeded.categoryId],
      );
      const productId = requireId(inserted.rows[0]?.id, 'inserted product');
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
            measurement_mode, rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'SCALE-SKU-0000', 'M', 'Black', '{}', 'cm', 'none', 10000, 5000,
                 'PHP', 'daily', 1440, 10000, 0, 1440, 'active')
         RETURNING id`,
        [tenant.id, productId],
      );
      const variantId = requireId(variant.rows[0]?.id, 'inserted variant');
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'SCALE-ASSET-0000', 'active', 'ready', 'at_branch')`,
        [tenant.id, seeded.branchId, variantId],
      );
    });

    const second = await getCatalogueClothingList(context, {
      limit: 50,
      sort: 'name_asc',
      product_status: 'active',
      cursor,
    });
    expect(second.items).toHaveLength(50);
    expect(second.items.some((item) => firstIds.has(item.product_id))).toBe(false);
    expect(second.items.some((item) => item.code === 'SCALE-0000')).toBe(false);
    expect(second.items.some((item) => item.code === 'SCALE-0075')).toBe(false);
    const secondFirst = second.items[0];
    if (!secondFirst) throw new Error('Expected populated second page.');
    expect(secondFirst.name > firstLast.name).toBe(true);

    const activeCount = await withTenantTransaction(tenant.id, 'user_clt061_keyset', async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM physical_asset
          WHERE tenant_id = $1 AND lifecycle_status = 'active'`,
        [tenant.id],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    expect(activeCount).toBe(1000);
  }, SCALE_TEST_TIMEOUT_MS);

  it('keeps catalogue sort/search/filter indexes available at representative V1 scale', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt061_plans' });
    const seeded = await seedScaleCatalogue(tenant.id, 'user_clt061_plans');

    const plans = await withTenantTransaction(tenant.id, 'user_clt061_plans', async (client) => {
      const anchorResult = await client.query<{ id: string; sort_name: string }>(
        `SELECT id, lower(name) AS sort_name
           FROM product
          WHERE tenant_id = $1 AND code = 'SCALE-0500'
          LIMIT 1`,
        [tenant.id],
      );
      const anchor = anchorResult.rows[0];
      if (!anchor) throw new Error('Expected keyset anchor row.');
      const sort = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (COSTS OFF)
         SELECT p.id FROM product p
          WHERE p.tenant_id = $1
            AND (lower(p.name), p.id) > ($2, $3::uuid)
          ORDER BY lower(p.name) ASC, p.id ASC
          LIMIT 51`,
        [tenant.id, anchor.sort_name, anchor.id],
      );
      const filtered = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (COSTS OFF)
         SELECT p.id FROM product p
          WHERE p.tenant_id = $1
            AND p.category_id = $2
            AND p.status = 'active'
          ORDER BY p.created_at DESC, p.id ASC
          LIMIT 51`,
        [tenant.id, seeded.categoryId],
      );
      return { sort: planText(sort.rows), filtered: planText(filtered.rows) };
    });
    const searchPlan = await explainSearchIndex();

    expect(plans.sort).toContain('Limit');
    expect(plans.sort).not.toContain('Seq Scan on product');
    expect(plans.sort).toMatch(/product_tenant_(name_sort|created_sort|status)_idx/);
    expect(searchPlan).toContain('product_tenant_search_trgm_idx');
    expect(plans.filtered).toContain('product_tenant_category_status_created_idx');
  }, SCALE_TEST_TIMEOUT_MS);

  it('keeps public query bounds closed at 100 rows', async () => {
    const { clothingListQuery } = await import('@drezivo/contracts');
    expect(clothingListQuery.parse({ limit: 100 }).limit).toBe(100);
    expect(clothingListQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(clothingListQuery.safeParse({ limit: 1000 }).success).toBe(false);
  });

  async function seedScaleCatalogue(tenantId: string, principalId: string) {
    const seeded = await insertScaleCatalogue(tenantId, principalId);
    // Collect representative planner stats after seeding. PostgreSQL 17 requires MAINTAIN for
    // ANALYZE, which the app role intentionally lacks, so use the local test admin connection.
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query('ANALYZE product, product_variant, physical_asset');
    } finally {
      await admin.end();
    }
    return seeded;
  }

  async function insertScaleCatalogue(tenantId: string, principalId: string) {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Scale Branch', 'SCALE', true, 'Asia/Manila') RETURNING id`,
        [tenantId],
      );
      const branchId = requireId(branch.rows[0]?.id, 'branch');
      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Scale Gowns', 'active', 10) RETURNING id`,
        [tenantId],
      );
      const categoryId = requireId(category.rows[0]?.id, 'category');
      const secondaryCategory = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Scale Formalwear', 'active', 20) RETURNING id`,
        [tenantId],
      );
      const secondaryCategoryId = requireId(secondaryCategory.rows[0]?.id, 'secondary category');

      await client.query(
        `INSERT INTO product
           (tenant_id, category_id, code, name, description, status, created_at, updated_at)
         SELECT $1, $2,
           'SCALE-' || lpad(n::text, 4, '0'),
           'Scale Look ' || lpad(n::text, 4, '0'),
           'CLT-061 representative catalogue row', 'active',
           timestamptz '2026-01-01 00:00:00+00' + (n * interval '1 minute'),
           timestamptz '2026-01-01 00:00:00+00' + (n * interval '1 minute')
         FROM generate_series(1, 1000) AS n`,
        [tenantId, categoryId],
      );
      await client.query(
        `UPDATE product
            SET category_id = $2
          WHERE tenant_id = $1
            AND substring(code from 7)::int % 10 <> 0`,
        [tenantId, secondaryCategoryId],
      );
      await client.query(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
            measurement_mode, rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         SELECT $1, p.id, 'SCALE-SKU-' || substring(p.code from 7),
           CASE WHEN substring(p.code from 7)::int % 3 = 0 THEN 'L' ELSE 'M' END,
           'Black', '{}', 'cm', 'none', 10000 + substring(p.code from 7)::int, 5000,
           'PHP', 'daily', 1440, 10000, 0, 1440, 'active'
         FROM product p
         WHERE p.tenant_id = $1`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         SELECT $1, $2, pv.id, 'SCALE-ASSET-' || substring(p.code from 7), 'active',
           CASE WHEN substring(p.code from 7)::int % 25 = 0 THEN 'needs_cleaning' ELSE 'ready' END,
           'at_branch'
         FROM product_variant pv
         JOIN product p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
         WHERE pv.tenant_id = $1`,
        [tenantId, branchId],
      );
      return { branchId, categoryId };
    });
  }
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

function planText(rows: Array<{ 'QUERY PLAN': string }>): string {
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

async function explainSearchIndex(): Promise<string> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query('SET LOCAL enable_seqscan = off');
    const result = await admin.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (COSTS OFF)
       SELECT p.id FROM product p
        WHERE lower(p.name || ' ' || p.code) LIKE '%Scale Look 0999%'`,
    );
    await admin.query('ROLLBACK');
    return planText(result.rows);
  } catch (error) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await admin.end();
  }
}

function requireId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Expected ${label} id.`);
  return value;
}
