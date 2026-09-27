import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { clothingAvailabilityTimelineQuery, type PermissionCode } from '@drezivo/contracts';

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

const WINDOW = {
  start_date: '2026-09-27',
  end_date: '2026-10-04',
} as const;

describe('OPS-063 clothing availability timeline', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { getClothingAvailabilityTimeline } = await import(
    '../../src/modules/operations/operations.service.js'
  );
  const { createTestTenant, createTestMembership } = await import('./helpers/factories.js');

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

  it('projects continuous reservation bars, safe Unavailable reasons, and no standalone pickup or return agenda', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_ops063_projection' });
    const fixture = await seedTimelineFixture(tenant.id, 'user_ops063_projection');
    const result = await getClothingAvailabilityTimeline(
      availabilityContext(tenant.id, fixture.branchId, 'user_ops063_projection'),
      timelineQuery(WINDOW),
    );

    expect(result.timezone).toBe('Asia/Manila');
    expect(result.window).toEqual(WINDOW);
    expect(result.facets.categories).toEqual([{ id: fixture.categoryId, name: 'Gowns' }]);
    expect(result.facets.size_labels).toEqual(['M']);

    const byAsset = new Map<string, (typeof result.rows)[number]>(
      result.rows.map((row) => [row.asset.id, row]),
    );
    expect(byAsset.has(fixture.heldAssetId)).toBe(false);
    expect(byAsset.has(fixture.fittingAssetId)).toBe(false);
    expect(byAsset.has(fixture.returnedAssetId)).toBe(false);

    const reserved = requireRow(byAsset.get(fixture.reservedAssetId), 'reserved asset');
    expect(reserved.agendas).toEqual([
      expect.objectContaining({
        type: 'reserved',
        source_type: 'reservation',
        source_id: fixture.reservedReservationId,
        customer_name: 'Reserved Customer',
        pickup: {
          date: '2026-09-27',
          at: '2026-09-27T02:00:00.000Z',
        },
        return: {
          date: '2026-10-01',
          at: '2026-10-01T02:00:00.000Z',
        },
      }),
      expect.objectContaining({
        type: 'unavailable',
        unavailable_reason: 'recovery',
      }),
    ]);

    const rented = requireRow(byAsset.get(fixture.rentedAssetId), 'rented asset');
    const rentedAgenda = rented.agendas.find((agenda) => agenda.type === 'rented');
    expect(rentedAgenda).toMatchObject({
      source_type: 'reservation',
      source_id: fixture.rentedReservationId,
      customer_name: 'Reserved Customer',
      pickup: {
        date: '2026-09-27',
        at: '2026-09-27T02:00:00.000Z',
      },
      return: {
        date: '2026-10-01',
        at: '2026-10-01T02:00:00.000Z',
      },
    });
    expect(rentedAgenda?.period).toEqual({
      start: '2026-09-27T02:00:00.000Z',
      end: '2026-10-01T02:00:00.000Z',
    });
    expect(rented.agendas).toContainEqual(
      expect.objectContaining({ type: 'unavailable', unavailable_reason: 'recovery' }),
    );
    expect(rented.agendas.every((agenda) => agenda.display_lane === 0)).toBe(true);

    expect(byAsset.has(fixture.readinessAssetId)).toBe(false);
    const maintenance = requireRow(byAsset.get(fixture.maintenanceAssetId), 'maintenance asset');
    expect(maintenance.agendas).toEqual([
      expect.objectContaining({
        type: 'unavailable',
        source_type: 'maintenance',
        unavailable_reason: 'cleaning',
      }),
    ]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('asset_code');
    expect(serialized).not.toContain('sku');
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('maintenance details must remain private');
    for (const row of result.rows) {
      for (const agenda of row.agendas) {
        expect(agenda.type).not.toBe('pickup');
        expect(agenda.type).not.toBe('return');
      }
    }
  });

  it('returns filtered idle assets, isolates branch data, and keeps agenda pagination bounded to asset lanes', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_ops063_filters' });
    const fixture = await seedTimelineFixture(tenant.id, 'user_ops063_filters');
    const matchingIdleAssets = await getClothingAvailabilityTimeline(
      availabilityContext(tenant.id, fixture.branchId, 'user_ops063_filters'),
      timelineQuery({ ...WINDOW, search: 'Timeline Gown', limit: 25 }),
    );
    expect(matchingIdleAssets.rows.some((row) => row.asset.id === fixture.heldAssetId)).toBe(true);
    expect(matchingIdleAssets.rows.some((row) => row.asset.id === fixture.fittingAssetId)).toBe(true);
    expect(matchingIdleAssets.rows.some((row) => row.asset.id === fixture.returnedAssetId)).toBe(true);
    expect(
      matchingIdleAssets.rows.some(
        (row) =>
          row.asset.id === fixture.readinessAssetId &&
          row.asset.readiness === 'needs_cleaning' &&
          row.agendas.length === 0,
      ),
    ).toBe(true);
    expect(
      matchingIdleAssets.rows.some(
        (row) => row.asset.id === fixture.heldAssetId && row.agendas.length === 0,
      ),
    ).toBe(true);

    // Business-plan-sized collection: the API must still perform bounded page work for a
    // 1,000-asset tenant instead of resolving full agendas for every lane.
    await seedActiveAssets(tenant.id, fixture.branchId, fixture.variantId, 1_000);
    const secondaryBranchId = await withTenantTransaction(
      tenant.id,
      'user_ops063_filters',
      async (client) => {
        const branch = await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id, name, code, timezone)
           VALUES ($1, 'Secondary', 'SECONDARY', 'Asia/Manila')
           RETURNING id`,
          [tenant.id],
        );
        const secondary = requireId(branch.rows[0]?.id, 'secondary branch');
        await client.query(
          `INSERT INTO physical_asset
             (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
           VALUES ($1, $2, $3, 'OPS063-SECONDARY', 'active', 'needs_cleaning', 'at_branch')`,
          [tenant.id, secondary, fixture.variantId],
        );
        return secondary;
      },
    );

    const firstPage = await getClothingAvailabilityTimeline(
      availabilityContext(tenant.id, fixture.branchId, 'user_ops063_filters'),
      timelineQuery({ ...WINDOW, search: 'Timeline Gown', limit: 25 }),
    );
    expect(firstPage.rows).toHaveLength(25);
    expect(firstPage.page_meta.has_more).toBe(true);
    expect(firstPage.page_meta.next_cursor).toEqual(expect.any(String));

    const secondPage = await getClothingAvailabilityTimeline(
      availabilityContext(tenant.id, fixture.branchId, 'user_ops063_filters'),
      timelineQuery({
        ...WINDOW,
        search: 'Timeline Gown',
        limit: 25,
        cursor: requireCursor(firstPage.page_meta.next_cursor),
      }),
    );
    const firstIds = new Set(firstPage.rows.map((row) => row.asset.id));
    expect(secondPage.rows.some((row) => firstIds.has(row.asset.id))).toBe(false);

    const reserved = await getClothingAvailabilityTimeline(
      availabilityContext(tenant.id, fixture.branchId, 'user_ops063_filters'),
      timelineQuery({ ...WINDOW, status: 'reserved' }),
    );
    expect(reserved.rows.map((row) => row.asset.id)).toEqual([fixture.reservedAssetId]);
    expect(reserved.rows[0]?.agendas).toHaveLength(1);
    expect(reserved.rows[0]?.agendas[0]?.type).toBe('reserved');

    const secondary = await getClothingAvailabilityTimeline(
      availabilityContext(tenant.id, secondaryBranchId, 'user_ops063_filters'),
      timelineQuery({ ...WINDOW, search: 'Timeline Gown' }),
    );
    expect(secondary.rows).toHaveLength(1);
    expect(secondary.rows[0]?.asset.id).not.toBe(fixture.reservedAssetId);
    expect(secondary.rows[0]?.asset.readiness).toBe('needs_cleaning');
    expect(secondary.rows[0]?.agendas).toHaveLength(0);
  });

  it('rejects an operation context without the reservation-read permission', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_ops063_permission' });
    const fixture = await seedTimelineFixture(tenant.id, 'user_ops063_permission');
    await expect(
      getClothingAvailabilityTimeline(
        {
          ...availabilityContext(tenant.id, fixture.branchId, 'user_ops063_permission'),
          permissionCodes: ['assets.manage'] as PermissionCode[],
        },
        timelineQuery(WINDOW),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  function availabilityContext(tenantId: string, branchId: string, principalId: string) {
    return {
      tenantId,
      branchId,
      principalId,
      permissionCodes: ['reservations.manage'] as PermissionCode[],
    };
  }

  async function seedTimelineFixture(tenantId: string, principalId: string) {
    const actorMembershipId = await createTestMembership(tenantId, principalId, 'owner');
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      );
      const branchId = requireId(branch.rows[0]?.id, 'branch');
      const category = await client.query<{ id: string }>(
        `INSERT INTO category (tenant_id, name, display_order, status)
         VALUES ($1, 'Gowns', 1, 'active')
         RETURNING id`,
        [tenantId],
      );
      const categoryId = requireId(category.rows[0]?.id, 'category');
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, category_id, code, name, description, status)
         VALUES ($1, $2, 'OPS063-GOWN', 'Timeline Gown', 'Staff calendar fixture', 'active')
         RETURNING id`,
        [tenantId, categoryId],
      );
      const productId = requireId(product.rows[0]?.id, 'product');
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, rental_price_minor,
            security_deposit_minor, currency, pricing_mode, included_duration_minutes,
            extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'OPS063-M', 'M', 'Emerald', 150000, 50000, 'PHP',
                 'fixed_duration', 4320, 50000, 0, 0, 'active')
         RETURNING id`,
        [tenantId, productId],
      );
      const variantId = requireId(variant.rows[0]?.id, 'variant');
      const assets = await client.query<{ id: string; asset_code: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES
           ($1, $2, $3, 'OPS063-RESERVED', 'active', 'ready', 'at_branch'),
           ($1, $2, $3, 'OPS063-RENTED', 'active', 'ready', 'with_customer'),
           ($1, $2, $3, 'OPS063-READINESS', 'active', 'needs_cleaning', 'at_branch'),
           ($1, $2, $3, 'OPS063-MAINTENANCE', 'active', 'ready', 'at_branch'),
           ($1, $2, $3, 'OPS063-HELD', 'active', 'ready', 'at_branch'),
           ($1, $2, $3, 'OPS063-FITTING', 'active', 'ready', 'at_branch'),
           ($1, $2, $3, 'OPS063-RETURNED', 'active', 'ready', 'at_branch')
         RETURNING id, asset_code`,
        [tenantId, branchId, variantId],
      );
      const assetsByCode = new Map(assets.rows.map((row) => [row.asset_code, row.id]));
      const reservedAssetId = requireId(assetsByCode.get('OPS063-RESERVED'), 'reserved asset');
      const rentedAssetId = requireId(assetsByCode.get('OPS063-RENTED'), 'rented asset');
      const readinessAssetId = requireId(assetsByCode.get('OPS063-READINESS'), 'readiness asset');
      const maintenanceAssetId = requireId(assetsByCode.get('OPS063-MAINTENANCE'), 'maintenance asset');
      const heldAssetId = requireId(assetsByCode.get('OPS063-HELD'), 'held asset');
      const fittingAssetId = requireId(assetsByCode.get('OPS063-FITTING'), 'fitting asset');
      const returnedAssetId = requireId(assetsByCode.get('OPS063-RETURNED'), 'returned asset');

      const customer = await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, email)
         VALUES ($1, 'Reserved Customer', 'customer@example.com')
         RETURNING id`,
        [tenantId],
      );
      const customerId = requireId(customer.rows[0]?.id, 'customer');
      const reservationDependencies = await createReservationDependencies(
        client,
        tenantId,
        branchId,
      );
      const reserved = await createReservationAllocation(client, {
        tenantId,
        branchId,
        customerId,
        variantId,
        assetId: reservedAssetId,
        dependencies: reservationDependencies,
        status: 'confirmed',
        reference: 'OPS063-RESERVED',
        customerName: 'Reserved Customer',
        pickupAt: '2026-09-27T02:00:00.000Z',
        dueAt: '2026-10-01T02:00:00.000Z',
        allocationEnd: '2026-10-02T02:00:00.000Z',
        allocationKind: 'reservation_confirmed',
      });
      const rented = await createReservationAllocation(client, {
        tenantId,
        branchId,
        customerId,
        variantId,
        assetId: rentedAssetId,
        dependencies: reservationDependencies,
        status: 'picked_up',
        reference: 'OPS063-RENTED',
        customerName: 'Rented Customer',
        pickupAt: '2026-09-27T02:00:00.000Z',
        dueAt: '2026-10-01T02:00:00.000Z',
        allocationEnd: '2026-10-03T02:00:00.000Z',
        allocationKind: 'reservation_confirmed',
      });
      await client.query(
        `INSERT INTO custody_event
           (tenant_id, branch_id, asset_id, reservation_line_id, actor_membership_id,
            event_kind, occurred_at, condition_snapshot, business_key)
         VALUES ($1, $2, $3, $4, $5, 'pickup', '2026-09-27T05:00:00.000Z', '{}', $6)`,
        [
          tenantId,
          branchId,
          rentedAssetId,
          rented.lineId,
          actorMembershipId,
          `pickup:${rented.reservationId}`,
        ],
      );
      await createReservationAllocation(client, {
        tenantId,
        branchId,
        customerId,
        variantId,
        assetId: heldAssetId,
        dependencies: reservationDependencies,
        status: 'held',
        reference: 'OPS063-HELD',
        customerName: 'Held Customer',
        pickupAt: '2026-09-28T02:00:00.000Z',
        dueAt: '2026-10-01T02:00:00.000Z',
        allocationEnd: '2026-10-01T02:00:00.000Z',
        allocationKind: 'reservation_hold',
      });
      await createReservationAllocation(client, {
        tenantId,
        branchId,
        customerId,
        variantId,
        assetId: returnedAssetId,
        dependencies: reservationDependencies,
        status: 'returned',
        reference: 'OPS063-RETURNED',
        customerName: 'Returned Customer',
        pickupAt: '2026-09-28T02:00:00.000Z',
        dueAt: '2026-10-01T02:00:00.000Z',
        allocationEnd: '2026-10-01T02:00:00.000Z',
        allocationKind: 'reservation_confirmed',
      });

      const workOrder = await client.query<{ id: string }>(
        `INSERT INTO maintenance_work_order
           (tenant_id, branch_id, asset_id, kind, status, reason)
         VALUES ($1, $2, $3, 'cleaning', 'open', 'maintenance details must remain private')
         RETURNING id`,
        [tenantId, branchId, maintenanceAssetId],
      );
      const workOrderId = requireId(workOrder.rows[0]?.id, 'maintenance work order');
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, maintenance_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'maintenance',
                 tstzrange('2026-09-29T02:00:00.000Z', '2026-09-30T02:00:00.000Z', '[)'), true)`,
        [tenantId, branchId, maintenanceAssetId, workOrderId],
      );
      await createFittingAllocation(client, {
        tenantId,
        branchId,
        customerId,
        variantId,
        assetId: fittingAssetId,
      });

      return {
        branchId,
        categoryId,
        variantId,
        reservedAssetId,
        reservedReservationId: reserved.reservationId,
        rentedAssetId,
        rentedReservationId: rented.reservationId,
        readinessAssetId,
        maintenanceAssetId,
        heldAssetId,
        fittingAssetId,
        returnedAssetId,
      };
    });
  }

  async function createReservationDependencies(
    client: import('pg').PoolClient,
    tenantId: string,
    branchId: string,
  ) {
    const storefront = await client.query<{ id: string }>(
      `INSERT INTO storefront (tenant_id, branch_id, slug, status)
       VALUES ($1, $2, $3, 'published')
       RETURNING id`,
      [tenantId, branchId, `ops063-${tenantId.slice(0, 8)}`],
    );
    const storefrontId = requireId(storefront.rows[0]?.id, 'storefront');
    const policy = await client.query<{ id: string }>(
      `INSERT INTO policy_snapshot
         (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
          delivery_rules, privacy_notice, effective_at)
       VALUES ($1, $2, 1, '{}', '{}', '{}', '{}', 'Test privacy notice', now())
       RETURNING id`,
      [tenantId, storefrontId],
    );
    const payment = await client.query<{ id: string }>(
      `INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot)
       VALUES ($1, 'Cash', 'cash', '{}')
       RETURNING id`,
      [tenantId],
    );
    return {
      storefrontId,
      policySnapshotId: requireId(policy.rows[0]?.id, 'policy snapshot'),
      paymentMethodId: requireId(payment.rows[0]?.id, 'payment method'),
    };
  }

  async function createReservationAllocation(
    client: import('pg').PoolClient,
    input: {
      tenantId: string;
      branchId: string;
      customerId: string;
      variantId: string;
      assetId: string;
      dependencies: { storefrontId: string; policySnapshotId: string; paymentMethodId: string };
      status: 'held' | 'confirmed' | 'picked_up' | 'returned';
      reference: string;
      customerName: string;
      pickupAt: string;
      dueAt: string;
      allocationEnd: string;
      allocationKind: 'reservation_hold' | 'reservation_confirmed';
    },
  ): Promise<{ reservationId: string; lineId: string }> {
    const reservation = await client.query<{ id: string }>(
      `INSERT INTO reservation
         (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id, payment_method_id,
          reference_code, status, pickup_at, due_at, timezone_snapshot, customer_snapshot,
          price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor,
          hold_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               $9::timestamptz, $10::timestamptz, 'Asia/Manila', $11::jsonb,
               '{}', 'PHP', 150000, 50000, 0, now() + interval '15 minutes')
       RETURNING id`,
      [
        input.tenantId,
        input.branchId,
        input.customerId,
        input.dependencies.storefrontId,
        input.dependencies.policySnapshotId,
        input.dependencies.paymentMethodId,
        input.reference,
        input.status,
        input.pickupAt,
        input.dueAt,
        JSON.stringify({ full_name: input.customerName }),
      ],
    );
    const reservationId = requireId(reservation.rows[0]?.id, `${input.reference} reservation`);
    const line = await client.query<{ id: string }>(
      `INSERT INTO reservation_line
         (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
          measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
       VALUES ($1, $2, $3, 1, 'Timeline Gown', '{}', '{}', 150000, 50000, 'PHP')
       RETURNING id`,
      [input.tenantId, reservationId, input.variantId],
    );
    const lineId = requireId(line.rows[0]?.id, `${input.reference} line`);
    await client.query(
      `INSERT INTO asset_allocation
         (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
       VALUES ($1, $2, $3, $4, $5,
               tstzrange($6::timestamptz, $7::timestamptz, '[)'), true)`,
      [
        input.tenantId,
        input.branchId,
        input.assetId,
        lineId,
        input.allocationKind,
        input.pickupAt,
        input.allocationEnd,
      ],
    );
    return { reservationId, lineId };
  }

  async function createFittingAllocation(
    client: import('pg').PoolClient,
    input: { tenantId: string; branchId: string; customerId: string; variantId: string; assetId: string },
  ): Promise<void> {
    const periodStart = '2026-09-29T05:00:00.000Z';
    const periodEnd = '2026-09-29T06:00:00.000Z';
    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency)
       VALUES ($1, $2, true, 1, 60, 0, 'PHP')`,
      [input.tenantId, input.branchId],
    );
    const slot = await client.query<{ id: string }>(
      `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number)
       VALUES ($1, $2, 1)
       RETURNING id`,
      [input.tenantId, input.branchId],
    );
    const slotId = requireId(slot.rows[0]?.id, 'fitting capacity slot');
    const fitting = await client.query<{ id: string }>(
      `INSERT INTO fitting_appointment
         (tenant_id, branch_id, customer_id, booking_channel, status, period,
          timezone_snapshot, currency, fee_minor, business_key, version)
       VALUES ($1, $2, $3, 'staff', 'pending', tstzrange($4::timestamptz, $5::timestamptz, '[)'),
               'Asia/Manila', 'PHP', 0, $6, 1)
       RETURNING id`,
      [
        input.tenantId,
        input.branchId,
        input.customerId,
        periodStart,
        periodEnd,
        `ops063-fitting:${randomUUID()}`,
      ],
    );
    const fittingId = requireId(fitting.rows[0]?.id, 'fitting appointment');
    const line = await client.query<{ id: string }>(
      `INSERT INTO fitting_line (tenant_id, fitting_id, variant_id, asset_id, garment_guaranteed)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [input.tenantId, fittingId, input.variantId, input.assetId],
    );
    const lineId = requireId(line.rows[0]?.id, 'fitting line');
    await client.query(
      `INSERT INTO fitting_slot_allocation (tenant_id, slot_id, fitting_id, period, is_blocking)
       VALUES ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), true)`,
      [input.tenantId, slotId, fittingId, periodStart, periodEnd],
    );
    await client.query(
      `INSERT INTO asset_allocation
         (tenant_id, branch_id, asset_id, fitting_line_id, kind, period, is_blocking)
       VALUES ($1, $2, $3, $4, 'fitting', tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
      [input.tenantId, input.branchId, input.assetId, lineId, periodStart, periodEnd],
    );
  }

  async function seedActiveAssets(
    tenantId: string,
    branchId: string,
    variantId: string,
    count: number,
  ): Promise<void> {
    await withTenantTransaction(tenantId, 'user_ops063_filters', async (client) => {
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         SELECT $1::uuid, $2::uuid, $3::uuid,
                'OPS063-PAGE-' || series::text, 'active', 'ready', 'at_branch'
           FROM generate_series(1, $4::int) AS series`,
        [tenantId, branchId, variantId, count],
      );
    });
  }
});

function requireId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Expected ${label} id.`);
  return value;
}

function requireRow<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`Expected ${label}.`);
  return value;
}

function requireCursor(value: string | null): string {
  if (!value) throw new Error('Expected a next-page cursor.');
  return value;
}

function timelineQuery(input: {
  start_date: string;
  end_date: string;
  search?: string;
  category_id?: string;
  size_label?: string;
  status?: 'reserved' | 'rented' | 'unavailable';
  cursor?: string;
  limit?: number;
}) {
  return clothingAvailabilityTimelineQuery.parse(input);
}
