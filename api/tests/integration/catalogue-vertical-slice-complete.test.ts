import { randomUUID } from 'node:crypto';

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

describe('CLT-062 Clothing vertical slice completion', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
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

  it('runs add → list/search/filter → detail → edit → archive against one real tenant catalogue graph', async () => {
    const principalId = 'user_clt062_vertical_slice';
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt062_vertical_slice' });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');

    const seed = await withTenantTransaction(tenant.id, principalId, async (client) => {
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
        [tenant.id, branchId, membershipId, JSON.stringify(['assets.manage', 'assets.archive'])],
      );

      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10)
         RETURNING id`,
        [tenant.id],
      );
      const categoryId = requireId(category.rows[0]?.id, 'category');

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

      return { branchId, categoryId };
    });

    clerk.getAuth.mockReturnValue({ userId: principalId, orgId: tenant.clerkOrgId });
    const app = createApp();

    const createResponse = await request(app)
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({
        name: 'CLT-062 Emerald Gown',
        code: 'CLT-062',
        description: 'Vertical slice completion garment',
        category_id: seed.categoryId,
        color_label: 'Emerald',
        image_file_ids: [],
        sizes: [
          {
            size_label: 'M',
            measurement_mode: 'none',
            measurement_unit: 'cm',
            measurements: {},
          },
        ],
        pricing: {
          mode: 'daily',
          rental_price_minor: '15000',
          security_deposit_minor: '5000',
          extra_day_price_minor: '2500',
          prep_minutes: 0,
          turnaround_minutes: 1440,
        },
        activate: false,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({
      success: true,
      data: {
        code: 'CLT-062',
        variant_count: 1,
        physical_piece_count: 1,
        status: 'draft',
      },
    });
    const productId = readDataString(createResponse.body, 'product_id');

    const listResponse = await request(app).get('/api/v1/catalogue/clothing').query({
      search: 'CLT-062',
      category_id: seed.categoryId,
      size_label: 'M',
      product_status: 'draft',
      limit: '20',
      sort: 'name_asc',
    });

    expect(listResponse.status).toBe(200);
    const listItems = readItems(listResponse.body);
    expect(listItems).toHaveLength(1);
    expect(listItems[0]).toMatchObject({
      product_id: productId,
      code: 'CLT-062',
      name: 'CLT-062 Emerald Gown',
      product_status: 'draft',
      size_labels: ['M'],
      category: { id: seed.categoryId, name: 'Gowns' },
    });

    const detailResponse = await request(app).get(`/api/v1/catalogue/clothing/${productId}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body).toMatchObject({
      success: true,
      data: {
        product_id: productId,
        code: 'CLT-062',
        name: 'CLT-062 Emerald Gown',
        status: 'draft',
        variants: [
          {
            size_label: 'M',
            status: 'draft',
            assets: [
              {
                lifecycle_status: 'active',
                readiness: 'ready',
                custody_kind: 'at_branch',
              },
            ],
          },
        ],
      },
    });
    const originalUpdatedAt = readDataString(detailResponse.body, 'updated_at');

    const editResponse = await request(app)
      .patch(`/api/v1/catalogue/clothing/${productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({
        expected_updated_at: originalUpdatedAt,
        name: 'CLT-062 Updated Emerald Gown',
        description: 'Edited through the real catalogue API',
      });

    expect(editResponse.status).toBe(200);
    expect(editResponse.body).toMatchObject({
      success: true,
      data: {
        product_id: productId,
        name: 'CLT-062 Updated Emerald Gown',
        status: 'draft',
      },
    });
    const editedUpdatedAt = readDataString(editResponse.body, 'updated_at');
    expect(editedUpdatedAt).not.toBe(originalUpdatedAt);

    const editedDetail = await request(app).get(`/api/v1/catalogue/clothing/${productId}`);
    expect(editedDetail.status).toBe(200);
    expect(editedDetail.body).toMatchObject({
      success: true,
      data: {
        product_id: productId,
        name: 'CLT-062 Updated Emerald Gown',
        description: 'Edited through the real catalogue API',
      },
    });

    const archiveResponse = await request(app)
      .post(`/api/v1/catalogue/clothing/${productId}/archive`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({ expected_updated_at: editedUpdatedAt });

    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body).toMatchObject({
      success: true,
      data: {
        product_id: productId,
        status: 'archived',
        archived_variant_count: 1,
        retired_asset_count: 1,
        pending_asset_resolution_count: 0,
      },
    });

    const archivedList = await request(app).get('/api/v1/catalogue/clothing').query({
      search: 'CLT-062',
      product_status: 'archived',
      limit: '20',
      sort: 'name_asc',
    });
    expect(archivedList.status).toBe(200);
    expect(readItems(archivedList.body)).toEqual([
      expect.objectContaining({
        product_id: productId,
        code: 'CLT-062',
        name: 'CLT-062 Updated Emerald Gown',
        product_status: 'archived',
      }),
    ]);

    const archivedDetail = await request(app).get(`/api/v1/catalogue/clothing/${productId}`);
    expect(archivedDetail.status).toBe(200);
    expect(archivedDetail.body).toMatchObject({
      success: true,
      data: {
        product_id: productId,
        status: 'archived',
        variants: [
          {
            status: 'archived',
            assets: [{ lifecycle_status: 'retired', readiness: 'unready' }],
          },
        ],
      },
    });
  });
});

function readData(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new Error('Expected response envelope.');
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') throw new Error('Expected response data.');
  return data as Record<string, unknown>;
}

function readDataString(body: unknown, key: string): string {
  const value = readData(body)[key];
  if (typeof value !== 'string') throw new Error(`Expected data.${key} to be a string.`);
  return value;
}

function readItems(body: unknown): Array<Record<string, unknown>> {
  const items = readData(body).items;
  if (!Array.isArray(items)) throw new Error('Expected data.items to be an array.');
  return items as Array<Record<string, unknown>>;
}

function requireId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Expected ${label} id.`);
  return value;
}
