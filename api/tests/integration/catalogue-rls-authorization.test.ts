import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionCode } from '@drezivo/contracts';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const clerk = vi.hoisted(() => ({
  getAuth: vi.fn(),
}));

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
process.env.OBJECT_STORAGE_REGION ??= 'test';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE ??= 'private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC ??= 'public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ??= 'test';

describe('CLT-060 catalogue RLS and authorization', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { archiveClothing } = await import('../../src/modules/catalogue/catalogue.service.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  beforeEach(() => {
    clerk.getAuth.mockReset();
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('forces catalogue RLS and fails closed when tenant context is absent', async () => {
    const tenantA = await seedCatalogueTenant('org_clt060_rls_a', 'user_clt060_rls_a', 'owner', [
      'assets.manage',
      'assets.archive',
    ]);
    const tenantB = await seedCatalogueTenant('org_clt060_rls_b', 'user_clt060_rls_b', 'owner', [
      'assets.manage',
      'assets.archive',
    ]);

    const hidden = await withTenantTransaction(tenantB.tenantId, tenantB.principalId, async (client) => {
      const result = await client.query<{ id: string }>('SELECT id FROM product WHERE id = $1', [tenantA.productId]);
      return result.rows;
    });
    expect(hidden).toEqual([]);

    await withTenantTransaction(tenantB.tenantId, tenantB.principalId, async (client) => {
      await expect(
        client.query(
          `INSERT INTO category (tenant_id, name, status, display_order)
           VALUES ($1, 'Cross tenant category', 'active', 999)`,
          [tenantA.tenantId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    const unscoped = new Client({ connectionString: buildAppRoleDatabaseUrl(adminUrl) });
    await unscoped.connect();
    try {
      const rls = await unscoped.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE relname = ANY($1::text[])
          ORDER BY relname`,
        [[
          'category',
          'measurement_guide',
          'physical_asset',
          'product',
          'product_image',
          'product_variant',
        ]],
      );
      expect(rls.rows).toHaveLength(6);
      expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

      const unscopedRead = await unscoped.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM product',
      );
      expect(unscopedRead.rows[0]?.count).toBe(0);

      await expect(
        unscoped.query(
          `INSERT INTO category (tenant_id, name, status, display_order)
           VALUES ($1, 'Missing tenant context', 'active', 1000)`,
          [tenantA.tenantId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await unscoped.end();
    }

    clerk.getAuth.mockReturnValue({ userId: tenantA.principalId, orgId: null });
    const missingOrg = await request(createApp()).get('/api/v1/catalogue/clothing');
    expect(missingOrg.status).toBe(403);
    expectSafeError(missingOrg.body, 'FORBIDDEN');
  });

  it('conceals foreign product and physical-asset identifiers as not found', async () => {
    const own = await seedCatalogueTenant('org_clt060_foreign_a', 'user_clt060_foreign_a', 'owner', [
      'assets.manage',
      'assets.archive',
    ]);
    const foreign = await seedCatalogueTenant('org_clt060_foreign_b', 'user_clt060_foreign_b', 'owner', [
      'assets.manage',
      'assets.archive',
    ]);
    useClerk(own);

    const detail = await request(createApp()).get(`/api/v1/catalogue/clothing/${foreign.productId}`);
    expect(detail.status).toBe(404);
    expectSafeError(detail.body, 'NOT_FOUND');
    expect(JSON.stringify(detail.body)).not.toContain(foreign.productId);

    const edit = await request(createApp())
      .patch(`/api/v1/catalogue/clothing/${foreign.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({ expected_updated_at: foreign.productUpdatedAt, description: 'Foreign edit attempt' });
    expect(edit.status).toBe(404);
    expectSafeError(edit.body, 'NOT_FOUND');
    expect(JSON.stringify(edit.body)).not.toContain(foreign.productId);

    const asset = await request(createApp())
      .patch(`/api/v1/catalogue/assets/${foreign.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({ expected_version: 1, readiness: 'needs_cleaning' });
    expect(asset.status).toBe(404);
    expectSafeError(asset.body, 'NOT_FOUND');
    expect(JSON.stringify(asset.body)).not.toContain(foreign.assetId);
  });

  it('enforces the accepted Owner and Front Desk asset permission matrix', async () => {
    const owner = await seedCatalogueTenant('org_clt060_owner', 'user_clt060_owner', 'owner', [
      'assets.manage',
      'assets.archive',
    ]);
    useClerk(owner);

    const ownerRead = await request(createApp()).get('/api/v1/catalogue/clothing?limit=20&sort=name_asc');
    expect(ownerRead.status).toBe(200);

    const ownerArchive = await request(createApp())
      .post(`/api/v1/catalogue/clothing/${owner.productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({ expected_updated_at: owner.productUpdatedAt });
    expect(ownerArchive.status).toBe(200);

    const frontDesk = await seedCatalogueTenant(
      'org_clt060_frontdesk',
      'user_clt060_frontdesk',
      'frontdesk',
      ['assets.manage'],
    );
    useClerk(frontDesk);

    const frontDeskRead = await request(createApp()).get('/api/v1/catalogue/clothing?limit=20&sort=name_asc');
    expect(frontDeskRead.status).toBe(200);

    const frontDeskEdit = await request(createApp())
      .patch(`/api/v1/catalogue/clothing/${frontDesk.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({ expected_updated_at: frontDesk.productUpdatedAt, description: 'Front Desk operational edit' });
    expect(frontDeskEdit.status).toBe(200);

    const frontDeskArchive = await request(createApp())
      .post(`/api/v1/catalogue/clothing/${frontDesk.productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({ expected_updated_at: frontDesk.productUpdatedAt });
    expect(frontDeskArchive.status).toBe(403);
    expectSafeError(frontDeskArchive.body, 'FORBIDDEN');

    await expect(
      archiveClothing({
        tenantId: frontDesk.tenantId,
        branchId: frontDesk.branchId,
        membershipId: frontDesk.membershipId,
        principalId: frontDesk.principalId,
        permissionCodes: ['assets.manage'],
        effectiveTenantStatus: 'active',
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        productId: frontDesk.productId,
        request: { expected_updated_at: frontDesk.productUpdatedAt },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const denied = await seedCatalogueTenant(
      'org_clt060_no_asset_grant',
      'user_clt060_no_asset_grant',
      'frontdesk',
      [],
    );
    useClerk(denied);
    const deniedRead = await request(createApp()).get('/api/v1/catalogue/clothing');
    expect(deniedRead.status).toBe(403);
    expectSafeError(deniedRead.body, 'FORBIDDEN');
  });

  it('uses only the selected branch grant for catalogue authorization', async () => {
    const seed = await seedCatalogueTenant(
      'org_clt060_branch_grant',
      'user_clt060_branch_grant',
      'frontdesk',
      [],
    );
    const permittedBranchId = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Permitted Branch', 'PERMITTED', false, 'Asia/Manila', 'active')
         RETURNING id`,
        [seed.tenantId],
      );
      const branchId = requireId(branch.rows[0]?.id, 'permitted branch');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [seed.tenantId, branchId, seed.membershipId, JSON.stringify(['assets.manage'])],
      );
      return branchId;
    });
    useClerk(seed);

    const defaultBranch = await request(createApp()).get('/api/v1/catalogue/clothing');
    expect(defaultBranch.status).toBe(403);

    const selectedBranch = await request(createApp())
      .get('/api/v1/catalogue/clothing')
      .set('X-Drezivo-Branch-Id', permittedBranchId);
    expect(selectedBranch.status).toBe(200);
  });

  it('enforces restricted and cancelled catalogue lifecycle policy centrally', async () => {
    const restricted = await seedCatalogueTenant(
      'org_clt060_restricted',
      'user_clt060_restricted',
      'owner',
      ['assets.manage', 'assets.archive'],
    );
    await setTenantStatus(restricted.tenantId, 'restricted');
    useClerk(restricted);

    const restrictedRead = await request(createApp()).get('/api/v1/catalogue/clothing');
    expect(restrictedRead.status).toBe(403);
    expectSafeError(restrictedRead.body, 'FORBIDDEN');

    const restrictedWrite = await request(createApp())
      .patch(`/api/v1/catalogue/clothing/${restricted.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({ expected_updated_at: restricted.productUpdatedAt, description: 'Blocked write' });
    expect(restrictedWrite.status).toBe(409);
    expectSafeError(restrictedWrite.body, 'TENANT_RESTRICTED');

    const cancelled = await seedCatalogueTenant(
      'org_clt060_cancelled',
      'user_clt060_cancelled',
      'owner',
      ['assets.manage', 'assets.archive'],
    );
    await setTenantStatus(cancelled.tenantId, 'cancelled');
    useClerk(cancelled);

    const cancelledRead = await request(createApp()).get('/api/v1/catalogue/clothing');
    expect(cancelledRead.status).toBe(403);
    expectSafeError(cancelledRead.body, 'FORBIDDEN');

    const cancelledWrite = await request(createApp())
      .patch(`/api/v1/catalogue/clothing/${cancelled.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({ expected_updated_at: cancelled.productUpdatedAt, description: 'Closed workspace write' });
    expect(cancelledWrite.status).toBe(409);
    expectSafeError(cancelledWrite.body, 'TENANT_CANCELLED');
  });

  function useClerk(seed: { principalId: string; clerkOrgId: string }) {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }

  async function setTenantStatus(tenantId: string, status: 'active' | 'restricted' | 'cancelled') {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query('UPDATE tenant SET status = $2 WHERE id = $1', [tenantId, status]);
    } finally {
      await admin.end();
    }
  }

  async function seedCatalogueTenant(
    clerkOrgId: string,
    principalId: string,
    role: 'owner' | 'frontdesk',
    permissions: PermissionCode[],
  ) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, role);

    return withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active')
         RETURNING id`,
        [tenant.id],
      );
      const branchId = requireId(branch.rows[0]?.id, 'branch');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, branchId, membershipId, JSON.stringify(permissions)],
      );

      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'starter' AND version = 1 AND active = true LIMIT 1`,
      );
      const planId = requireId(plan.rows[0]?.id, 'starter plan');
      await client.query(
        `INSERT INTO subscription
           (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );

      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Security Gowns', 'active', 10)
         RETURNING id`,
        [tenant.id],
      );
      const categoryId = requireId(category.rows[0]?.id, 'category');
      const product = await client.query<{ id: string; updated_at: Date }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, 'SEC-001', 'Security Gown', 'Security fixture', 'active')
         RETURNING id, updated_at`,
        [tenant.id, categoryId],
      );
      const productRow = product.rows[0];
      if (!productRow) throw new Error('Expected product row.');

      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurement_mode,
            rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'SEC-001-M', 'M', 'Black', 'none', 150000, 50000, 'PHP',
                 'daily', 1440, 150000, 0, 1440, 'active')
         RETURNING id`,
        [tenant.id, productRow.id],
      );
      const variantId = requireId(variant.rows[0]?.id, 'variant');
      const asset = await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'SEC-001-A1', 'active', 'ready', 'at_branch')
         RETURNING id`,
        [tenant.id, branchId, variantId],
      );
      const assetId = requireId(asset.rows[0]?.id, 'asset');

      return {
        tenantId: tenant.id,
        clerkOrgId,
        principalId,
        membershipId,
        branchId,
        categoryId,
        productId: productRow.id,
        productUpdatedAt: productRow.updated_at.toISOString(),
        variantId,
        assetId,
      };
    });
  }
});

function expectSafeError(body: unknown, code: string): void {
  expect(body).toMatchObject({
    success: false,
    error: { code },
  });
  const requestId = (body as { request_id?: unknown }).request_id;
  expect(typeof requestId).toBe('string');
  expect((requestId as string).length).toBeGreaterThan(0);
}

function requireId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Expected ${label} id.`);
  return value;
}
