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
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('Catalogue batch import routes', async () => {
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

  type BatchResult = { idempotency_key: string; status: number; body: { success: boolean; data?: { product_id?: string }; error?: { code: string } } };

  it('requires a signed-in staff member with assets.manage', async () => {
    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const anonymous = await request(createApp()).post('/api/v1/catalogue/import/clothing').send({ items: [] });
    expect(anonymous.status).toBe(401);

    const seed = await seedRouteTenant('org_import_permission', 'user_import_permission', []);
    useClerk(seed);
    const forbidden = await request(createApp())
      .post('/api/v1/catalogue/import/clothing')
      .send({ items: [{ idempotency_key: 'import-perm-01', request: validRequest(seed.categoryId, 'PERM-1') }] });
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');
  });

  it('creates every valid row, fails only the bad row, and replays on retry without duplicates', async () => {
    const seed = await seedRouteTenant('org_import_batch', 'user_import_batch', ['assets.manage']);
    useClerk(seed);
    const imageId = await seedAcceptedImage(seed, 'batch-photo');
    const withPhoto = { ...validRequest(seed.categoryId, 'BATCH-1'), image_file_ids: [imageId] };
    const invalid = { ...validRequest(seed.categoryId, 'BATCH-2'), name: '' };
    const batch = {
      items: [
        { idempotency_key: 'import-row-0001', request: withPhoto },
        { idempotency_key: 'import-row-0002', request: invalid },
        { idempotency_key: 'import-row-0003', request: validRequest(seed.categoryId, 'BATCH-3') },
      ],
    };

    const first = await request(createApp()).post('/api/v1/catalogue/import/clothing').send(batch);
    expect(first.status).toBe(200);
    const results = readSuccessData<{ results: BatchResult[] }>(first.body).results;
    expect(results.map((row) => [row.idempotency_key, row.status])).toEqual([
      ['import-row-0001', 201],
      ['import-row-0002', 422],
      ['import-row-0003', 201],
    ]);
    expect(results[1]?.body.error?.code).toBe('VALIDATION_FAILED');
    expect(await countProductCode(seed.tenantId, seed.principalId, 'BATCH-1')).toBe(1);
    expect(await countProductCode(seed.tenantId, seed.principalId, 'BATCH-2')).toBe(0);

    // The same keys again (a retry after a dropped connection) replay the stored outcomes.
    const replay = await request(createApp()).post('/api/v1/catalogue/import/clothing').send(batch);
    const replayed = readSuccessData<{ results: BatchResult[] }>(replay.body).results;
    expect(replayed[0]?.body.data?.product_id).toBe(results[0]?.body.data?.product_id);
    expect(await countProductCode(seed.tenantId, seed.principalId, 'BATCH-1')).toBe(1);
    expect(await countProductCode(seed.tenantId, seed.principalId, 'BATCH-3')).toBe(1);

    // Two concurrent submissions of one row still create it once.
    const row = { items: [{ idempotency_key: 'import-row-0004', request: validRequest(seed.categoryId, 'BATCH-4') }] };
    const [a, b] = await Promise.all([
      request(createApp()).post('/api/v1/catalogue/import/clothing').send(row),
      request(createApp()).post('/api/v1/catalogue/import/clothing').send(row),
    ]);
    const statuses = [a, b].map((response) => readSuccessData<{ results: BatchResult[] }>(response.body).results[0]?.status);
    expect(statuses).toContain(201);
    expect(await countProductCode(seed.tenantId, seed.principalId, 'BATCH-4')).toBe(1);

    const images = await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM product_image pi JOIN product p ON p.id = pi.product_id
          WHERE p.tenant_id = $1 AND p.code = 'BATCH-1'`,
        [seed.tenantId],
      ),
    );
    expect(images.rows[0]?.n).toBe(1);
  });

  it('rejects a whole batch with repeated keys or too many rows before creating anything', async () => {
    const seed = await seedRouteTenant('org_import_shape', 'user_import_shape', ['assets.manage']);
    useClerk(seed);
    const repeated = await request(createApp())
      .post('/api/v1/catalogue/import/clothing')
      .send({
        items: [
          { idempotency_key: 'import-dupe-001', request: validRequest(seed.categoryId, 'DUPE-1') },
          { idempotency_key: 'import-dupe-001', request: validRequest(seed.categoryId, 'DUPE-2') },
        ],
      });
    expect(repeated.status).toBe(422);
    const tooMany = await request(createApp())
      .post('/api/v1/catalogue/import/clothing')
      .send({
        items: Array.from({ length: 26 }, (_, index) => ({
          idempotency_key: `import-many-${String(index).padStart(3, '0')}`,
          request: validRequest(seed.categoryId, `MANY-${index}`),
        })),
      });
    expect(tooMany.status).toBe(422);
    expect(await countProductCode(seed.tenantId, seed.principalId, 'DUPE-1')).toBe(0);
    expect(await countProductCode(seed.tenantId, seed.principalId, 'MANY-0')).toBe(0);
  });

  it('reports whether photo reading is configured', async () => {
    const seed = await seedRouteTenant('org_import_caps', 'user_import_caps', ['assets.manage']);
    useClerk(seed);
    const response = await request(createApp()).get('/api/v1/catalogue/import/capabilities');
    expect(response.status).toBe(200);
    expect(readSuccessData<{ photo_extraction: boolean; max_batch_items: number }>(response.body)).toEqual({
      photo_extraction: false,
      max_batch_items: 25,
    });
    const extract = await request(createApp())
      .post('/api/v1/catalogue/import/extract')
      .send({ file_id: await seedAcceptedImage(seed, 'caps-photo') });
    expect(extract.status).toBe(503);
    expectSafeError(extract.body, 'DEPENDENCY_UNAVAILABLE');
  });

  function useClerk(seed: { principalId: string; clerkOrgId: string }) {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }

  async function seedRouteTenant(
    clerkOrgId: string,
    principalId: string,
    permissions: string[],
    role: 'owner' | 'frontdesk' = 'owner',
  ) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, role);

    const seeded = await withTenantTransaction(tenant.id, principalId, async (client) => {
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
        [tenant.id, branchId, membershipId, JSON.stringify(permissions)],
      );

      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10)
         RETURNING id`,
        [tenant.id],
      );
      const categoryId = requireRow(category.rows, 'category').id;

      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'starter' AND version = 1 AND active = true LIMIT 1`,
      );
      const planId = requireRow(plan.rows, 'starter plan').id;
      await client.query(
        `INSERT INTO subscription
           (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );

      return { branchId, categoryId };
    });

    return {
      tenantId: tenant.id,
      clerkOrgId: tenant.clerkOrgId,
      principalId,
      branchId: seeded.branchId,
      categoryId: seeded.categoryId,
    };
  }

  async function seedAcceptedImage(
    seed: Awaited<ReturnType<typeof seedRouteTenant>>,
    label: string,
  ): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'catalogue_image', $2, $3, $4, 'image/png', 512,
                 'accepted', true, now() + interval '10 minutes', now())
         RETURNING id`,
        [
          seed.tenantId,
          `tenant-files/${seed.tenantId}/${label}.png`,
          `version-${label}`,
          Buffer.alloc(32, 9).toString('base64'),
        ],
      );
      return requireRow(result.rows, 'accepted catalogue image').id;
    });
  }

  async function countProductCode(tenantId: string, principalId: string, code: string) {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const result = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM product WHERE tenant_id = $1 AND code = $2`,
        [tenantId, code],
      );
      return result.rows[0]?.count ?? -1;
    });
  }

  function validRequest(categoryId: string, code: string) {
    return {
      name: `${code} Gown`,
      code,
      description: 'HTTP route catalogue item',
      category_id: categoryId,
      color_label: 'Black',
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
        rental_price_minor: '10000',
        security_deposit_minor: '5000',
        extra_day_price_minor: '0',
        prep_minutes: 0,
        turnaround_minutes: 1440,
      },
      activate: false,
    };
  }

  function asEnvelope(body: unknown): {
    success?: unknown;
    error?: { code?: unknown; message?: unknown; stack?: unknown };
    request_id?: unknown;
  } {
    return body as {
      success?: unknown;
      error?: { code?: unknown; message?: unknown; stack?: unknown };
      request_id?: unknown;
    };
  }

  function expectSafeError(body: unknown, code: string) {
    const parsed = asEnvelope(body);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.code).toBe(code);
    expect(parsed.error?.message).toEqual(expect.any(String));
    expect(parsed.error?.stack).toBeUndefined();
    expect(parsed.request_id).toEqual(expect.any(String));
  }

  function readSuccessData<T>(body: unknown): T {
    if (typeof body !== 'object' || body === null || !('data' in body)) {
      throw new Error('Expected success response data.');
    }
    return (body as { data: T }).data;
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} query to return a row.`);
    return row;
  }
});
