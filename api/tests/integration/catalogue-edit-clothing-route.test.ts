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

describe('CLT-030 product and variant edit commands', async () => {
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

  it('updates future catalogue presentation without rewriting reservation snapshots or guide rows', async () => {
    const seed = await seedEditableCatalogue('org_clt030_edit', 'user_clt030_edit');
    useClerk(seed);
    const app = createApp();

    const productResponse = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-product-edit')
      .send({
        expected_updated_at: seed.productUpdatedAt,
        name: 'Updated Emerald Gown',
        description: 'Updated presentation for future renters.',
        category_id: seed.secondCategoryId,
      });

    expect(productResponse.status).toBe(200);
    expect(productResponse.body).toMatchObject({
      success: true,
      data: {
        product_id: seed.productId,
        name: 'Updated Emerald Gown',
        description: 'Updated presentation for future renters.',
        category: { id: seed.secondCategoryId, name: 'Formal Wear' },
        status: 'active',
      },
    });
    expect(readUpdatedAt(productResponse.body)).not.toBe(seed.productUpdatedAt);

    const variantResponse = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.variantId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-variant-edit')
      .send({
        expected_updated_at: seed.variantUpdatedAt,
        color_label: null,
        measurement: {
          measurement_mode: 'default_guide',
          measurement_guide_id: seed.secondGuideId,
          measurement_unit: 'cm',
          measurements: {},
        },
        pricing: {
          mode: 'fixed_duration',
          rental_price_minor: '25000',
          security_deposit_minor: '9000',
          extra_day_price_minor: '7000',
          included_days: 3,
          prep_minutes: 0,
          turnaround_minutes: 2880,
        },
      });

    expect(variantResponse.status).toBe(200);
    expect(variantResponse.body).toMatchObject({
      success: true,
      data: {
        variant_id: seed.variantId,
        product_id: seed.productId,
        color_label: null,
        measurement_mode: 'default_guide',
        measurement_guide_id: seed.secondGuideId,
        measurement_unit: 'cm',
        measurements: { hips: 96 },
        rental_price_minor: '25000',
        security_deposit_minor: '9000',
        pricing_mode: 'fixed_duration',
        included_duration_minutes: 4320,
        extra_day_price_minor: '7000',
        prep_minutes: 0,
        turnaround_minutes: 2880,
        status: 'active',
      },
    });
    expect(readUpdatedAt(variantResponse.body)).not.toBe(seed.variantUpdatedAt);

    const state = await readEditState(seed);
    expect(state.reservationLine).toEqual(seed.reservationSnapshot);
    expect(state.variant).toMatchObject({
      measurement_guide_id: seed.secondGuideId,
      measurement_mode: 'default_guide',
      measurements: { hips: 96 },
      rental_price_minor: 25000,
      security_deposit_minor: 9000,
      pricing_mode: 'fixed_duration',
      included_duration_minutes: 4320,
      extra_day_price_minor: 7000,
      prep_minutes: 0,
      turnaround_minutes: 2880,
    });
    expect(state.guides).toEqual([
      { id: seed.firstGuideId, name: 'Guide A', updated_at: seed.firstGuideUpdatedAt },
      { id: seed.secondGuideId, name: 'Guide B', updated_at: seed.secondGuideUpdatedAt },
    ]);
    expect(state.auditActions).toEqual([
      'catalogue.clothing.product_updated',
      'catalogue.clothing.variant_updated',
    ]);
  });

  it('persists, projects, and clears a style subcategory through edit, detail, and list reads', async () => {
    const seed = await seedEditableCatalogue('org_clt030_subcategory', 'user_clt030_subcategory');
    useClerk(seed);
    const app = createApp();
    const saved = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-subcategory-save')
      .send({ expected_updated_at: seed.productUpdatedAt, subcategory: '  LONG  ' });

    expect(saved.status).toBe(200);
    expect(readSuccessData<{ subcategory: string | null }>(saved.body).subcategory).toBe('LONG');
    const detail = await request(app).get(`/api/v1/catalogue/clothing/${seed.productId}`);
    expect(readSuccessData<{ subcategory: string | null }>(detail.body).subcategory).toBe('LONG');
    const list = await request(app).get('/api/v1/catalogue/clothing?limit=10&sort=name_asc');
    const listItems = readSuccessData<{ items: Array<{ product_id: string; subcategory: string | null }> }>(list.body).items;
    expect(listItems.find((item) => item.product_id === seed.productId)?.subcategory).toBe('LONG');
    expect((await readEditState(seed)).product.subcategory).toBe('LONG');

    const cleared = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-subcategory-clear')
      .send({ expected_updated_at: readUpdatedAt(saved.body), subcategory: null });
    expect(cleared.status).toBe(200);
    expect(readSuccessData<{ subcategory: string | null }>(cleared.body).subcategory).toBeNull();
    const clearedDetail = await request(app).get(`/api/v1/catalogue/clothing/${seed.productId}`);
    expect(readSuccessData<{ subcategory: string | null }>(clearedDetail.body).subcategory).toBeNull();
    expect((await readEditState(seed)).product.subcategory).toBeNull();
  });

  it('rejects stale product and variant edit tokens with STALE_VERSION', async () => {
    const seed = await seedEditableCatalogue('org_clt030_stale', 'user_clt030_stale');
    useClerk(seed);
    const app = createApp();

    const firstProduct = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-stale-product-first')
      .send({ expected_updated_at: seed.productUpdatedAt, name: 'First Product Edit' });
    expect(firstProduct.status).toBe(200);

    const staleProduct = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-stale-product-second')
      .send({ expected_updated_at: seed.productUpdatedAt, name: 'Stale Product Edit' });
    expect(staleProduct.status).toBe(409);
    expectSafeError(staleProduct.body, 'STALE_VERSION');

    const firstVariant = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.variantId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-stale-variant-first')
      .send({ expected_updated_at: seed.variantUpdatedAt, color_label: 'Forest Green' });
    expect(firstVariant.status).toBe(200);

    const staleVariant = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.variantId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-stale-variant-second')
      .send({ expected_updated_at: seed.variantUpdatedAt, color_label: 'Stale Green' });
    expect(staleVariant.status).toBe(409);
    expectSafeError(staleVariant.body, 'STALE_VERSION');

    const state = await readEditState(seed);
    expect(state.product.name).toBe('First Product Edit');
    expect(state.variant.color_label).toBe('Forest Green');
  });

  it('replays sequential and concurrent duplicate edit intents with one audited effect', async () => {
    const seed = await seedEditableCatalogue('org_clt030_idempotency', 'user_clt030_idempotency');
    useClerk(seed);
    const app = createApp();

    const productBody = {
      expected_updated_at: seed.productUpdatedAt,
      description: 'One durable product edit.',
    };
    const firstProduct = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-product-replay')
      .send(productBody);
    const replayedProduct = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-product-replay')
      .send(productBody);

    expect(firstProduct.status).toBe(200);
    expect(replayedProduct.status).toBe(200);
    expect(replayedProduct.body).toEqual(firstProduct.body);

    const variantBody = {
      expected_updated_at: seed.variantUpdatedAt,
      size_label: 'M-Adjusted',
    };
    const [firstVariant, duplicateVariant] = await Promise.all([
      request(app)
        .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.variantId}`)
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'clt030-variant-double-fire')
        .send(variantBody),
      request(app)
        .patch(`/api/v1/catalogue/clothing/${seed.productId}/variants/${seed.variantId}`)
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'clt030-variant-double-fire')
        .send(variantBody),
    ]);

    expect(firstVariant.status).toBe(200);
    expect(duplicateVariant.status).toBe(200);
    expect(duplicateVariant.body).toEqual(firstVariant.body);

    const auditCounts = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const rows = await client.query<{ action: string; count: number }>(
        `SELECT action, count(*)::int AS count
           FROM audit_event
          WHERE tenant_id = $1
            AND action IN ('catalogue.clothing.product_updated', 'catalogue.clothing.variant_updated')
          GROUP BY action
          ORDER BY action ASC`,
        [seed.tenantId],
      );
      return rows.rows;
    });
    expect(auditCounts).toEqual([
      { action: 'catalogue.clothing.product_updated', count: 1 },
      { action: 'catalogue.clothing.variant_updated', count: 1 },
    ]);
  });

  it('keeps the edit routes permission-scoped and rejects browser authority fields', async () => {
    const seed = await seedEditableCatalogue('org_clt030_boundary', 'user_clt030_boundary', []);
    useClerk(seed);
    const app = createApp();

    const forbidden = await request(app)
      .patch(`/api/v1/catalogue/clothing/${seed.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-no-permission') // gitleaks:allow
      .send({ expected_updated_at: seed.productUpdatedAt, name: 'Forbidden Edit' });
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');

    const allowedSeed = await seedEditableCatalogue(
      'org_clt030_strict',
      'user_clt030_strict',
      ['assets.manage'],
    );
    useClerk(allowedSeed);
    const strict = await request(createApp())
      .patch(`/api/v1/catalogue/clothing/${allowedSeed.productId}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt030-strict-body') // gitleaks:allow
      .send({
        expected_updated_at: allowedSeed.productUpdatedAt,
        name: 'Strict Edit',
        tenant_id: allowedSeed.tenantId,
      });
    expect(strict.status).toBe(422);
    expectSafeError(strict.body, 'VALIDATION_FAILED');
  });

  function useClerk(seed: { principalId: string; clerkOrgId: string }) {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }

  async function seedEditableCatalogue(
    clerkOrgId: string,
    principalId: string,
    permissions: string[] = ['assets.manage'],
  ) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');

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

      const categories = await client.query<{ id: string; name: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10), ($1, 'Formal Wear', 'active', 20)
         RETURNING id, name`,
        [tenant.id],
      );
      const firstCategoryId = requireNamedRow(categories.rows, 'Gowns').id;
      const secondCategoryId = requireNamedRow(categories.rows, 'Formal Wear').id;

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

      const guideFiles = await client.query<{ id: string; storage_key: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES
           ($1, 'measurement_guide', $2, 'guide-a-v1', $3, 'image/png', 512,
            'accepted', true, now() + interval '10 minutes', now()),
           ($1, 'measurement_guide', $4, 'guide-b-v1', $5, 'image/png', 512,
            'accepted', true, now() + interval '10 minutes', now())
         RETURNING id, storage_key`,
        [
          tenant.id,
          `${tenant.id}/guide-a.png`,
          Buffer.alloc(32, 3).toString('base64'),
          `${tenant.id}/guide-b.png`,
          Buffer.alloc(32, 4).toString('base64'),
        ],
      );
      const guideAFile = requireNamedStorageFile(guideFiles.rows, `${tenant.id}/guide-a.png`);
      const guideBFile = requireNamedStorageFile(guideFiles.rows, `${tenant.id}/guide-b.png`);
      const guides = await client.query<{ id: string; name: string; updated_at: Date }>(
        `INSERT INTO measurement_guide
           (tenant_id, file_id, name, status, is_default, created_at, updated_at)
         VALUES
           ($1, $2, 'Guide A', 'active', true, now(), now()),
           ($1, $3, 'Guide B', 'active', false, now(), now())
         RETURNING id, name, updated_at`,
        [tenant.id, guideAFile.id, guideBFile.id],
      );
      const firstGuide = requireNamedRow(guides.rows, 'Guide A');
      const secondGuide = requireNamedRow(guides.rows, 'Guide B');

      const product = await client.query<{ id: string; updated_at: Date }>(
        `INSERT INTO product
           (tenant_id, category_id, code, name, description, status, created_at, updated_at)
         VALUES ($1, $2, 'EDIT-001', 'Original Emerald Gown', 'Original description', 'active', now(), now())
         RETURNING id, updated_at`,
        [tenant.id, firstCategoryId],
      );
      const productRow = requireRow(product.rows, 'product');

      const variant = await client.query<{ id: string; updated_at: Date }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
            measurement_mode, measurement_guide_id, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes,
            turnaround_minutes, status, created_at, updated_at)
         VALUES ($1, $2, 'EDIT-001-M', 'M', 'Emerald', '{"hips":96}'::jsonb, 'cm', 'default_guide', $3,
                 10000, 5000, 'PHP', 'daily', 1440, 10000, 0, 1440, 'active', now(), now())
         RETURNING id, updated_at`,
        [tenant.id, productRow.id, firstGuide.id],
      );
      const variantRow = requireRow(variant.rows, 'variant');

      const storefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb)
         RETURNING id`,
        [tenant.id, branchId, `edit-${tenant.id.slice(0, 8)}`],
      );
      const storefrontId = requireRow(storefront.rows, 'storefront').id;
      const policy = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
            delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 'Snapshot privacy notice', now())
         RETURNING id`,
        [tenant.id, storefrontId],
      );
      const policyId = requireRow(policy.rows, 'policy snapshot').id;
      const paymentMethod = await client.query<{ id: string }>(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES ($1, 'Cash', 'cash', '{}'::jsonb, true, 1)
         RETURNING id`,
        [tenant.id],
      );
      const paymentMethodId = requireRow(paymentMethod.rows, 'payment method').id;
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservation
           (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, price_snapshot,
            currency, rental_total_minor, security_required_minor, due_now_minor,
            hold_acquired_at, hold_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'EDIT-SNAPSHOT-001', 'held',
                 now() + interval '1 day', now() + interval '3 days', 'Asia/Manila',
                 $6::jsonb, 'PHP', 10000, 5000, 15000, now(), now() + interval '15 minutes')
         RETURNING id`,
        [
          tenant.id,
          branchId,
          storefrontId,
          policyId,
          paymentMethodId,
          JSON.stringify({ mode: 'daily', rental_price_minor: '10000', security_deposit_minor: '5000' }),
        ],
      );
      const reservationId = requireRow(reservation.rows, 'reservation').id;
      const reservationSnapshot = {
        name_snapshot: 'Original Emerald Gown',
        measurements_snapshot: { source: 'Guide A', bust: 90, waist: 72 },
        pricing_snapshot: {
          mode: 'daily',
          rental_price_minor: '10000',
          security_deposit_minor: '5000',
          prep_minutes: 0,
          turnaround_minutes: 1440,
        },
        rental_minor: 10000,
        deposit_minor: 5000,
        currency: 'PHP',
      };
      await client.query(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
        [
          tenant.id,
          reservationId,
          variantRow.id,
          reservationSnapshot.name_snapshot,
          JSON.stringify(reservationSnapshot.measurements_snapshot),
          JSON.stringify(reservationSnapshot.pricing_snapshot),
          reservationSnapshot.rental_minor,
          reservationSnapshot.deposit_minor,
          reservationSnapshot.currency,
        ],
      );

      return {
        branchId,
        firstCategoryId,
        secondCategoryId,
        productId: productRow.id,
        productUpdatedAt: productRow.updated_at.toISOString(),
        variantId: variantRow.id,
        variantUpdatedAt: variantRow.updated_at.toISOString(),
        firstGuideId: firstGuide.id,
        secondGuideId: secondGuide.id,
        firstGuideUpdatedAt: firstGuide.updated_at.toISOString(),
        secondGuideUpdatedAt: secondGuide.updated_at.toISOString(),
        reservationSnapshot,
      };
    });

    return {
      tenantId: tenant.id,
      clerkOrgId: tenant.clerkOrgId,
      principalId,
      ...seeded,
    };
  }

  async function readEditState(seed: Awaited<ReturnType<typeof seedEditableCatalogue>>) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const product = await client.query<{ name: string; description: string | null; category_id: string | null; subcategory: string | null }>(
        `SELECT name, description, category_id, subcategory
           FROM product
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.productId],
      );
      const variant = await client.query<{
        color_label: string | null;
        measurement_mode: string;
        measurement_guide_id: string | null;
        measurements: Record<string, unknown>;
        rental_price_minor: number;
        security_deposit_minor: number;
        pricing_mode: string;
        included_duration_minutes: number;
        extra_day_price_minor: number;
        prep_minutes: number;
        turnaround_minutes: number;
      }>(
        `SELECT color_label, measurement_mode, measurement_guide_id, measurements, rental_price_minor,
                security_deposit_minor, pricing_mode, included_duration_minutes,
                extra_day_price_minor, prep_minutes, turnaround_minutes
           FROM product_variant
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.variantId],
      );
      const reservationLine = await client.query<{
        name_snapshot: string;
        measurements_snapshot: Record<string, unknown>;
        pricing_snapshot: Record<string, unknown>;
        rental_minor: number;
        deposit_minor: number;
        currency: string;
      }>(
        `SELECT name_snapshot, measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency
           FROM reservation_line
          WHERE tenant_id = $1 AND variant_id = $2
          LIMIT 1`,
        [seed.tenantId, seed.variantId],
      );
      const guides = await client.query<{ id: string; name: string; updated_at: Date }>(
        `SELECT id, name, updated_at
           FROM measurement_guide
          WHERE tenant_id = $1 AND id = ANY($2::uuid[])
          ORDER BY name ASC`,
        [seed.tenantId, [seed.firstGuideId, seed.secondGuideId]],
      );
      const audits = await client.query<{ action: string }>(
        `SELECT action
           FROM audit_event
          WHERE tenant_id = $1
            AND action IN ('catalogue.clothing.product_updated', 'catalogue.clothing.variant_updated')
          ORDER BY occurred_at ASC, action ASC`,
        [seed.tenantId],
      );

      return {
        product: requireRow(product.rows, 'edited product'),
        variant: requireRow(variant.rows, 'edited variant'),
        reservationLine: requireRow(reservationLine.rows, 'reservation line snapshot'),
        guides: guides.rows.map((row) => ({
          id: row.id,
          name: row.name,
          updated_at: row.updated_at.toISOString(),
        })),
        auditActions: audits.rows.map((row) => row.action),
      };
    });
  }

  function readUpdatedAt(body: unknown): string {
    const envelope = body as { data?: { updated_at?: unknown } };
    const updatedAt = envelope.data?.updated_at;
    if (typeof updatedAt !== 'string') throw new Error('Expected success response to include updated_at.');
    return updatedAt;
  }

  function readSuccessData<T>(body: unknown): T {
    if (typeof body !== 'object' || body === null || !('data' in body)) {
      throw new Error('Expected success response data.');
    }
    return (body as { data: T }).data;
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

  function requireNamedRow<T extends { name: string }>(rows: T[], name: string): T {
    const row = rows.find((candidate) => candidate.name === name);
    if (!row) throw new Error(`Expected ${name} row.`);
    return row;
  }

  function requireNamedStorageFile<T extends { storage_key: string }>(rows: T[], storageKey: string): T {
    const row = rows.find((candidate) => candidate.storage_key === storageKey);
    if (!row) throw new Error(`Expected storage file ${storageKey}.`);
    return row;
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} query to return a row.`);
    return row;
  }
});
