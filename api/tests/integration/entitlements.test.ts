import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';
import { STARTER_PLAN, STANDARD_PLAN } from './helpers/standard-plan.js';

const adminUrl = requireTestDatabaseUrl();

process.env.NODE_ENV = 'test';
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

describe('TBF-032 entitlement service', async () => {
  const { closePool, pool, withGlobalTransaction, withTenantTransaction } =
    await import('../../src/db/client.js');
  const {
    assertFrontDeskSeatCapacity,
    assertPhysicalAssetCapacity,
    resolvePlanEntitlements,
    resolveTenantEntitlements,
  } = await import('../../src/modules/entitlements/entitlements.service.js');
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

  it('resolves the server-owned Starter and Standard catalog values', async () => {
    const standard = await withGlobalTransaction('user_tbf032_plans', (client) =>
      resolvePlanEntitlements(client, 'standard'),
    );
    expect({
      code: standard.planCode,
      version: standard.planVersion,
      monthlyMinor: standard.monthlyMinor,
      currency: standard.currency,
      physicalAssetsMax: standard.physicalAssetsMax,
      frontdeskSeatsMax: standard.frontdeskSeatsMax,
    }).toEqual(STANDARD_PLAN);

    const starter = await withGlobalTransaction('user_tbf032_plans', (client) =>
      resolvePlanEntitlements(client, 'starter'),
    );
    expect({
      code: starter.planCode,
      version: starter.planVersion,
      monthlyMinor: starter.monthlyMinor,
      currency: starter.currency,
      physicalAssetsMax: starter.physicalAssetsMax,
      frontdeskSeatsMax: starter.frontdeskSeatsMax,
    }).toEqual(STARTER_PLAN);
  });

  it('enforces Starter garment capacity and disallows Front Desk seats', async () => {
    const tenant = await createQuotaTenant(
      'org_tbf032_starter_quota',
      'user_tbf032_starter_owner',
      'starter',
    );
    await seedPhysicalAssets(tenant.id, STARTER_PLAN.physicalAssetsMax - 1);

    await expect(
      withTenantTransaction(tenant.id, 'user_tbf032_starter_owner', (client) =>
        assertPhysicalAssetCapacity(client, tenant.id, 1),
      ),
    ).resolves.toMatchObject({ limit: 125, remaining: 0 });
    await expect(
      withTenantTransaction(tenant.id, 'user_tbf032_starter_owner', (client) =>
        assertPhysicalAssetCapacity(client, tenant.id, 2),
      ),
    ).rejects.toMatchObject({ code: 'CAPACITY_CONFLICT' });
    await expect(
      withTenantTransaction(tenant.id, 'user_tbf032_starter_owner', (client) =>
        assertFrontDeskSeatCapacity(client, tenant.id, 1),
      ),
    ).rejects.toMatchObject({ code: 'CAPACITY_CONFLICT' });
  });

  it('resolves a tenant subscription through the shared entitlement service', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_tbf032_resolution' });
    await createSubscription(tenant.id, 'standard');

    const snapshot = await withTenantTransaction(tenant.id, 'user_tbf032_resolution', (client) =>
      resolveTenantEntitlements(client, tenant.id),
    );

    expect(snapshot).toMatchObject({
      planCode: 'standard',
      planVersion: 1,
      physicalAssetsMax: STANDARD_PLAN.physicalAssetsMax,
      frontdeskSeatsMax: STANDARD_PLAN.frontdeskSeatsMax,
    });
  });

  it('rejects a missing or inactive tenant plan', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_tbf032_invalid_plan' });
    await createSubscription(tenant.id, 'standard');
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`UPDATE plan SET active = false WHERE code = 'standard' AND version = 1`);
      await expect(
        withTenantTransaction(tenant.id, 'user_tbf032_invalid_plan', (client) =>
          resolveTenantEntitlements(client, tenant.id),
        ),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    } finally {
      await admin.query(`UPDATE plan SET active = true WHERE code = 'standard' AND version = 1`);
      await admin.end();
    }
  });

  it('allows exact asset capacity and rejects overage', async () => {
    const tenant = await createQuotaTenant('org_tbf032_asset_quota', 'user_tbf032_asset_quota');
    const cap = STANDARD_PLAN.physicalAssetsMax;
    await seedPhysicalAssets(tenant.id, cap - 1);

    const exact = await withTenantTransaction(tenant.id, 'user_tbf032_asset_quota', (client) =>
      assertPhysicalAssetCapacity(client, tenant.id, 1),
    );
    expect(exact).toMatchObject({
      resource: 'physical_assets',
      current: cap - 1,
      requested: 1,
      limit: cap,
      remaining: 0,
    });

    await expect(
      withTenantTransaction(tenant.id, 'user_tbf032_asset_quota', (client) =>
        assertPhysicalAssetCapacity(client, tenant.id, 2),
      ),
    ).rejects.toMatchObject({ code: 'CAPACITY_CONFLICT' });
  });

  it('serializes concurrent asset claims so only one final write reaches the cap', async () => {
    const tenant = await createQuotaTenant('org_tbf032_asset_race', 'user_tbf032_asset_race');
    await seedPhysicalAssets(tenant.id, STANDARD_PLAN.physicalAssetsMax - 1);

    const attempts = await Promise.allSettled(
      ['user_tbf032_asset_race_a', 'user_tbf032_asset_race_b'].map((principalId) =>
        withTenantTransaction(tenant.id, principalId, async (client) => {
          await assertPhysicalAssetCapacity(client, tenant.id, 1);
          await client.query(
            `INSERT INTO physical_asset
               (tenant_id, branch_id, variant_id, asset_code, lifecycle_status)
             VALUES ($1, $2, $3, $4, 'active')`,
            [tenant.id, tenant.branchId, tenant.variantId, principalId],
          );
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
  });

  it('counts active Front Desk memberships, excludes the Owner, and serializes claims', async () => {
    const tenant = await createQuotaTenant('org_tbf032_seat_race', 'user_tbf032_seat_owner');
    // Fill every seat but one, so exactly one of the two racing claims may win.
    const existing = STANDARD_PLAN.frontdeskSeatsMax - 1;
    for (let index = 0; index < existing; index += 1) {
      await createTestMembership(tenant.id, `user_tbf032_existing_frontdesk_${index}`, 'frontdesk');
    }

    const attempts = await Promise.allSettled(
      ['user_tbf032_seat_a', 'user_tbf032_seat_b'].map((principalId) =>
        withTenantTransaction(tenant.id, principalId, async (client) => {
          await assertFrontDeskSeatCapacity(client, tenant.id, 1);
          await client.query(
            `INSERT INTO membership (tenant_id, clerk_user_id, role, status)
             VALUES ($1, $2, 'frontdesk', 'active')`,
            [tenant.id, principalId],
          );
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);

    const result = await withTenantTransaction(
      tenant.id,
      'user_tbf032_seat_owner',
      async (client) =>
        client.query<{ count: number }>(
          `SELECT count(*)::int AS count
         FROM membership
         WHERE tenant_id = $1 AND role = 'frontdesk' AND status = 'active'`,
          [tenant.id],
        ),
    );
    expect(result.rows[0]?.count).toBe(STANDARD_PLAN.frontdeskSeatsMax);
  });

  it('keeps quota reads inside the authenticated tenant scope', async () => {
    const owner = await createQuotaTenant(
      'org_tbf032_isolation_owner',
      'user_tbf032_isolation_owner',
    );
    const foreign = await createQuotaTenant(
      'org_tbf032_isolation_foreign',
      'user_tbf032_isolation_foreign',
    );
    await seedPhysicalAssets(foreign.id, 1);

    await expect(
      withTenantTransaction(owner.id, 'user_tbf032_isolation_owner', (client) =>
        assertPhysicalAssetCapacity(client, foreign.id, 1),
      ),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    const ownResult = await withTenantTransaction(
      owner.id,
      'user_tbf032_isolation_owner',
      (client) => assertPhysicalAssetCapacity(client, owner.id, 1),
    );
    expect(ownResult.current).toBe(0);
  });

  it('does not consume capacity when the caller rolls back after the guard', async () => {
    const tenant = await createQuotaTenant('org_tbf032_rollback', 'user_tbf032_rollback');

    await expect(
      withTenantTransaction(tenant.id, 'user_tbf032_rollback', async (client) => {
        await assertFrontDeskSeatCapacity(client, tenant.id, 1);
        await client.query(
          `INSERT INTO membership (tenant_id, clerk_user_id, role, status)
           VALUES ($1, $2, 'frontdesk', 'active')`,
          [tenant.id, 'user_tbf032_rollback_member'],
        );
        throw new Error('rollback test');
      }),
    ).rejects.toThrow('rollback test');

    const result = await withTenantTransaction(tenant.id, 'user_tbf032_rollback', (client) =>
      assertFrontDeskSeatCapacity(client, tenant.id, 1),
    );
    expect(result.current).toBe(0);
  });

  it('keeps plan and entitlement rows read-only for the app role', async () => {
    await expect(
      pool.query(
        `INSERT INTO plan (code, version, monthly_minor, currency, active)
         VALUES ('test', 99, 1, 'PHP', true)`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      pool.query(`UPDATE plan SET monthly_minor = monthly_minor WHERE code = 'standard'`),
    ).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      pool.query(`DELETE FROM plan_entitlement WHERE capability = 'physical_assets.max'`),
    ).rejects.toMatchObject({
      code: '42501',
    });
  });

  async function createSubscription(tenantId: string, code: 'starter' | 'standard') {
    await withTenantTransaction(tenantId, `user_${code}_${tenantId}`, async (client) => {
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = $1 AND version = 1 AND active = true`,
        [code],
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error(`missing ${code} seed`);
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenantId, planId],
      );
    });
  }

  async function createQuotaTenant(
    clerkOrgId: string,
    ownerPrincipal: string,
    planCode: 'starter' | 'standard' = 'standard',
  ) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, ownerPrincipal, 'owner');
    const branch = await withTenantTransaction(tenant.id, ownerPrincipal, async (client) => {
      const branchResult = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'main', true, 'Asia/Manila', 'active')
         RETURNING id`,
        [tenant.id],
      );
      const branchId = branchResult.rows[0]?.id;
      if (!branchId) throw new Error('missing branch');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, '[]'::jsonb)`,
        [tenant.id, branchId, membershipId],
      );
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, 'TEST-PRODUCT', 'Test Product', 'active')
         RETURNING id`,
        [tenant.id],
      );
      const productId = product.rows[0]?.id;
      if (!productId) throw new Error('missing product');
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, rental_price_minor,
            included_duration_minutes, status)
         VALUES ($1, $2, 'TEST-SKU', 'M', 'Black', 1000, 1440, 'active')
         RETURNING id`,
        [tenant.id, productId],
      );
      const variantId = variant.rows[0]?.id;
      if (!variantId) throw new Error('missing product variant');
      return { id: branchId, variantId };
    });
    await createSubscription(tenant.id, planCode);
    return { id: tenant.id, branchId: branch.id, variantId: branch.variantId };
  }

  async function seedPhysicalAssets(tenantId: string, count: number) {
    const tenant = await withTenantTransaction(
      tenantId,
      'user_tbf032_asset_seed',
      async (client) => {
        const branch = await client.query<{ id: string }>(
          `SELECT id FROM branch WHERE tenant_id = $1 AND is_default = true`,
          [tenantId],
        );
        const variant = await client.query<{ id: string }>(
          `SELECT id FROM product_variant WHERE tenant_id = $1 LIMIT 1`,
          [tenantId],
        );
        return { branchId: branch.rows[0]?.id, variantId: variant.rows[0]?.id };
      },
    );
    if (!tenant.branchId || !tenant.variantId) throw new Error('missing quota seed rows');
    await withTenantTransaction(tenantId, 'user_tbf032_asset_seed', async (client) => {
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status)
         SELECT $1, $2, $3, 'seed-' || series::text, 'active'
         FROM generate_series(1, $4::int) AS series`,
        [tenantId, tenant.branchId, tenant.variantId, count],
      );
    });
  }
});
