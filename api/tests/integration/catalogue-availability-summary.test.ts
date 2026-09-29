import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PermissionCode } from '@drezivo/contracts';

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
process.env.OBJECT_STORAGE_REGION ??= 'test';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE ??= 'private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC ??= 'public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ??= 'test';

const PROJECTION = {
  start: '2026-10-10T00:00:00.000Z',
  end: '2026-10-12T00:00:00.000Z',
} as const;

describe('CLT-051 clothing availability summaries', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { getCatalogueClothingList } = await import('../../src/modules/catalogue/catalogue.service.js');
  const { createTestTenant } = await import('./helpers/factories.js');

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

  it('projects availability and operational signals from canonical allocation, custody, readiness, and work-order truth', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt051_projection' });
    const seeded = await seedProjectionFixture(tenant.id, 'user_clt051_projection');

    const result = await getCatalogueClothingList(
      catalogueContext(tenant.id, seeded.branchId, 'user_clt051_projection'),
      {
        limit: 20,
        sort: 'name_asc',
        availability_start: PROJECTION.start,
        availability_end: PROJECTION.end,
      },
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    if (!item) throw new Error('Expected one clothing list item.');

    expect(item.readiness).toEqual({
      active_assets: 8,
      ready: 7,
      needs_cleaning: 1,
      needs_repair: 0,
      unready: 0,
    });
    expect(item.availability).toEqual({
      window: PROJECTION,
      active_assets: 8,
      available_assets: 2,
      unavailable_assets: 6,
      reserved_assets: 1,
      rented_assets: 1,
      cleaning_assets: 2,
      maintenance_assets: 1,
      manual_blocked_assets: 1,
    });
  });

  it('does not treat released reservation allocations as occupied and removes Available when catalogue lifecycle is archived', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt051_lifecycle' });
    const seeded = await seedProjectionFixture(tenant.id, 'user_clt051_lifecycle');
    const context = catalogueContext(tenant.id, seeded.branchId, 'user_clt051_lifecycle');

    const active = await getCatalogueClothingList(context, {
      limit: 20,
      sort: 'name_asc',
      availability_start: PROJECTION.start,
      availability_end: PROJECTION.end,
    });
    expect(active.items[0]?.availability.available_assets).toBe(2);
    expect(active.items[0]?.availability.reserved_assets).toBe(1);

    await withTenantTransaction(tenant.id, 'user_clt051_lifecycle', async (client) => {
      await client.query(`UPDATE product SET status = 'archived' WHERE tenant_id = $1 AND id = $2`, [
        tenant.id,
        seeded.productId,
      ]);
    });

    const archived = await getCatalogueClothingList(context, {
      limit: 20,
      sort: 'name_asc',
      product_status: 'archived',
      availability_start: PROJECTION.start,
      availability_end: PROJECTION.end,
    });
    expect(archived.items[0]?.availability.available_assets).toBe(0);
    expect(archived.items[0]?.availability.unavailable_assets).toBe(8);
    expect(archived.items[0]?.availability.reserved_assets).toBe(1);
  });

  it('returns the exact bounded default projection window instead of persisting an Available flag', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt051_default_window' });
    const seeded = await seedProjectionFixture(tenant.id, 'user_clt051_default_window');

    const result = await getCatalogueClothingList(
      catalogueContext(tenant.id, seeded.branchId, 'user_clt051_default_window'),
      { limit: 20, sort: 'name_asc' },
    );
    const availability = result.items[0]?.availability;
    if (!availability) throw new Error('Expected an availability projection.');

    const duration = new Date(availability.window.end).getTime() - new Date(availability.window.start).getTime();
    expect(duration).toBe(24 * 60 * 60 * 1000);
    expect(availability).not.toHaveProperty('status');
  });

  function catalogueContext(tenantId: string, branchId: string, principalId: string) {
    return {
      tenantId,
      branchId,
      membershipId: '00000000-0000-4000-8000-0000000000aa',
      principalId,
      permissionCodes: ['assets.manage'] as PermissionCode[],
      effectiveTenantStatus: 'active' as const,
    };
  }

  async function seedProjectionFixture(tenantId: string, principalId: string) {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      );
      const branchId = requireId(branch.rows[0]?.id, 'branch');

      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, description, status)
         VALUES ($1, 'CLT051-GOWN', 'Projection Gown', 'CLT-051 canonical projection fixture', 'active')
         RETURNING id`,
        [tenantId],
      );
      const productId = requireId(product.rows[0]?.id, 'product');

      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, rental_price_minor,
            security_deposit_minor, currency, pricing_mode, included_duration_minutes,
            extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'CLT051-M', 'M', 'Emerald', 150000, 50000, 'PHP',
                 'fixed_duration', 4320, 50000, 60, 1440, 'active')
         RETURNING id`,
        [tenantId, productId],
      );
      const variantId = requireId(variant.rows[0]?.id, 'variant');

      const assets = await client.query<{ id: string; asset_code: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES
           ($1, $2, $3, 'CLT051-FREE', 'active', 'ready', 'at_branch'),
           ($1, $2, $3, 'CLT051-RESERVED', 'active', 'ready', 'at_branch'),
           ($1, $2, $3, 'CLT051-RENTED', 'active', 'ready', 'with_customer'),
           ($1, $2, $3, 'CLT051-CLEANING-READINESS', 'active', 'needs_cleaning', 'at_branch'),
           ($1, $2, $3, 'CLT051-REPAIR-WORK', 'active', 'ready', 'at_branch'),
           ($1, $2, $3, 'CLT051-MANUAL', 'active', 'ready', 'at_branch'),
           ($1, $2, $3, 'CLT051-RELEASED', 'active', 'ready', 'at_branch'),
           ($1, $2, $3, 'CLT051-CLEANING-WORK', 'active', 'ready', 'at_branch')
         RETURNING id, asset_code`,
        [tenantId, branchId, variantId],
      );
      const byCode = new Map(assets.rows.map((row) => [row.asset_code, row.id]));
      const reservedAssetId = requireId(byCode.get('CLT051-RESERVED'), 'reserved asset');
      const repairAssetId = requireId(byCode.get('CLT051-REPAIR-WORK'), 'repair asset');
      const manualAssetId = requireId(byCode.get('CLT051-MANUAL'), 'manual-blocked asset');
      const releasedAssetId = requireId(byCode.get('CLT051-RELEASED'), 'released asset');
      const cleaningWorkAssetId = requireId(byCode.get('CLT051-CLEANING-WORK'), 'cleaning work asset');

      const reservationLines = await seedReservationLines(client, tenantId, branchId, variantId);
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
         VALUES
           ($1, $2, $3, $4, 'reservation_confirmed', tstzrange($6::timestamptz, $7::timestamptz, '[)'), true),
           ($1, $2, $5, $8, 'reservation_hold', tstzrange($6::timestamptz, $7::timestamptz, '[)'), false)`,
        [
          tenantId,
          branchId,
          reservedAssetId,
          reservationLines.confirmedLineId,
          releasedAssetId,
          PROJECTION.start,
          PROJECTION.end,
          reservationLines.releasedLineId,
        ],
      );

      for (const work of [
        { assetId: repairAssetId, kind: 'repair', reason: 'Scheduled zipper repair' },
        { assetId: manualAssetId, kind: 'manual_block', reason: 'Owner manual block' },
        { assetId: cleaningWorkAssetId, kind: 'cleaning', reason: 'Scheduled deep clean' },
      ] as const) {
        const workOrder = await client.query<{ id: string }>(
          `INSERT INTO maintenance_work_order
             (tenant_id, branch_id, asset_id, kind, status, reason)
           VALUES ($1, $2, $3, $4, 'open', $5)
           RETURNING id`,
          [tenantId, branchId, work.assetId, work.kind, work.reason],
        );
        const maintenanceId = requireId(workOrder.rows[0]?.id, `${work.kind} work order`);
        await client.query(
          `INSERT INTO asset_allocation
             (tenant_id, branch_id, asset_id, maintenance_id, kind, period, is_blocking)
           VALUES ($1, $2, $3, $4, 'maintenance', tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
          [tenantId, branchId, work.assetId, maintenanceId, PROJECTION.start, PROJECTION.end],
        );
      }

      return { branchId, productId, variantId };
    });
  }

  async function seedReservationLines(
    client: import('pg').PoolClient,
    tenantId: string,
    branchId: string,
    variantId: string,
  ): Promise<{ confirmedLineId: string; releasedLineId: string }> {
    const storefront = await client.query<{ id: string }>(
      `INSERT INTO storefront (tenant_id, branch_id, slug, status)
       VALUES ($1, $2, $3, 'published')
       RETURNING id`,
      [tenantId, branchId, `clt051-${tenantId.slice(0, 8)}`],
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
    const policyId = requireId(policy.rows[0]?.id, 'policy snapshot');
    const payment = await client.query<{ id: string }>(
      `INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot)
       VALUES ($1, 'Cash', 'cash', '{}')
       RETURNING id`,
      [tenantId],
    );
    const paymentMethodId = requireId(payment.rows[0]?.id, 'payment method');

    const lineIds: string[] = [];
    for (const [index, reservationStatus] of ['confirmed', 'held'].entries()) {
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservation
           (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, price_snapshot,
            currency, rental_total_minor, security_required_minor, due_now_minor, hold_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 $8::timestamptz, $9::timestamptz, 'Asia/Manila', '{}',
                 'PHP', 150000, 50000, 0, now() + interval '15 minutes')
         RETURNING id`,
        [
          tenantId,
          branchId,
          storefrontId,
          policyId,
          paymentMethodId,
          `CLT051-${index + 1}`,
          reservationStatus,
          PROJECTION.start,
          PROJECTION.end,
        ],
      );
      const reservationId = requireId(reservation.rows[0]?.id, `reservation ${index + 1}`);
      const line = await client.query<{ id: string }>(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, 'Projection Gown', '{}', '{}', 150000, 50000, 'PHP')
         RETURNING id`,
        [tenantId, reservationId, variantId],
      );
      lineIds[index] = requireId(line.rows[0]?.id, `reservation line ${index + 1}`);
    }

    const confirmedLineId = lineIds[0];
    const releasedLineId = lineIds[1];
    if (!confirmedLineId || !releasedLineId) throw new Error('Expected two reservation lines.');
    return { confirmedLineId, releasedLineId };
  }
});

function requireId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Expected ${label} id.`);
  return value;
}
