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

describe('CLT-031 physical asset lifecycle/readiness safety', async () => {
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

  it('keeps reservation allocation authoritative when readiness changes and creates disruption for threatened future work', async () => {
    const seed = await seedAssetFixture('org_clt031_readiness', 'user_clt031_readiness', {
      withReservation: true,
    });
    useClerk(seed);
    const app = createApp();

    const unready = await request(app)
      .patch(`/api/v1/catalogue/assets/${seed.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-needs-repair')
      .send({
        expected_version: 1,
        readiness: 'needs_repair',
        condition_note: 'Zipper needs repair before the next booking.',
      });

    expect(unready.status).toBe(200);
    expect(unready.body).toMatchObject({
      success: true,
      data: {
        asset: {
          id: seed.assetId,
          lifecycle_status: 'active',
          readiness: 'needs_repair',
          custody_kind: 'at_branch',
          version: 2,
        },
        blocking_allocation_count: 1,
        disruptions_created: 1,
      },
    });

    const afterUnready = await readAssetState(seed);
    expect(afterUnready.allocations).toEqual([
      expect.objectContaining({
        id: seed.reservationAllocationId,
        kind: 'reservation_confirmed',
        is_blocking: true,
        reservation_line_id: seed.reservationLineId,
        maintenance_id: null,
      }),
    ]);
    expect(afterUnready.disruptions).toHaveLength(1);
    expect(afterUnready.disruptions[0]).toMatchObject({
      reservation_line_id: seed.reservationLineId,
      status: 'open',
    });

    const readyAgain = await request(app)
      .patch(`/api/v1/catalogue/assets/${seed.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-ready-again')
      .send({ expected_version: 2, readiness: 'ready' });

    expect(readyAgain.status).toBe(200);
    expect(readyAgain.body).toMatchObject({
      success: true,
      data: {
        asset: { readiness: 'ready', custody_kind: 'at_branch', version: 3 },
        blocking_allocation_count: 1,
        disruptions_created: 0,
      },
    });

    const afterReady = await readAssetState(seed);
    expect(afterReady.allocations).toHaveLength(1);
    expect(afterReady.allocations[0]?.is_blocking).toBe(true);
    expect(afterReady.disruptions).toHaveLength(1);
    expect(afterReady.asset.custody_kind).toBe('at_branch');
  });

  it('lets Clothing mark a recovery-managed returned garment ready early without shortening its rental period', async () => {
    const seed = await seedAssetFixture('org_clt031_recovery_ready', 'user_clt031_recovery_ready', {
      readiness: 'needs_cleaning',
      recoveryManagedReadiness: true,
      withReservation: true,
      reservationStatus: 'returned',
    });
    useClerk(seed);

    const before = await readAssetState(seed);
    const beforeEnd = before.allocations[0]?.ends_at;
    expect(before.asset).toMatchObject({
      readiness: 'needs_cleaning',
      recovery_managed_readiness: true,
    });
    expect(beforeEnd).toBeInstanceOf(Date);
    expect(beforeEnd?.getTime()).toBeGreaterThan(Date.now());

    const ready = await request(createApp())
      .patch(`/api/v1/catalogue/assets/${seed.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-recovery-ready-early')
      .send({ expected_version: 1, readiness: 'ready' });

    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({
      success: true,
      data: {
        asset: { readiness: 'ready', custody_kind: 'at_branch', version: 2 },
        blocking_allocation_count: 1,
      },
    });

    const after = await readAssetState(seed);
    const afterEnd = after.allocations[0]?.ends_at;
    const dueAt = after.allocations[0]?.reservation_due_at;
    expect(after.asset).toMatchObject({
      readiness: 'ready',
      recovery_managed_readiness: false,
    });
    expect(afterEnd).toBeInstanceOf(Date);
    expect(dueAt).toBeInstanceOf(Date);
    expect(afterEnd?.getTime()).toBeGreaterThanOrEqual(dueAt?.getTime() ?? 0);
    expect(afterEnd?.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('does not let generic Clothing edits mark an asset ready while maintenance remains open', async () => {
    const seed = await seedAssetFixture('org_clt031_ready_maintenance', 'user_clt031_ready_maintenance', {
      readiness: 'needs_repair',
    });
    useClerk(seed);
    const app = createApp();
    const maintenance = await request(app)
      .post(`/api/v1/catalogue/assets/${seed.assetId}/maintenance-blocks`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-ready-maintenance-block')
      .send({
        kind: 'repair',
        period: { start: futureIso(1), end: futureIso(24) },
        reason: 'Repair must finish before this garment is ready.',
      });
    expect(maintenance.status).toBe(201);

    const ready = await request(app)
      .patch(`/api/v1/catalogue/assets/${seed.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-ready-with-open-maintenance')
      .send({ expected_version: 1, readiness: 'ready' });

    expect(ready.status).toBe(409);
    expectSafeError(ready.body, 'STATE_CONFLICT');
    expect((await readAssetState(seed)).asset.readiness).toBe('needs_repair');
  });

  it('keeps custody transitions out of generic Clothing edits and guards retirement lifecycle transitions', async () => {
    const withCustomer = await seedAssetFixture('org_clt031_custody', 'user_clt031_custody', {
      custodyKind: 'with_customer',
    });
    useClerk(withCustomer);
    const app = createApp();

    const browserCustodyOverride = await request(app)
      .patch(`/api/v1/catalogue/assets/${withCustomer.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-custody-body') // gitleaks:allow
      .send({
        expected_version: 1,
        readiness: 'ready',
        custody_kind: 'at_branch',
      });
    expect(browserCustodyOverride.status).toBe(422);
    expectSafeError(browserCustodyOverride.body, 'VALIDATION_FAILED');

    const markReady = await request(app)
      .patch(`/api/v1/catalogue/assets/${withCustomer.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-custody-ready')
      .send({ expected_version: 1, readiness: 'ready' });
    expect(markReady.status).toBe(409);
    expectSafeError(markReady.body, 'UNRESOLVED_CUSTODY');

    const retireInCustomerCustody = await request(app)
      .patch(`/api/v1/catalogue/assets/${withCustomer.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-custody-retire') // gitleaks:allow
      .send({ expected_version: 1, lifecycle_status: 'retired' });
    expect(retireInCustomerCustody.status).toBe(409);
    expectSafeError(retireInCustomerCustody.body, 'UNRESOLVED_CUSTODY');

    const safelyRetired = await seedAssetFixture('org_clt031_retire', 'user_clt031_retire');
    useClerk(safelyRetired);
    const retire = await request(createApp())
      .patch(`/api/v1/catalogue/assets/${safelyRetired.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-retire-safe') // gitleaks:allow
      .send({ expected_version: 1, lifecycle_status: 'retired' });
    expect(retire.status).toBe(200);
    expect(retire.body).toMatchObject({
      success: true,
      data: {
        asset: {
          lifecycle_status: 'retired',
          readiness: 'unready',
          custody_kind: 'at_branch',
          version: 2,
        },
      },
    });

    const reactivate = await request(createApp())
      .patch(`/api/v1/catalogue/assets/${safelyRetired.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-reactivate-rejected')
      .send({ expected_version: 2, lifecycle_status: 'active' });
    expect(reactivate.status).toBe(409);
    expectSafeError(reactivate.body, 'STATE_CONFLICT');
  });

  it('creates canonical work-order/allocation downtime atomically and rejects overlap without an orphan work order', async () => {
    const seed = await seedAssetFixture('org_clt031_maintenance', 'user_clt031_maintenance');
    useClerk(seed);
    const app = createApp();
    const firstPeriod = { start: futureIso(24), end: futureIso(72) };

    const created = await request(app)
      .post(`/api/v1/catalogue/assets/${seed.assetId}/maintenance-blocks`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-maintenance-create')
      .send({
        kind: 'repair',
        period: firstPeriod,
        reason: 'Replace damaged zipper.',
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      success: true,
      data: {
        asset_id: seed.assetId,
        branch_id: seed.branchId,
        kind: 'repair',
        status: 'open',
        is_blocking: true,
      },
    });

    const firstState = await readAssetState(seed);
    expect(firstState.workOrders).toHaveLength(1);
    expect(firstState.workOrders[0]).toMatchObject({ kind: 'repair', status: 'open' });
    expect(firstState.allocations).toHaveLength(1);
    expect(firstState.allocations[0]).toMatchObject({
      kind: 'maintenance',
      is_blocking: true,
      reservation_line_id: null,
      maintenance_id: firstState.workOrders[0]?.id,
    });

    const overlap = await request(app)
      .post(`/api/v1/catalogue/assets/${seed.assetId}/maintenance-blocks`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-maintenance-overlap')
      .send({
        kind: 'manual_block',
        period: { start: futureIso(48), end: futureIso(96) },
        reason: 'Manual unavailable window.',
      });

    expect(overlap.status).toBe(409);
    expectSafeError(overlap.body, 'CAPACITY_CONFLICT');

    const afterConflict = await readAssetState(seed);
    expect(afterConflict.workOrders).toHaveLength(1);
    expect(afterConflict.allocations).toHaveLength(1);
  });

  it('uses optimistic asset versions and replays a duplicate state intent without a second effect', async () => {
    const seed = await seedAssetFixture('org_clt031_state_idem', 'user_clt031_state_idem');
    useClerk(seed);
    const app = createApp();
    const body = { expected_version: 1, readiness: 'needs_cleaning' };

    const first = await request(app)
      .patch(`/api/v1/catalogue/assets/${seed.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-state-replay')
      .send(body);
    const replay = await request(app)
      .patch(`/api/v1/catalogue/assets/${seed.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-state-replay')
      .send(body);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const stale = await request(app)
      .patch(`/api/v1/catalogue/assets/${seed.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-state-stale')
      .send({ expected_version: 1, readiness: 'needs_repair' });
    expect(stale.status).toBe(409);
    expectSafeError(stale.body, 'STALE_VERSION');

    const state = await readAssetState(seed);
    expect(state.asset.version).toBe(2);
    expect(state.asset.readiness).toBe('needs_cleaning');
    expect(state.auditCounts).toContainEqual({ action: 'catalogue.asset.state_updated', count: 1 });
  });

  it('collapses concurrent maintenance double-fire into one work order, one allocation, and one audit effect', async () => {
    const seed = await seedAssetFixture('org_clt031_maintenance_idem', 'user_clt031_maintenance_idem');
    useClerk(seed);
    const app = createApp();
    const body = {
      kind: 'cleaning',
      period: { start: futureIso(120), end: futureIso(144) },
      reason: 'Scheduled deep cleaning.',
    };

    const [first, duplicate] = await Promise.all([
      request(app)
        .post(`/api/v1/catalogue/assets/${seed.assetId}/maintenance-blocks`)
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'clt031-maintenance-double-fire') // gitleaks:allow
        .send(body),
      request(app)
        .post(`/api/v1/catalogue/assets/${seed.assetId}/maintenance-blocks`)
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'clt031-maintenance-double-fire') // gitleaks:allow
        .send(body),
    ]);

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body).toEqual(first.body);

    const state = await readAssetState(seed);
    expect(state.workOrders).toHaveLength(1);
    expect(state.allocations).toHaveLength(1);
    expect(state.auditCounts).toContainEqual({
      action: 'catalogue.asset.maintenance_block_created',
      count: 1,
    });
  });

  it('enforces branch permission and conceals foreign assets', async () => {
    const forbiddenSeed = await seedAssetFixture('org_clt031_forbidden', 'user_clt031_forbidden', {
      permissions: [],
    });
    useClerk(forbiddenSeed);

    const forbidden = await request(createApp())
      .patch(`/api/v1/catalogue/assets/${forbiddenSeed.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-no-permission') // gitleaks:allow
      .send({ expected_version: 1, readiness: 'unready' });
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');

    const own = await seedAssetFixture('org_clt031_own', 'user_clt031_own');
    const foreign = await seedAssetFixture('org_clt031_foreign', 'user_clt031_foreign');
    useClerk(own);
    const concealed = await request(createApp())
      .patch(`/api/v1/catalogue/assets/${foreign.assetId}/state`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'clt031-foreign-asset')
      .send({ expected_version: 1, readiness: 'unready' });
    expect(concealed.status).toBe(404);
    expectSafeError(concealed.body, 'NOT_FOUND');
  });

  function useClerk(seed: { principalId: string; clerkOrgId: string }) {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }

  async function seedAssetFixture(
    clerkOrgId: string,
    principalId: string,
    options: {
      permissions?: string[];
      custodyKind?: 'at_branch' | 'with_customer' | 'in_transit';
      readiness?: 'ready' | 'needs_cleaning' | 'needs_repair' | 'unready';
      recoveryManagedReadiness?: boolean;
      withReservation?: boolean;
      reservationStatus?: 'confirmed' | 'returned';
    } = {},
  ) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    const permissions = options.permissions ?? ['assets.manage'];
    const custodyKind = options.custodyKind ?? 'at_branch';
    const readiness = options.readiness ?? 'ready';
    const recoveryManagedReadiness = options.recoveryManagedReadiness ?? false;
    const reservationStatus = options.reservationStatus ?? 'confirmed';

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

      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, status, display_order)
         VALUES ($1, 'Gowns', 'active', 10)
         RETURNING id`,
        [tenant.id],
      );
      const categoryId = requireRow(category.rows, 'category').id;
      const product = await client.query<{ id: string }>(
        `INSERT INTO product
           (tenant_id, category_id, code, name, description, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'CLT-031 Test Gown', 'Lifecycle safety fixture', 'active', now(), now())
         RETURNING id`,
        [tenant.id, categoryId, `CLT031-${tenant.id.slice(0, 8)}`],
      );
      const productId = requireRow(product.rows, 'product').id;
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit,
            measurement_mode, measurement_guide_id, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes,
            turnaround_minutes, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'M', NULL, '{}'::jsonb, 'cm', 'none', NULL,
                 10000, 5000, 'PHP', 'daily', 1440, 10000, 0, 1440, 'active', now(), now())
         RETURNING id`,
        [tenant.id, productId, `CLT031-${tenant.id.slice(0, 8)}-M`],
      );
      const variantId = requireRow(variant.rows, 'variant').id;
      const asset = await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness,
            recovery_managed_readiness, custody_kind, measurement_overrides, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, '{}'::jsonb, 1, now(), now())
         RETURNING id`,
        [
          tenant.id,
          branchId,
          variantId,
          `AST-${tenant.id.slice(0, 8)}`,
          readiness,
          recoveryManagedReadiness,
          custodyKind,
        ],
      );
      const assetId = requireRow(asset.rows, 'physical asset').id;

      let reservationLineId: string | null = null;
      let reservationAllocationId: string | null = null;
      if (options.withReservation) {
        const storefront = await client.query<{ id: string }>(
          `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
           VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb)
           RETURNING id`,
          [tenant.id, branchId, `clt031-${tenant.id.slice(0, 8)}`],
        );
        const storefrontId = requireRow(storefront.rows, 'storefront').id;
        const policy = await client.query<{ id: string }>(
          `INSERT INTO policy_snapshot
             (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
              delivery_rules, privacy_notice, effective_at)
           VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                   'CLT-031 privacy notice', now())
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
        const pickupAt = reservationStatus === 'returned' ? futureIso(-72) : futureIso(48);
        const dueAt = reservationStatus === 'returned' ? futureIso(-1) : futureIso(96);
        const reservation = await client.query<{ id: string }>(
          `INSERT INTO reservation
             (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
              reference_code, status, pickup_at, due_at, timezone_snapshot, price_snapshot,
              currency, rental_total_minor, security_required_minor, due_now_minor,
              hold_acquired_at, confirmed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Asia/Manila',
                   '{}'::jsonb, 'PHP', 10000, 5000, 15000, now(), now())
           RETURNING id`,
          [
            tenant.id,
            branchId,
            storefrontId,
            policyId,
            paymentMethodId,
            `CLT031-${tenant.id.slice(0, 8)}`,
            reservationStatus,
            pickupAt,
            dueAt,
          ],
        );
        const reservationId = requireRow(reservation.rows, 'reservation').id;
        const reservationLine = await client.query<{ id: string }>(
          `INSERT INTO reservation_line
             (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
              measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
           VALUES ($1, $2, $3, 1, 'CLT-031 Test Gown', '{}'::jsonb, '{}'::jsonb,
                   10000, 5000, 'PHP')
           RETURNING id`,
          [tenant.id, reservationId, variantId],
        );
        reservationLineId = requireRow(reservationLine.rows, 'reservation line').id;
        const allocation = await client.query<{ id: string }>(
          `INSERT INTO asset_allocation
             (tenant_id, branch_id, asset_id, reservation_line_id, kind, period,
              is_blocking, released_at, created_at)
           VALUES ($1, $2, $3, $4, 'reservation_confirmed',
                   tstzrange($5::timestamptz, $6::timestamptz, '[)'), true, NULL, now())
           RETURNING id`,
          [
            tenant.id,
            branchId,
            assetId,
            reservationLineId,
            reservationStatus === 'returned' ? futureIso(-72) : futureIso(24),
            reservationStatus === 'returned' ? futureIso(23) : futureIso(120),
          ],
        );
        reservationAllocationId = requireRow(allocation.rows, 'reservation allocation').id;
      }

      return {
        branchId,
        productId,
        variantId,
        assetId,
        reservationLineId,
        reservationAllocationId,
      };
    });

    return {
      tenantId: tenant.id,
      clerkOrgId: tenant.clerkOrgId,
      principalId,
      ...seeded,
    };
  }

  async function readAssetState(seed: Awaited<ReturnType<typeof seedAssetFixture>>) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const asset = await client.query<{
        lifecycle_status: string;
        readiness: string;
        recovery_managed_readiness: boolean;
        custody_kind: string;
        condition_note: string | null;
        version: number;
      }>(
        `SELECT lifecycle_status, readiness, recovery_managed_readiness, custody_kind, condition_note, version
           FROM physical_asset
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.assetId],
      );
      const allocations = await client.query<{
        id: string;
        reservation_line_id: string | null;
        maintenance_id: string | null;
        kind: string;
        is_blocking: boolean;
        ends_at: Date;
        reservation_due_at: Date | null;
      }>(
        `SELECT aa.id, aa.reservation_line_id, aa.maintenance_id, aa.kind, aa.is_blocking,
                upper(aa.period) AS ends_at, r.due_at AS reservation_due_at
           FROM asset_allocation aa
           LEFT JOIN reservation_line rl
             ON rl.tenant_id = aa.tenant_id
            AND rl.id = aa.reservation_line_id
           LEFT JOIN reservation r
             ON r.tenant_id = rl.tenant_id
            AND r.id = rl.reservation_id
          WHERE aa.tenant_id = $1 AND aa.asset_id = $2
          ORDER BY aa.created_at ASC, aa.id ASC`,
        [seed.tenantId, seed.assetId],
      );
      const workOrders = await client.query<{ id: string; kind: string; status: string }>(
        `SELECT id, kind, status
           FROM maintenance_work_order
          WHERE tenant_id = $1 AND asset_id = $2
          ORDER BY opened_at ASC, id ASC`,
        [seed.tenantId, seed.assetId],
      );
      const disruptions = await client.query<{ reservation_line_id: string; status: string }>(
        `SELECT reservation_line_id, status
           FROM disruption
          WHERE tenant_id = $1 AND asset_id = $2
          ORDER BY created_at ASC, id ASC`,
        [seed.tenantId, seed.assetId],
      );
      const audits = await client.query<{ action: string; count: number }>(
        `SELECT action, count(*)::int AS count
           FROM audit_event
          WHERE tenant_id = $1
            AND entity_id = $2
            AND action IN ('catalogue.asset.state_updated', 'catalogue.asset.maintenance_block_created')
          GROUP BY action
          ORDER BY action ASC`,
        [seed.tenantId, seed.assetId],
      );

      return {
        asset: requireRow(asset.rows, 'asset state'),
        allocations: allocations.rows,
        workOrders: workOrders.rows,
        disruptions: disruptions.rows,
        auditCounts: audits.rows,
      };
    });
  }

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60 * 1_000).toISOString();
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

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} query to return a row.`);
    return row;
  }
});
