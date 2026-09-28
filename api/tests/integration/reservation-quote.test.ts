import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PermissionCode, StaffReservationCreateRequest } from '@drezivo/contracts';

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

interface QuoteSeed {
  tenantId: string;
  principalId: string;
  branchId: string;
  otherBranchId: string;
  storefrontId: string;
  policySnapshotId: string;
  paymentMethodId: string;
  variantId: string;
  mainAssetIds: string[];
  otherBranchAssetId: string;
}

describe('RSV-020 reservation quote and candidate resolution', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { getStaffReservationQuote } = await import('../../src/modules/reservations/reservations.service.js');
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

  it('computes fixed-duration pricing, delivery, policy, recovery, and concrete branch candidates without writing a hold', async () => {
    const seed = await seedQuoteWorkspace({
      clerkOrgId: 'org_rsv020_quote',
      principalId: 'user_rsv020_quote',
      timezone: 'Asia/Manila',
      assetCount: 2,
      pricingMode: 'fixed_duration',
      rentalPriceMinor: 150000,
      securityDepositMinor: 50000,
      includedDurationMinutes: 3 * 24 * 60,
      extraDayPriceMinor: 40000,
      prepMinutes: 120,
      turnaroundMinutes: 24 * 60,
      deliveryRules: { enabled: true, fee_minor: '25000', instructions: 'Metro delivery.' },
    });

    const quote = await getStaffReservationQuote(
      reservationContext(seed),
      staffRequest(seed, {
        fulfillment_method: 'delivery',
        requested_interval: {
          start: '2026-10-10T02:00:00.000Z',
          end: '2026-10-14T02:00:00.000Z',
        },
      }),
    );

    expect(quote).toMatchObject({
      branch_id: seed.branchId,
      storefront_id: seed.storefrontId,
      policy_snapshot_id: seed.policySnapshotId,
      payment_method_id: seed.paymentMethodId,
      variant_id: seed.variantId,
      pickup_at: '2026-10-10T02:00:00.000Z',
      due_at: '2026-10-14T02:00:00.000Z',
      timezone_snapshot: 'Asia/Manila',
      blocked_interval: {
        start: '2026-10-10T02:00:00.000Z',
        end: '2026-10-15T02:00:00.000Z',
      },
      capacity: { guaranteed: false },
      line_snapshot: {
        name: 'RSV-020 Emerald Gown',
        sku: 'RSV020-M',
        size_label: 'M',
        color_label: 'Emerald',
        measurement_mode: 'custom',
        measurement_unit: 'cm',
        measurements: { bust: 91.5, waist: 72 },
      },
      price_snapshot: {
        rental_total_minor: '190000',
        security_required_minor: '50000',
        delivery_total_minor: '25000',
        due_now_minor: '265000',
        currency: 'PHP',
        pricing_mode: 'fixed_duration',
        included_duration_minutes: 4320,
        extra_day_price_minor: '40000',
        extra_day_count: 1,
      },
      delivery_snapshot: { fulfillment_method: 'delivery', fee_minor: '25000' },
      policy_snapshot: {
        id: seed.policySnapshotId,
        version: 1,
        delivery_rules: { enabled: true, fee_minor: '25000', instructions: 'Metro delivery.' },
      },
      payment_method_snapshot: {
        id: seed.paymentMethodId,
        name: 'Cash',
        rail: 'cash',
        version: 1,
      },
    });
    expect(quote.capacity.candidate_asset_ids).toEqual([...seed.mainAssetIds].sort());
    expect(quote.capacity.candidate_asset_ids).not.toContain(seed.otherBranchAssetId);
    expect(quote).not.toHaveProperty('available');
    expect(quote).not.toHaveProperty('selected_asset_id');

    const writes = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservations = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM reservation WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      const allocations = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM asset_allocation WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      return {
        reservations: reservations.rows[0]?.count ?? -1,
        allocations: allocations.rows[0]?.count ?? -1,
      };
    });
    expect(writes).toEqual({ reservations: 0, allocations: 0 });
  });

  it('rejects a fixed-duration rental that is shorter than the included duration', async () => {
    const seed = await seedQuoteWorkspace({
      clerkOrgId: 'org_rsv020_minimum',
      principalId: 'user_rsv020_minimum',
      timezone: 'Asia/Manila',
      assetCount: 1,
      pricingMode: 'fixed_duration',
      rentalPriceMinor: 50000,
      securityDepositMinor: 20000,
      includedDurationMinutes: 3 * 24 * 60,
      extraDayPriceMinor: 15000,
      prepMinutes: 0,
      turnaroundMinutes: 0,
      deliveryRules: {},
    });

    await expect(
      getStaffReservationQuote(
        reservationContext(seed),
        staffRequest(seed, {
          fulfillment_method: 'pickup',
          requested_interval: {
            start: '2026-10-10T02:00:00.000Z',
            end: '2026-10-13T01:59:00.000Z',
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      message: 'This clothing variant requires a minimum rental period of 3 days.',
    });
  });

  it('rejects a staff reservation whose pickup time is already in the past', async () => {
    const seed = await seedQuoteWorkspace({
      clerkOrgId: 'org_rsv020_past_pickup',
      principalId: 'user_rsv020_past_pickup',
      timezone: 'Asia/Manila',
      assetCount: 1,
      pricingMode: 'daily',
      rentalPriceMinor: 50000,
      securityDepositMinor: 20000,
      includedDurationMinutes: 24 * 60,
      extraDayPriceMinor: 50000,
      prepMinutes: 0,
      turnaroundMinutes: 0,
      deliveryRules: {},
    });

    await expect(
      getStaffReservationQuote(
        reservationContext(seed),
        staffRequest(seed, {
          fulfillment_method: 'pickup',
          requested_interval: {
            start: '2020-01-01T02:00:00.000Z',
            end: '2020-01-02T02:00:00.000Z',
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Pickup time cannot be in the past. Choose the current minute or a future time.',
    });
  });

  it('requires an event date to stay inside the branch-local pickup and return dates', async () => {
    const seed = await seedQuoteWorkspace({
      clerkOrgId: 'org_rsv020_event_date',
      principalId: 'user_rsv020_event_date',
      timezone: 'Asia/Manila',
      assetCount: 1,
      pricingMode: 'daily',
      rentalPriceMinor: 50000,
      securityDepositMinor: 20000,
      includedDurationMinutes: 24 * 60,
      extraDayPriceMinor: 50000,
      prepMinutes: 0,
      turnaroundMinutes: 0,
      deliveryRules: {},
    });
    const base = staffRequest(seed, {
      fulfillment_method: 'pickup',
      requested_interval: {
        start: '2026-10-10T02:00:00.000Z',
        end: '2026-10-11T02:00:00.000Z',
      },
    });

    await expect(
      getStaffReservationQuote(reservationContext(seed), { ...base, event_date: '2026-10-09' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      getStaffReservationQuote(reservationContext(seed), { ...base, event_date: '2026-10-12' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      getStaffReservationQuote(reservationContext(seed), { ...base, event_date: '2026-10-11' }),
    ).resolves.toMatchObject({ pickup_at: base.requested_interval.start, due_at: base.requested_interval.end });
  });

  it('honors half-open adjacency while excluding an asset whose block overlaps the rental-plus-recovery window', async () => {
    const seed = await seedQuoteWorkspace({
      clerkOrgId: 'org_rsv020_adjacency',
      principalId: 'user_rsv020_adjacency',
      timezone: 'Asia/Manila',
      assetCount: 3,
      pricingMode: 'fixed_duration',
      rentalPriceMinor: 100000,
      securityDepositMinor: 30000,
      includedDurationMinutes: 2 * 24 * 60,
      extraDayPriceMinor: 25000,
      prepMinutes: 60,
      turnaroundMinutes: 120,
      deliveryRules: {},
    });
    const [beforeAsset, afterAsset, overlapAsset] = seed.mainAssetIds;
    if (!beforeAsset || !afterAsset || !overlapAsset) throw new Error('Expected three seeded assets.');

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await addMaintenanceBlock(client, seed, beforeAsset, {
        start: '2026-10-08T02:00:00.000Z',
        end: '2026-10-10T02:00:00.000Z',
      });
      await addMaintenanceBlock(client, seed, afterAsset, {
        start: '2026-10-12T04:00:00.000Z',
        end: '2026-10-13T04:00:00.000Z',
      });
      await addMaintenanceBlock(client, seed, overlapAsset, {
        start: '2026-10-12T03:59:00.000Z',
        end: '2026-10-13T04:00:00.000Z',
      });
    });

    const quote = await getStaffReservationQuote(
      reservationContext(seed),
      staffRequest(seed, {
        fulfillment_method: 'pickup',
        requested_interval: {
          start: '2026-10-10T02:00:00.000Z',
          end: '2026-10-12T02:00:00.000Z',
        },
      }),
    );

    expect(quote.blocked_interval).toEqual({
      start: '2026-10-10T02:00:00.000Z',
      end: '2026-10-12T04:00:00.000Z',
    });
    expect(quote.capacity.candidate_asset_ids).toEqual([beforeAsset, afterAsset].sort());
    expect(quote.capacity.candidate_asset_ids).not.toContain(overlapAsset);
    expect(quote.price_snapshot.delivery_total_minor).toBe('0');
  });

  it('preserves timezone-safe deadlines and recovery arithmetic across a DST transition', async () => {
    const seed = await seedQuoteWorkspace({
      clerkOrgId: 'org_rsv020_dst',
      principalId: 'user_rsv020_dst',
      timezone: 'America/New_York',
      assetCount: 1,
      pricingMode: 'daily',
      rentalPriceMinor: 30000,
      securityDepositMinor: 10000,
      includedDurationMinutes: 24 * 60,
      extraDayPriceMinor: 30000,
      prepMinutes: 60,
      turnaroundMinutes: 60,
      deliveryRules: {},
    });

    // 01:30 EST on Mar 14 -> 01:30 EDT on Mar 15 is 23 elapsed hours because DST springs forward.
    const quote = await getStaffReservationQuote(
      reservationContext(seed),
      staffRequest(seed, {
        fulfillment_method: 'pickup',
        requested_interval: {
          start: '2027-03-14T06:30:00.000Z',
          end: '2027-03-15T05:30:00.000Z',
        },
      }),
    );

    expect(quote.timezone_snapshot).toBe('America/New_York');
    expect(quote.pickup_at).toBe('2027-03-14T06:30:00.000Z');
    expect(quote.due_at).toBe('2027-03-15T05:30:00.000Z');
    expect(quote.blocked_interval).toEqual({
      start: '2027-03-14T06:30:00.000Z',
      end: '2027-03-15T06:30:00.000Z',
    });
    expect(quote.price_snapshot).toMatchObject({
      rental_total_minor: '30000',
      extra_day_count: 0,
      pricing_mode: 'daily',
    });
  });

  it('treats candidate assets as stale-able observations rather than an availability promise', async () => {
    const seed = await seedQuoteWorkspace({
      clerkOrgId: 'org_rsv020_stale',
      principalId: 'user_rsv020_stale',
      timezone: 'Asia/Manila',
      assetCount: 1,
      pricingMode: 'daily',
      rentalPriceMinor: 50000,
      securityDepositMinor: 10000,
      includedDurationMinutes: 24 * 60,
      extraDayPriceMinor: 50000,
      prepMinutes: 0,
      turnaroundMinutes: 0,
      deliveryRules: {},
    });
    const assetId = seed.mainAssetIds[0];
    if (!assetId) throw new Error('Expected one seeded asset.');
    const request = staffRequest(seed, {
      fulfillment_method: 'pickup',
      requested_interval: {
        start: '2026-11-01T02:00:00.000Z',
        end: '2026-11-02T02:00:00.000Z',
      },
    });

    const first = await getStaffReservationQuote(reservationContext(seed), request);
    expect(first.capacity).toEqual({ candidate_asset_ids: [assetId], guaranteed: false });

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      addMaintenanceBlock(client, seed, assetId, first.blocked_interval),
    );

    const fresh = await getStaffReservationQuote(reservationContext(seed), request);
    expect(fresh.capacity).toEqual({ candidate_asset_ids: [], guaranteed: false });
    expect(first.capacity.candidate_asset_ids).toEqual([assetId]);
  });

  it('fails closed for restricted booking context, non-default branch context, and foreign payment method ids', async () => {
    const seed = await seedQuoteWorkspace({
      clerkOrgId: 'org_rsv020_guards',
      principalId: 'user_rsv020_guards',
      timezone: 'Asia/Manila',
      assetCount: 1,
      pricingMode: 'daily',
      rentalPriceMinor: 50000,
      securityDepositMinor: 10000,
      includedDurationMinutes: 24 * 60,
      extraDayPriceMinor: 50000,
      prepMinutes: 0,
      turnaroundMinutes: 0,
      deliveryRules: {},
    });
    const request = staffRequest(seed, {
      fulfillment_method: 'pickup',
      requested_interval: {
        start: '2026-12-01T02:00:00.000Z',
        end: '2026-12-02T02:00:00.000Z',
      },
    });

    await expect(
      getStaffReservationQuote(
        { ...reservationContext(seed), effectiveTenantStatus: 'restricted' },
        request,
      ),
    ).rejects.toMatchObject({ code: 'TENANT_RESTRICTED' });

    await expect(
      getStaffReservationQuote({ ...reservationContext(seed), branchId: seed.otherBranchId }, request),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    const foreign = await seedQuoteWorkspace({
      clerkOrgId: 'org_rsv020_foreign',
      principalId: 'user_rsv020_foreign',
      timezone: 'Asia/Manila',
      assetCount: 1,
      pricingMode: 'daily',
      rentalPriceMinor: 50000,
      securityDepositMinor: 10000,
      includedDurationMinutes: 24 * 60,
      extraDayPriceMinor: 50000,
      prepMinutes: 0,
      turnaroundMinutes: 0,
      deliveryRules: {},
    });
    await expect(
      getStaffReservationQuote(reservationContext(seed), {
        ...request,
        payment_method_id: foreign.paymentMethodId as StaffReservationCreateRequest['payment_method_id'],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  async function seedQuoteWorkspace(input: {
    clerkOrgId: string;
    principalId: string;
    timezone: string;
    assetCount: number;
    pricingMode: 'fixed_duration' | 'daily';
    rentalPriceMinor: number;
    securityDepositMinor: number;
    includedDurationMinutes: number;
    extraDayPriceMinor: number;
    prepMinutes: number;
    turnaroundMinutes: number;
    deliveryRules: Record<string, unknown>;
  }): Promise<QuoteSeed> {
    const tenant = await createTestTenant({ clerkOrgId: input.clerkOrgId });
    return withTenantTransaction(tenant.id, input.principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, $2, 'active')
         RETURNING id`,
        [tenant.id, input.timezone],
      );
      const branchId = requireRow(branch.rows, 'default branch').id;
      const otherBranch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Second Branch', 'SECOND', false, $2, 'active')
         RETURNING id`,
        [tenant.id, input.timezone],
      );
      const otherBranchId = requireRow(otherBranch.rows, 'other branch').id;

      const storefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb)
         RETURNING id`,
        [tenant.id, branchId, `rsv020-${tenant.id.slice(0, 8)}`],
      );
      const storefrontId = requireRow(storefront.rows, 'storefront').id;
      const policy = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules,
            cancellation_rules, delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1,
                 '{"summary":"Rental rules"}'::jsonb,
                 '{"summary":"Deposit rules"}'::jsonb,
                 '{"summary":"Cancellation rules"}'::jsonb,
                 $3::jsonb,
                 'Reservation quote privacy notice',
                 statement_timestamp() - interval '1 minute')
         RETURNING id`,
        [tenant.id, storefrontId, JSON.stringify(input.deliveryRules)],
      );
      const policySnapshotId = requireRow(policy.rows, 'policy snapshot').id;

      const payment = await client.query<{ id: string }>(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES ($1, 'Cash', 'cash', '{"instructions":"Pay at pickup"}'::jsonb, true, 1)
         RETURNING id`,
        [tenant.id],
      );
      const paymentMethodId = requireRow(payment.rows, 'payment method').id;

      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, description, status)
         VALUES ($1, 'RSV020-GOWN', 'RSV-020 Emerald Gown', 'Quote test garment', 'active')
         RETURNING id`,
        [tenant.id],
      );
      const productId = requireRow(product.rows, 'product').id;
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurement_mode,
            measurement_unit, measurements, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, extra_day_price_minor,
            prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'RSV020-M', 'M', 'Emerald', 'custom', 'cm',
                 '{"bust":91.5,"waist":72}'::jsonb, $3, $4, 'PHP', $5, $6, $7, $8, $9, 'active')
         RETURNING id`,
        [
          tenant.id,
          productId,
          input.rentalPriceMinor,
          input.securityDepositMinor,
          input.pricingMode,
          input.includedDurationMinutes,
          input.extraDayPriceMinor,
          input.prepMinutes,
          input.turnaroundMinutes,
        ],
      );
      const variantId = requireRow(variant.rows, 'variant').id;

      const mainAssetIds: string[] = [];
      for (let index = 0; index < input.assetCount; index += 1) {
        const asset = await client.query<{ id: string }>(
          `INSERT INTO physical_asset
             (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
           VALUES ($1, $2, $3, $4, 'active', 'ready', 'at_branch')
           RETURNING id`,
          [tenant.id, branchId, variantId, `RSV020-M-${index + 1}`],
        );
        mainAssetIds.push(requireRow(asset.rows, `main asset ${index + 1}`).id);
      }
      const otherAsset = await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'RSV020-OTHER', 'active', 'ready', 'at_branch')
         RETURNING id`,
        [tenant.id, otherBranchId, variantId],
      );

      return {
        tenantId: tenant.id,
        principalId: input.principalId,
        branchId,
        otherBranchId,
        storefrontId,
        policySnapshotId,
        paymentMethodId,
        variantId,
        mainAssetIds,
        otherBranchAssetId: requireRow(otherAsset.rows, 'other branch asset').id,
      };
    });
  }

  function staffRequest(
    seed: QuoteSeed,
    overrides: Pick<StaffReservationCreateRequest, 'requested_interval' | 'fulfillment_method'>,
  ): StaffReservationCreateRequest {
    return {
      customer: {
        source: 'new',
        customer: {
          full_name: 'Walk-in Customer',
          phone: '09171234567',
          address: '123 Quote Street, Quezon City',
        },
      },
      variant_id: seed.variantId as StaffReservationCreateRequest['variant_id'],
      requested_interval: overrides.requested_interval,
      fulfillment_method: overrides.fulfillment_method,
      payment_method_id: seed.paymentMethodId as StaffReservationCreateRequest['payment_method_id'],
    };
  }

  function reservationContext(seed: QuoteSeed): {
    tenantId: string;
    branchId: string;
    membershipId: string;
    principalId: string;
    permissionCodes: PermissionCode[];
    effectiveTenantStatus: 'active';
  } {
    return {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      membershipId: '00000000-0000-4000-8000-000000000001',
      principalId: seed.principalId,
      permissionCodes: ['reservations.manage'],
      effectiveTenantStatus: 'active',
    };
  }

  async function addMaintenanceBlock(
    client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
    seed: QuoteSeed,
    assetId: string,
    period: { start: string; end: string },
  ): Promise<void> {
    const work = await client.query(
      `INSERT INTO maintenance_work_order
         (tenant_id, branch_id, asset_id, kind, status, reason)
       VALUES ($1, $2, $3, 'manual_block', 'open', 'RSV-020 candidate test')
       RETURNING id`,
      [seed.tenantId, seed.branchId, assetId],
    );
    const workOrderId = requireRow(work.rows, 'maintenance work order').id;
    await client.query(
      `INSERT INTO asset_allocation
         (tenant_id, branch_id, asset_id, maintenance_id, kind, period, is_blocking)
       VALUES ($1, $2, $3, $4, 'maintenance', tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
      [seed.tenantId, seed.branchId, assetId, workOrderId, period.start, period.end],
    );
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} insert to return one row.`);
    return row;
  }
});
