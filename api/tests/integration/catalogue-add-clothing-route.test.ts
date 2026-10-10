import { Client } from 'pg';
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

describe('CLT-021 Add Clothing HTTP route', async () => {
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

  it('requires an authenticated Clerk staff session', async () => {
    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });

    const response = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-auth-required')
      .send({});

    expect(response.status).toBe(401);
    expectSafeError(response.body, 'UNAUTHENTICATED');
  });

  it('requires an active local membership in the Clerk workspace', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt021_no_membership' });
    clerk.getAuth.mockReturnValue({ userId: 'user_clt021_no_membership', orgId: tenant.clerkOrgId });

    const response = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-no-membership')
      .send({});

    expect(response.status).toBe(403);
    expectSafeError(response.body, 'FORBIDDEN');
  });

  it('requires assets.manage on the resolved active branch', async () => {
    const seed = await seedRouteTenant('org_clt021_permission', 'user_clt021_permission', []);
    useClerk(seed);

    const response = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'testidem03')
      .send(validRequest(seed.categoryId, 'PERM-001'));

    expect(response.status).toBe(403);
    expectSafeError(response.body, 'FORBIDDEN');
  });

  it('enforces the tenant lifecycle gate before a restricted workspace can create assets', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_restricted',
      'user_clt021_restricted',
      ['assets.manage'],
    );
    await setTenantStatus(seed.tenantId, 'restricted');
    useClerk(seed);

    const response = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-restricted')
      .send(validRequest(seed.categoryId, 'REST-001'));

    expect(response.status).toBe(409);
    expectSafeError(response.body, 'TENANT_RESTRICTED');
  });

  it('rejects missing idempotency keys before any catalogue graph is created', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_idempotency_required',
      'user_clt021_idempotency_required',
      ['assets.manage'],
    );
    useClerk(seed);

    const response = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .send(validRequest(seed.categoryId, 'NO-IDEMP-001'));

    expect(response.status).toBe(422);
    expectSafeError(response.body, 'VALIDATION_FAILED');
    expect(await countProductCode(seed.tenantId, seed.principalId, 'NO-IDEMP-001')).toBe(0);
  });

  it('rejects browser authority, quota, and derived availability fields through the strict contract', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_authority',
      'user_clt021_authority',
      ['assets.manage'],
    );
    useClerk(seed);

    const response = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-authority')
      .send({
        ...validRequest(seed.categoryId, 'AUTHORITY-001'),
        tenant_id: '00000000-0000-4000-8000-000000000001',
        branch_id: '00000000-0000-4000-8000-000000000002',
        membership_id: '00000000-0000-4000-8000-000000000003',
        physical_assets_max: 999999,
        availability: 'available',
      });

    expect(response.status).toBe(422);
    expectSafeError(response.body, 'VALIDATION_FAILED');
    expect(await countProductCode(seed.tenantId, seed.principalId, 'AUTHORITY-001')).toBe(0);
  });

  it('rejects more than five product photos before creating any catalogue rows', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_photo_limit',
      'user_clt021_photo_limit',
      ['assets.manage'],
    );
    useClerk(seed);
    const imageFileIds = Array.from(
      { length: 6 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 40).padStart(12, '0')}`,
    );

    const response = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-photo-limit')
      .send({
        ...validRequest(seed.categoryId, 'PHOTO-LIMIT-001'),
        image_file_ids: imageFileIds,
      });

    expect(response.status).toBe(422);
    expectSafeError(response.body, 'VALIDATION_FAILED');
    expect(await countProductCode(seed.tenantId, seed.principalId, 'PHOTO-LIMIT-001')).toBe(0);
  });

  it('uses the dedicated 64 KB catalogue metadata body limit', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_body_limit',
      'user_clt021_body_limit',
      ['assets.manage'],
    );
    useClerk(seed);

    const response = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'testidem04')
      .send({
        ...validRequest(seed.categoryId, 'BODY-001'),
        description: 'x'.repeat(70 * 1024),
      });

    expect(response.status).toBe(422);
    expectSafeError(response.body, 'VALIDATION_FAILED');
    expect(asEnvelope(response.body).error?.message).toBe('Request body is too large.');
  });

  it('requires an image for active clothing while allowing an image-less draft', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_active_image',
      'user_clt021_active_image',
      ['assets.manage'],
    );
    useClerk(seed);

    const activeResponse = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-active-no-image')
      .send({ ...validRequest(seed.categoryId, 'ACTIVE-NO-IMAGE'), activate: true });

    expect(activeResponse.status).toBe(422);
    expectSafeError(activeResponse.body, 'VALIDATION_FAILED');
    expect(await countProductCode(seed.tenantId, seed.principalId, 'ACTIVE-NO-IMAGE')).toBe(0);

    const draftResponse = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-draft-no-image')
      .send(validRequest(seed.categoryId, 'DRAFT-NO-IMAGE'));

    expect(draftResponse.status).toBe(201);
    expect(draftResponse.body).toMatchObject({
      success: true,
      data: { code: 'DRAFT-NO-IMAGE', status: 'draft' },
    });
  });

  it('accepts omitted or blank clothing color through the HTTP boundary', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_optional_color',
      'user_clt021_optional_color',
      ['assets.manage'],
    );
    useClerk(seed);

    const omittedColor = validRequest(seed.categoryId, 'NO-COLOR-OMITTED') as Record<string, unknown>;
    delete omittedColor.color_label;
    const omittedResponse = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-no-color-omitted')
      .send(omittedColor);

    const blankResponse = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-no-color-blank')
      .send({ ...validRequest(seed.categoryId, 'NO-COLOR-BLANK'), color_label: '   ' });

    expect(omittedResponse.status).toBe(201);
    expect(omittedResponse.body).toMatchObject({
      success: true,
      data: { code: 'NO-COLOR-OMITTED', status: 'draft' },
    });
    expect(blankResponse.status).toBe(201);
    expect(blankResponse.body).toMatchObject({
      success: true,
      data: { code: 'NO-COLOR-BLANK', status: 'draft' },
    });
  });

  it('trims a custom subcategory on create and treats blank input as no subcategory', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_subcategory',
      'user_clt021_subcategory',
      ['assets.manage'],
    );
    useClerk(seed);
    const app = createApp();
    const custom = await request(app)
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-subcategory-custom')
      .send({ ...validRequest(seed.categoryId, 'SUB-CUSTOM-001'), subcategory: '  Tea Length  ' });
    const blank = await request(app)
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-subcategory-blank')
      .send({ ...validRequest(seed.categoryId, 'SUB-BLANK-001'), subcategory: '   ' });

    expect(custom.status).toBe(201);
    expect(readSuccessData<{ subcategory: string | null }>(custom.body).subcategory).toBe('Tea Length');
    expect(blank.status).toBe(201);
    expect(readSuccessData<{ subcategory: string | null }>(blank.body).subcategory).toBeNull();
    const persisted = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) =>
      client.query<{ code: string; subcategory: string | null }>(
        `SELECT code, subcategory FROM product WHERE tenant_id = $1 ORDER BY code`,
        [seed.tenantId],
      ),
    );
    expect(persisted.rows).toEqual([
      { code: 'SUB-BLANK-001', subcategory: null },
      { code: 'SUB-CUSTOM-001', subcategory: 'Tea Length' },
    ]);
  });

  it('creates through the route for authorized Front Desk staff and replays the same idempotency intent', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_success',
      'user_clt021_success',
      ['assets.manage'],
      'frontdesk',
    );
    useClerk(seed);
    const imageId = await seedAcceptedImage(seed, 'http-success');
    const body = {
      ...validRequest(seed.categoryId, 'HTTP-001'),
      activate: true,
      image_file_ids: [imageId],
    };

    const first = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-http-success')
      .send(body);
    const replay = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-http-success')
      .send(body);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(first.body).toEqual(replay.body);
    expect(first.body).toMatchObject({
      success: true,
      data: {
        code: 'HTTP-001',
        variant_count: 1,
        physical_piece_count: 1,
        status: 'active',
      },
    });
    expect(asEnvelope(first.body).request_id).toEqual(expect.any(String));
    expect(await countProductCode(seed.tenantId, seed.principalId, 'HTTP-001')).toBe(1);
  });

  it('conceals a foreign category as NOT_FOUND without exposing the foreign identifier', async () => {
    const own = await seedRouteTenant(
      'org_clt021_foreign_a',
      'user_clt021_foreign_a',
      ['assets.manage'],
    );
    const foreign = await seedRouteTenant(
      'org_clt021_foreign_b',
      'user_clt021_foreign_b',
      ['assets.manage'],
    );
    useClerk(own);

    const response = await request(createApp())
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt021-foreign-category')
      .send(validRequest(foreign.categoryId, 'FOREIGN-001'));

    expect(response.status).toBe(404);
    expectSafeError(response.body, 'NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toContain(foreign.categoryId);
    expect(await countProductCode(own.tenantId, own.principalId, 'FOREIGN-001')).toBe(0);
  });

  it('rate-limits catalogue writes to 30 requests per tenant per minute', async () => {
    const seed = await seedRouteTenant(
      'org_clt021_rate_limit',
      'user_clt021_rate_limit',
      ['assets.manage'],
    );
    useClerk(seed);
    const app = createApp();

    for (let index = 0; index < 30; index += 1) {
      const response = await request(app)
        .post('/api/v1/catalogue/clothing')
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', `clt021-rate-${index}`)
        .send({ ...validRequest(seed.categoryId, `RATE-${index}`), tenant_id: seed.tenantId });
      expect(response.status).toBe(422);
      expect(asEnvelope(response.body).error?.code).toBe('VALIDATION_FAILED');
    }

    const limited = await request(app)
      .post('/api/v1/catalogue/clothing')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'testidem05')
      .send(validRequest(seed.categoryId, 'RATE-LIMITED'));

    expect(limited.status).toBe(429);
    expectSafeError(limited.body, 'RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
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
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true LIMIT 1`,
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

  async function setTenantStatus(tenantId: string, status: 'restricted' | 'cancelled') {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`UPDATE tenant SET status = $2 WHERE id = $1`, [tenantId, status]);
    } finally {
      await admin.end();
    }
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
