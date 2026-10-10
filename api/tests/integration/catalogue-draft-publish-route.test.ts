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

describe('CLT-072 draft publish HTTP route', async () => {
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

  it('publishes a persisted draft through the authenticated catalogue endpoint', async () => {
    const principalId = 'user_clt072_route';
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt072_route' });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');

    const seeded = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active') RETURNING id`,
        [tenant.id],
      );
      const branchId = branch.rows[0]?.id;
      if (!branchId) throw new Error('Expected branch.');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, '["assets.manage"]'::jsonb)`,
        [tenant.id, branchId, membershipId],
      );
      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10) RETURNING id`,
        [tenant.id],
      );
      const categoryId = category.rows[0]?.id;
      if (!categoryId) throw new Error('Expected category.');
      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true LIMIT 1`,
      );
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('Expected starter plan.');
      await client.query(
        `INSERT INTO subscription
           (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );
      const product = await client.query<{ id: string; updated_at: Date }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, 'CLT072-ROUTE', 'Route Draft Gown', '', 'draft')
         RETURNING id, updated_at`,
        [tenant.id, categoryId],
      );
      const productRow = product.rows[0];
      if (!productRow) throw new Error('Expected product.');
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, measurements, measurement_unit, measurement_mode,
            rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'CLT072-ROUTE-M', 'M', '{}'::jsonb, 'cm', 'none',
                 100000, 25000, 'PHP', 'daily', 1440, 100000, 0, 1440, 'draft')
         RETURNING id`,
        [tenant.id, productRow.id],
      );
      const variantId = variant.rows[0]?.id;
      if (!variantId) throw new Error('Expected variant.');
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind,
            measurement_overrides, version)
         VALUES ($1, $2, $3, 'CLT072-ROUTE-AST', 'active', 'ready', 'at_branch', '{}'::jsonb, 1)`,
        [tenant.id, branchId, variantId],
      );
      const file = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'catalogue_image', 'catalogue/clt072-route.webp', 'v1', 'route-sha',
                 'image/webp', 512, 'accepted', true, now() + interval '10 minutes', now())
         RETURNING id`,
        [tenant.id],
      );
      const fileId = file.rows[0]?.id;
      if (!fileId) throw new Error('Expected file.');
      await client.query(
        'INSERT INTO product_image (tenant_id, product_id, file_id, display_order) VALUES ($1, $2, $3, 0)',
        [tenant.id, productRow.id, fileId],
      );
      return { productId: productRow.id, updatedAt: productRow.updated_at.toISOString() };
    });

    clerk.getAuth.mockReturnValue({ userId: principalId, orgId: tenant.clerkOrgId });

    const response = await request(createApp())
      .post(`/api/v1/catalogue/clothing/${seeded.productId}/publish`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'testtest55')
      .send({ expected_updated_at: seeded.updatedAt });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        product_id: seeded.productId,
        status: 'active',
        activated_variant_count: 1,
      },
    });
  });
});
