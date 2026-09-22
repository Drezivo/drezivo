import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { BranchId, ProductVariantId, TenantId } from '@drezivo/contracts';

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

const BLOCKED_INTERVAL = {
  start: '2026-10-10T10:00:00.000Z',
  end: '2026-10-13T10:00:00.000Z',
} as const;

describe('CLT-050 catalogue reservation allocation handoff', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { resolveReservationCatalogueSelection } = await import(
    '../../src/modules/catalogue/catalogue-allocation.service.js'
  );
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

  it('returns only concrete eligible serialized assets for the tenant, branch, variant, and interval', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt050_candidates' });
    const seeded = await seedCatalogue(tenant.id, 'user_clt050_candidates', { withBlockedAsset: true });

    const selection = await withTenantTransaction(tenant.id, 'user_clt050_candidates', (client) =>
      resolveReservationCatalogueSelection(client, {
        tenantId: tenant.id as TenantId,
        branchId: seeded.branchId as BranchId,
        variantId: seeded.variantId as ProductVariantId,
        blockedInterval: BLOCKED_INTERVAL,
      }),
    );

    expect(selection).not.toBeNull();
    expect(selection).toMatchObject({
      product_id: seeded.productId,
      variant_id: seeded.variantId,
      branch_id: seeded.branchId,
    });
    expect(selection?.candidate_asset_ids).toEqual([seeded.readyFreeAssetId]);
    expect(selection?.candidate_asset_ids).not.toContain(seeded.readyBlockedAssetId);
    expect(selection?.candidate_asset_ids).not.toContain(seeded.needsCleaningAssetId);
    expect(selection?.candidate_asset_ids).not.toContain(seeded.retiredAssetId);
    expect(selection?.candidate_asset_ids).not.toContain(seeded.otherBranchAssetId);
    expect(selection).not.toHaveProperty('quantity');
    expect(selection).not.toHaveProperty('available_units');

    const otherBranchSelection = await withTenantTransaction(
      tenant.id,
      'user_clt050_candidates',
      (client) =>
        resolveReservationCatalogueSelection(client, {
          tenantId: tenant.id as TenantId,
          branchId: seeded.otherBranchId as BranchId,
          variantId: seeded.variantId as ProductVariantId,
          blockedInterval: BLOCKED_INTERVAL,
        }),
    );
    expect(otherBranchSelection?.candidate_asset_ids).toEqual([seeded.otherBranchAssetId]);

    const foreignTenant = await createTestTenant({ clerkOrgId: 'org_clt050_foreign' });
    const concealed = await withTenantTransaction(foreignTenant.id, 'user_clt050_foreign', (client) =>
      resolveReservationCatalogueSelection(client, {
        tenantId: foreignTenant.id as TenantId,
        branchId: seeded.branchId as BranchId,
        variantId: seeded.variantId as ProductVariantId,
        blockedInterval: BLOCKED_INTERVAL,
      }),
    );
    expect(concealed).toBeNull();
  });

  it('requires active product, variant, and branch but does not turn current custody into a stock counter', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt050_lifecycle' });
    const seeded = await seedCatalogue(tenant.id, 'user_clt050_lifecycle');

    await withTenantTransaction(tenant.id, 'user_clt050_lifecycle', async (client) => {
      await client.query(
        `UPDATE physical_asset SET custody_kind = 'with_customer' WHERE tenant_id = $1 AND id = $2`,
        [tenant.id, seeded.readyFreeAssetId],
      );
    });

    const withCustomer = await withTenantTransaction(tenant.id, 'user_clt050_lifecycle', (client) =>
      resolveReservationCatalogueSelection(client, {
        tenantId: tenant.id as TenantId,
        branchId: seeded.branchId as BranchId,
        variantId: seeded.variantId as ProductVariantId,
        blockedInterval: BLOCKED_INTERVAL,
      }),
    );
    expect(withCustomer?.candidate_asset_ids).toContain(seeded.readyFreeAssetId);

    await withTenantTransaction(tenant.id, 'user_clt050_lifecycle', async (client) => {
      await client.query(`UPDATE product_variant SET status = 'archived' WHERE tenant_id = $1 AND id = $2`, [
        tenant.id,
        seeded.variantId,
      ]);
    });
    const archivedVariant = await withTenantTransaction(tenant.id, 'user_clt050_lifecycle', (client) =>
      resolveReservationCatalogueSelection(client, {
        tenantId: tenant.id as TenantId,
        branchId: seeded.branchId as BranchId,
        variantId: seeded.variantId as ProductVariantId,
        blockedInterval: BLOCKED_INTERVAL,
      }),
    );
    expect(archivedVariant).toBeNull();

    await withTenantTransaction(tenant.id, 'user_clt050_lifecycle', async (client) => {
      await client.query(`UPDATE product_variant SET status = 'active' WHERE tenant_id = $1 AND id = $2`, [
        tenant.id,
        seeded.variantId,
      ]);
      await client.query(`UPDATE product SET status = 'archived' WHERE tenant_id = $1 AND id = $2`, [
        tenant.id,
        seeded.productId,
      ]);
    });
    const archivedProduct = await withTenantTransaction(tenant.id, 'user_clt050_lifecycle', (client) =>
      resolveReservationCatalogueSelection(client, {
        tenantId: tenant.id as TenantId,
        branchId: seeded.branchId as BranchId,
        variantId: seeded.variantId as ProductVariantId,
        blockedInterval: BLOCKED_INTERVAL,
      }),
    );
    expect(archivedProduct).toBeNull();

    await withTenantTransaction(tenant.id, 'user_clt050_lifecycle', async (client) => {
      await client.query(`UPDATE product SET status = 'active' WHERE tenant_id = $1 AND id = $2`, [
        tenant.id,
        seeded.productId,
      ]);
      await client.query(`UPDATE branch SET status = 'restricted' WHERE tenant_id = $1 AND id = $2`, [
        tenant.id,
        seeded.branchId,
      ]);
    });
    const restrictedBranch = await withTenantTransaction(tenant.id, 'user_clt050_lifecycle', (client) =>
      resolveReservationCatalogueSelection(client, {
        tenantId: tenant.id as TenantId,
        branchId: seeded.branchId as BranchId,
        variantId: seeded.variantId as ProductVariantId,
        blockedInterval: BLOCKED_INTERVAL,
      }),
    );
    expect(restrictedBranch).toBeNull();
  });

  it('allows concurrent candidate reads but the reservation allocation transaction admits only one winner', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_clt050_race' });
    const seeded = await seedCatalogue(tenant.id, 'user_clt050_race');
    const reservationLines = await seedReservationLines(
      tenant.id,
      'user_clt050_race',
      seeded.branchId,
      seeded.variantId,
    );

    let arrivals = 0;
    let releaseBarrier: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const attemptAllocation = async (reservationLineId: string, principalId: string) =>
      withTenantTransaction(tenant.id, principalId, async (client) => {
        const selection = await resolveReservationCatalogueSelection(client, {
          tenantId: tenant.id as TenantId,
          branchId: seeded.branchId as BranchId,
          variantId: seeded.variantId as ProductVariantId,
          blockedInterval: BLOCKED_INTERVAL,
        });
        expect(selection?.candidate_asset_ids).toEqual([seeded.readyFreeAssetId]);

        arrivals += 1;
        if (arrivals === 2) releaseBarrier();
        await barrier;

        const assetId = selection?.candidate_asset_ids[0];
        if (!assetId) throw new Error('Expected one concrete candidate asset.');

        await client.query(
          `SELECT id
             FROM physical_asset
            WHERE tenant_id = $1 AND id = $2
            ORDER BY id ASC
            FOR UPDATE`,
          [tenant.id, assetId],
        );

        await client.query('SAVEPOINT reservation_allocation_attempt');
        try {
          await client.query(
            `INSERT INTO asset_allocation
               (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
             VALUES ($1, $2, $3, $4, 'reservation_hold', tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
            [
              tenant.id,
              seeded.branchId,
              assetId,
              reservationLineId,
              BLOCKED_INTERVAL.start,
              BLOCKED_INTERVAL.end,
            ],
          );
          await client.query('RELEASE SAVEPOINT reservation_allocation_attempt');
          return 'allocated' as const;
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT reservation_allocation_attempt');
          await client.query('RELEASE SAVEPOINT reservation_allocation_attempt');
          if (
            (error as { code?: unknown; constraint?: unknown }).code === '23P01' &&
            (error as { constraint?: unknown }).constraint === 'asset_allocation_no_overlap'
          ) {
            return 'conflict' as const;
          }
          throw error;
        }
      });

    const outcomes = await Promise.all([
      attemptAllocation(reservationLines[0], 'user_clt050_race_a'),
      attemptAllocation(reservationLines[1], 'user_clt050_race_b'),
    ]);

    expect([...outcomes].sort()).toEqual(['allocated', 'conflict']);

    const allocationCount = await withTenantTransaction(tenant.id, 'user_clt050_race', async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM asset_allocation
          WHERE tenant_id = $1
            AND asset_id = $2
            AND is_blocking = true
            AND period && tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
        [tenant.id, seeded.readyFreeAssetId, BLOCKED_INTERVAL.start, BLOCKED_INTERVAL.end],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    expect(allocationCount).toBe(1);
  });

  async function seedCatalogue(
    tenantId: string,
    principalId: string,
    options: { withBlockedAsset?: boolean } = {},
  ) {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const branchResult = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      );
      const branchId = requireId(branchResult.rows[0]?.id, 'branch');
      const otherBranchResult = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, timezone)
         VALUES ($1, 'Second Branch', 'SECOND', 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      );
      const otherBranchId = requireId(otherBranchResult.rows[0]?.id, 'other branch');

      const productResult = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, description, status)
         VALUES ($1, 'CLT050-GOWN', 'Allocation Gown', 'CLT-050 test garment', 'active')
         RETURNING id`,
        [tenantId],
      );
      const productId = requireId(productResult.rows[0]?.id, 'product');
      const variantResult = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, rental_price_minor,
            security_deposit_minor, currency, pricing_mode, included_duration_minutes,
            extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'CLT050-M', 'M', 'Emerald', 150000, 50000, 'PHP',
                 'fixed_duration', 4320, 50000, 60, 1440, 'active')
         RETURNING id`,
        [tenantId, productId],
      );
      const variantId = requireId(variantResult.rows[0]?.id, 'variant');

      const assets = await client.query<{
        id: string;
        asset_code: string;
      }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness)
         VALUES
           ($1, $2, $3, 'CLT050-READY-FREE', 'active', 'ready'),
           ($1, $2, $3, 'CLT050-READY-BLOCKED', 'active', 'ready'),
           ($1, $2, $3, 'CLT050-CLEANING', 'active', 'needs_cleaning'),
           ($1, $2, $3, 'CLT050-RETIRED', 'retired', 'unready'),
           ($1, $4, $3, 'CLT050-OTHER-BRANCH', 'active', 'ready')
         RETURNING id, asset_code`,
        [tenantId, branchId, variantId, otherBranchId],
      );
      const byCode = new Map(assets.rows.map((row) => [row.asset_code, row.id]));
      const readyFreeAssetId = requireId(byCode.get('CLT050-READY-FREE'), 'ready free asset');
      const readyBlockedAssetId = requireId(byCode.get('CLT050-READY-BLOCKED'), 'ready blocked asset');
      const needsCleaningAssetId = requireId(byCode.get('CLT050-CLEANING'), 'cleaning asset');
      const retiredAssetId = requireId(byCode.get('CLT050-RETIRED'), 'retired asset');
      const otherBranchAssetId = requireId(byCode.get('CLT050-OTHER-BRANCH'), 'other branch asset');

      if (options.withBlockedAsset) {
        const work = await client.query<{ id: string }>(
          `INSERT INTO maintenance_work_order
             (tenant_id, branch_id, asset_id, kind, status, reason)
           VALUES ($1, $2, $3, 'manual_block', 'open', 'Existing blocking work')
           RETURNING id`,
          [tenantId, branchId, readyBlockedAssetId],
        );
        const maintenanceId = requireId(work.rows[0]?.id, 'maintenance work order');
        await client.query(
          `INSERT INTO asset_allocation
             (tenant_id, branch_id, asset_id, maintenance_id, kind, period, is_blocking)
           VALUES ($1, $2, $3, $4, 'maintenance',
                   tstzrange('2026-10-11T00:00:00Z', '2026-10-12T00:00:00Z', '[)'), true)`,
          [tenantId, branchId, readyBlockedAssetId, maintenanceId],
        );
      } else {
        await client.query(`DELETE FROM physical_asset WHERE tenant_id = $1 AND id <> $2`, [
          tenantId,
          readyFreeAssetId,
        ]);
      }

      return {
        branchId,
        otherBranchId,
        productId,
        variantId,
        readyFreeAssetId,
        readyBlockedAssetId,
        needsCleaningAssetId,
        retiredAssetId,
        otherBranchAssetId,
      };
    });
  }

  async function seedReservationLines(
    tenantId: string,
    principalId: string,
    branchId: string,
    variantId: string,
  ): Promise<[string, string]> {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const storefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status)
         VALUES ($1, $2, $3, 'published')
         RETURNING id`,
        [tenantId, branchId, `clt050-${tenantId.slice(0, 8)}`],
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

      const reservationIds: string[] = [];
      for (const suffix of ['A', 'B']) {
        const reservation = await client.query<{ id: string }>(
          `INSERT INTO reservation
             (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
              reference_code, status, pickup_at, due_at, timezone_snapshot, price_snapshot,
              currency, rental_total_minor, security_required_minor, due_now_minor, hold_expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'held',
                   '2026-10-10T10:00:00Z', '2026-10-12T10:00:00Z', 'Asia/Manila', '{}',
                   'PHP', 150000, 50000, 0, now() + interval '15 minutes')
           RETURNING id`,
          [tenantId, branchId, storefrontId, policyId, paymentMethodId, `CLT050-${suffix}`],
        );
        reservationIds.push(requireId(reservation.rows[0]?.id, `reservation ${suffix}`));
      }

      const lineIds: string[] = [];
      for (const [index, reservationId] of reservationIds.entries()) {
        const line = await client.query<{ id: string }>(
          `INSERT INTO reservation_line
             (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
              measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
           VALUES ($1, $2, $3, 1, 'Allocation Gown', '{}', '{}', 150000, 50000, 'PHP')
           RETURNING id`,
          [tenantId, reservationId, variantId],
        );
        lineIds[index] = requireId(line.rows[0]?.id, `reservation line ${index + 1}`);
      }

      const first = lineIds[0];
      const second = lineIds[1];
      if (!first || !second) throw new Error('Expected two reservation lines.');
      return [first, second];
    });
  }
});

function requireId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Expected ${label} id.`);
  return value;
}
