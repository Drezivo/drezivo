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
import { STANDARD_PLAN } from './helpers/standard-plan.js';

const clerk = vi.hoisted(() => ({ getAuth: vi.fn() }));

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
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('CLT-076 add variant HTTP route', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  async function seed(permissions: string[] = ['assets.manage']) {
    const principalId = `user_clt076_${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await createTestTenant({ clerkOrgId: `org_clt076_${Math.random().toString(36).slice(2, 8)}` });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    const productId = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active') RETURNING id`,
        [tenant.id],
      );
      const branchId = branch.rows[0]?.id;
      if (!branchId) throw new Error('Expected branch.');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, branchId, membershipId, JSON.stringify(permissions)],
      );
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true LIMIT 1`,
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('Expected starter plan.');
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );
      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10) RETURNING id`,
        [tenant.id],
      );
      const categoryId = category.rows[0]?.id;
      if (!categoryId) throw new Error('Expected category.');
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, 'CLT076-GWN', 'Expandable Gown', '', 'active') RETURNING id`,
        [tenant.id, categoryId],
      );
      const id = product.rows[0]?.id;
      if (!id) throw new Error('Expected product.');
      return { productId: id, branchId };
    });
    clerk.getAuth.mockReturnValue({ userId: principalId, orgId: tenant.clerkOrgId });
    return { tenantId: tenant.id, principalId, productId: productId.productId, branchId: productId.branchId };
  }

  const variantBody = {
    sku: 'CLT076-XL',
    size_label: 'XL',
    color_label: 'Emerald Green',
    measurement_mode: 'custom',
    measurement_guide_id: null,
    measurement_unit: 'cm',
    measurements: { bust: 102, waist: 84, hips: 108 },
    pricing: {
      mode: 'fixed_duration',
      rental_price_minor: '180000',
      security_deposit_minor: '50000',
      included_days: 3,
      extra_day_price_minor: '60000',
      prep_minutes: 0,
      turnaround_minutes: 1440,
    },
  } as const;

  it('adds an active variant directly, replays idempotently, and exposes it immediately in staff detail', async () => {
    const seeded = await seed();
    const app = createApp();

    const first = await request(app)
      .post(`/api/v1/catalogue/clothing/${seeded.productId}/variants`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt076-add-xl')
      .send(variantBody);
    const replay = await request(app)
      .post(`/api/v1/catalogue/clothing/${seeded.productId}/variants`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt076-add-xl')
      .send(variantBody);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      success: true,
      data: {
        variant: {
          sku: 'CLT076-XL',
          size_label: 'XL',
          color_label: 'Emerald Green',
          status: 'active',
          assets: [
            expect.objectContaining({
              lifecycle_status: 'active',
              readiness: 'ready',
              custody_kind: 'at_branch',
            }),
          ],
        },
      },
    });

    const detail = await request(app).get(`/api/v1/catalogue/clothing/${seeded.productId}`);
    expect(detail.status).toBe(200);
    const detailBody: unknown = detail.body;
    expect(readVariants(detailBody)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sku: 'CLT076-XL', status: 'active' })]),
    );

    const state = await withTenantTransaction(seeded.tenantId, seeded.principalId, async (client) => {
      const variants = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM product_variant WHERE tenant_id = $1 AND product_id = $2 AND sku = 'CLT076-XL'`,
        [seeded.tenantId, seeded.productId],
      );
      const variant = variants.rows[0];
      if (!variant) throw new Error('Expected created variant.');
      const assets = await client.query<{ count: number; lifecycle_status: string; readiness: string; custody_kind: string }>(
        `SELECT count(*)::int AS count,
                min(lifecycle_status)::text AS lifecycle_status,
                min(readiness)::text AS readiness,
                min(custody_kind)::text AS custody_kind
           FROM physical_asset
          WHERE tenant_id = $1 AND branch_id = $2 AND variant_id = $3`,
        [seeded.tenantId, seeded.branchId, variant.id],
      );
      const audit = await client.query<{ action: string }>(
        `SELECT action FROM audit_event
          WHERE tenant_id = $1
            AND action IN ('catalogue.clothing.variant_created', 'catalogue.asset.created')
          ORDER BY action`,
        [seeded.tenantId],
      );
      return { variants: variants.rows, assets: assets.rows[0], audit: audit.rows };
    });
    expect(state.variants).toHaveLength(1);
    expect(state.variants[0]?.status).toBe('active');
    expect(state.assets).toEqual({ count: 1, lifecycle_status: 'active', readiness: 'ready', custody_kind: 'at_branch' });
    expect(state.audit).toEqual([
      { action: 'catalogue.asset.created' },
      { action: 'catalogue.clothing.variant_created' },
    ]);
  });

  it('rejects a duplicate tenant-local SKU without creating another variant', async () => {
    const seeded = await seed();
    const app = createApp();
    const first = await request(app)
      .post(`/api/v1/catalogue/clothing/${seeded.productId}/variants`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt076-first-sku')
      .send(variantBody);
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post(`/api/v1/catalogue/clothing/${seeded.productId}/variants`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'testtest22')
      .send({ ...variantBody, size_label: 'XXL' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ success: false, error: { code: 'STATE_CONFLICT' } });
  });

  function readVariants(body: unknown): Array<Record<string, unknown>> {
    if (!body || typeof body !== 'object') throw new Error('Expected response body.');
    const data = (body as { data?: unknown }).data;
    if (!data || typeof data !== 'object') throw new Error('Expected response data.');
    const variants = (data as { variants?: unknown }).variants;
    if (!Array.isArray(variants)) throw new Error('Expected variant array.');
    return variants as Array<Record<string, unknown>>;
  }

  it('fails atomically at the physical-asset plan limit without creating the variant', async () => {
    const seeded = await seed();
    await withTenantTransaction(seeded.tenantId, seeded.principalId, async (client) => {
      const baseVariant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, measurements, measurement_unit, measurement_mode,
            rental_price_minor, security_deposit_minor, currency, pricing_mode, included_duration_minutes,
            extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'CLT076-BASE-M', 'M', '{}'::jsonb, 'cm', 'none',
                 100000, 25000, 'PHP', 'daily', 1440, 100000, 0, 1440, 'active')
         RETURNING id`,
        [seeded.tenantId, seeded.productId],
      );
      const baseVariantId = baseVariant.rows[0]?.id;
      if (!baseVariantId) throw new Error('Expected base variant.');
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         SELECT $1, $2, $3, 'CLT076-CAP-' || lpad(n::text, 4, '0'), 'active', 'ready', 'at_branch'
           FROM generate_series(1, $4::int) AS n`,
        [seeded.tenantId, seeded.branchId, baseVariantId, STANDARD_PLAN.physicalAssetsMax],
      );
    });

    const response = await request(createApp())
      .post(`/api/v1/catalogue/clothing/${seeded.productId}/variants`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt076-at-capacity')
      .send(variantBody);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, error: { code: 'CAPACITY_CONFLICT' } });

    const state = await withTenantTransaction(seeded.tenantId, seeded.principalId, async (client) => {
      const variant = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM product_variant
          WHERE tenant_id = $1 AND product_id = $2 AND sku = 'CLT076-XL'`,
        [seeded.tenantId, seeded.productId],
      );
      const assets = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM physical_asset WHERE tenant_id = $1`,
        [seeded.tenantId],
      );
      return {
        variants: variant.rows[0]?.count ?? -1,
        assets: assets.rows[0]?.count ?? -1,
      };
    });
    expect(state).toEqual({ variants: 0, assets: STANDARD_PLAN.physicalAssetsMax });
  });

  it('requires branch clothing-management permission', async () => {
    const seeded = await seed([]);
    const response = await request(createApp())
      .post(`/api/v1/catalogue/clothing/${seeded.productId}/variants`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'testtest33')
      .send(variantBody);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });
});
