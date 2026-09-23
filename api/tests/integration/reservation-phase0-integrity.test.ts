import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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

describe('RSV-002 reservation database integrity', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
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

  it('stores event_date as date-only and exposes the bounded reservation read indexes', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_rsv002_shape' });

    const shape = await withTenantTransaction(tenant.id, 'user_rsv002_shape', async (client) => {
      const column = await client.query<{ data_type: string }>(
        `SELECT data_type
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'reservation' AND column_name = 'event_date'`,
      );
      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname
           FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'reservation'
            AND indexname = ANY($1::text[])
          ORDER BY indexname`,
        [[
          'reservation_tenant_status_pickup_idx',
          'reservation_tenant_pickup_idx',
          'reservation_tenant_due_idx',
          'reservation_tenant_event_date_idx',
          'reservation_tenant_customer_created_idx',
          'reservation_tenant_reference_key',
        ]],
      );
      return {
        eventDateType: column.rows[0]?.data_type,
        indexes: indexes.rows.map((row) => row.indexname),
      };
    });

    expect(shape).toEqual({
      eventDateType: 'date',
      indexes: [
        'reservation_tenant_customer_created_idx',
        'reservation_tenant_due_idx',
        'reservation_tenant_event_date_idx',
        'reservation_tenant_pickup_idx',
        'reservation_tenant_reference_key',
        'reservation_tenant_status_pickup_idx',
      ],
    });
  });

  it('rejects cross-tenant reservation/customer and reservation-line/variant relationships', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_rsv002_fk_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_rsv002_fk_b' });
    const graphA = await seedReservationGraph(tenantA.id, 'user_rsv002_fk_a', 'RSV-A');
    const graphB = await seedReservationGraph(tenantB.id, 'user_rsv002_fk_b', 'RSV-B');

    const customerResult = await withTenantTransaction(tenantA.id, 'user_rsv002_bad_customer', async (client) => {
      try {
        await insertReservation(client, graphA, 'RSV-BAD-CUSTOMER', graphB.customerId);
        return 'inserted';
      } catch (error) {
        return (error as { code?: string }).code ?? 'unknown';
      }
    });

    const variantResult = await withTenantTransaction(tenantA.id, 'user_rsv002_bad_variant', async (client) => {
      try {
        await client.query(
          `INSERT INTO reservation_line
             (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
              measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
           VALUES ($1, $2, $3, 99, 'Foreign Variant', '{}'::jsonb, '{}'::jsonb, 10000, 0, 'PHP')`,
          [tenantA.id, graphA.reservationId, graphB.variantId],
        );
        return 'inserted';
      } catch (error) {
        return (error as { code?: string }).code ?? 'unknown';
      }
    });

    expect({ customerResult, variantResult }).toEqual({
      customerResult: '23503',
      variantResult: '23503',
    });
  });

  it('rejects cross-tenant storefront/branch and policy/storefront parent relationships', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_rsv002_parent_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_rsv002_parent_b' });
    const graphA = await seedReservationGraph(tenantA.id, 'user_rsv002_parent_a', 'RSV-PARENT-A');
    const graphB = await seedReservationGraph(tenantB.id, 'user_rsv002_parent_b', 'RSV-PARENT-B');

    const storefrontResult = await withTenantTransaction(tenantA.id, 'user_rsv002_bad_storefront', async (client) => {
      try {
        await client.query(
          `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
           VALUES ($1, $2, 'rsv002-bad-parent-storefront', 'draft', '{}'::jsonb, '{}'::jsonb)`,
          [tenantA.id, graphB.branchId],
        );
        return 'inserted';
      } catch (error) {
        return (error as { code?: string }).code ?? 'unknown';
      }
    });

    const policyResult = await withTenantTransaction(tenantA.id, 'user_rsv002_bad_policy_parent', async (client) => {
      try {
        await client.query(
          `INSERT INTO policy_snapshot
             (tenant_id, storefront_id, version, rental_rules, deposit_rules,
              cancellation_rules, delivery_rules, privacy_notice, effective_at)
           VALUES ($1, $2, 99, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                   'Bad parent policy', now())`,
          [tenantA.id, graphB.storefrontId],
        );
        return 'inserted';
      } catch (error) {
        return (error as { code?: string }).code ?? 'unknown';
      }
    });

    expect({ storefrontResult, policyResult, localStorefront: graphA.storefrontId.length > 0 }).toEqual({
      storefrontResult: '23503',
      policyResult: '23503',
      localStorefront: true,
    });
  });

  it('rejects a policy snapshot that belongs to another storefront in the same tenant', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_rsv002_policy_storefront' });
    const graph = await seedReservationGraph(tenant.id, 'user_rsv002_policy_storefront', 'RSV-POLICY');

    const result = await withTenantTransaction(tenant.id, 'user_rsv002_policy_mismatch', async (client) => {
      const secondStorefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, 'rsv002-second-storefront', 'draft', '{}'::jsonb, '{}'::jsonb)
         RETURNING id`,
        [tenant.id, graph.branchId],
      );
      const secondStorefrontId = requireRow(secondStorefront.rows, 'second storefront').id;
      const secondPolicy = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules,
            cancellation_rules, delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 'Second policy', now())
         RETURNING id`,
        [tenant.id, secondStorefrontId],
      );
      const secondPolicyId = requireRow(secondPolicy.rows, 'second policy').id;

      try {
        await client.query(
          `INSERT INTO reservation
             (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id,
              payment_method_id, reference_code, status, event_date, pickup_at, due_at,
              timezone_snapshot, customer_snapshot, delivery_snapshot, price_snapshot,
              rental_total_minor, security_required_minor, due_now_minor)
           VALUES ($1, $2, $3, $4, $5, $6, 'RSV-BAD-POLICY', 'held', '2026-10-15',
                   '2026-10-15T02:00:00Z', '2026-10-16T02:00:00Z', 'Asia/Manila',
                   '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 10000, 0, 10000)`,
          [
            tenant.id,
            graph.branchId,
            graph.customerId,
            graph.storefrontId,
            secondPolicyId,
            graph.paymentMethodId,
          ],
        );
        return 'inserted';
      } catch (error) {
        return (error as { code?: string; constraint?: string }).constraint ??
          (error as { code?: string }).code ??
          'unknown';
      }
    });

    expect(result).toBe('reservation_policy_storefront_same_tenant_fk');
  });

  it('allows one tenant reference code once while another tenant may use the same reference', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_rsv002_ref_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_rsv002_ref_b' });
    const graphA = await seedReservationGraph(tenantA.id, 'user_rsv002_ref_a', 'RSV-SHARED');
    const graphB = await seedReservationGraph(tenantB.id, 'user_rsv002_ref_b', 'RSV-SHARED');

    const duplicateCode = await withTenantTransaction(tenantA.id, 'user_rsv002_ref_dup', async (client) => {
      try {
        await insertReservation(client, graphA, 'RSV-SHARED', graphA.customerId);
        return 'inserted';
      } catch (error) {
        return (error as { code?: string }).code ?? 'unknown';
      }
    });

    expect({ duplicateCode, otherTenantReservation: graphB.reservationId.length > 0 }).toEqual({
      duplicateCode: '23505',
      otherTenantReservation: true,
    });
  });

  it('permits exactly one concurrent overlapping blocking allocation for one serialized asset', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_rsv002_overlap' });
    const graph = await seedReservationGraph(tenant.id, 'user_rsv002_overlap', 'RSV-OVERLAP');

    const insert = (lineId: string, start: string, end: string) =>
      withTenantTransaction(tenant.id, `user_rsv002_overlap_${lineId.slice(0, 4)}`, (client) =>
        client.query(
          `INSERT INTO asset_allocation
             (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
           VALUES ($1, $2, $3, $4, 'reservation_hold', tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
          [tenant.id, graph.branchId, graph.assetAId, lineId, start, end],
        ),
      );

    const results = await Promise.allSettled([
      insert(graph.lineAId, '2026-10-15T00:00:00Z', '2026-10-17T00:00:00Z'),
      insert(graph.lineBId, '2026-10-16T00:00:00Z', '2026-10-18T00:00:00Z'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled').length;
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => (result.reason as { code?: string; constraint?: string }).constraint ??
        (result.reason as { code?: string }).code);

    expect({ fulfilled, failures }).toEqual({
      fulfilled: 1,
      failures: ['asset_allocation_no_overlap'],
    });
  });

  it('prevents two current blocking assets for one line but permits a replacement after release', async () => {
    const tenant = await createTestTenant({ clerkOrgId: 'org_rsv002_one_block' });
    const graph = await seedReservationGraph(tenant.id, 'user_rsv002_one_block', 'RSV-ONE-BLOCK');

    const firstId = await withTenantTransaction(tenant.id, 'user_rsv002_one_block', async (client) => {
      const first = await client.query<{ id: string }>(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'reservation_hold',
                 tstzrange('2026-10-15T00:00:00Z', '2026-10-16T00:00:00Z', '[)'), true)
         RETURNING id`,
        [tenant.id, graph.branchId, graph.assetAId, graph.lineAId],
      );
      return requireRow(first.rows, 'first allocation').id;
    });

    let duplicateConstraint = 'none';
    try {
      await withTenantTransaction(tenant.id, 'user_rsv002_duplicate_block', (client) =>
        client.query(
          `INSERT INTO asset_allocation
             (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
           VALUES ($1, $2, $3, $4, 'reservation_hold',
                   tstzrange('2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z', '[)'), true)`,
          [tenant.id, graph.branchId, graph.assetBId, graph.lineAId],
        ),
      );
    } catch (error) {
      duplicateConstraint = (error as { constraint?: string }).constraint ?? 'unknown';
    }

    await withTenantTransaction(tenant.id, 'user_rsv002_release', async (client) => {
      await client.query(
        `UPDATE asset_allocation
            SET is_blocking = false, released_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenant.id, firstId],
      );
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'reservation_hold',
                 tstzrange('2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z', '[)'), true)`,
        [tenant.id, graph.branchId, graph.assetBId, graph.lineAId],
      );
    });

    const activeCount = await withTenantTransaction(tenant.id, 'user_rsv002_release_read', async (client) => {
      const count = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM asset_allocation
          WHERE tenant_id = $1 AND reservation_line_id = $2 AND is_blocking`,
        [tenant.id, graph.lineAId],
      );
      return count.rows[0]?.count ?? -1;
    });

    expect({ duplicateConstraint, activeCount }).toEqual({
      duplicateConstraint: 'asset_allocation_one_blocking_per_line',
      activeCount: 1,
    });
  });

  it('forces reservation RLS and keeps custody history immutable for the app role', async () => {
    const tenantA = await createTestTenant({ clerkOrgId: 'org_rsv002_rls_a' });
    const tenantB = await createTestTenant({ clerkOrgId: 'org_rsv002_rls_b' });
    const graphA = await seedReservationGraph(tenantA.id, 'user_rsv002_rls_a', 'RSV-RLS');

    const foreignRows = await withTenantTransaction(tenantB.id, 'user_rsv002_rls_b', async (client) => {
      const rows = await client.query<{ id: string }>('SELECT id FROM reservation WHERE id = $1', [
        graphA.reservationId,
      ]);
      return rows.rows;
    });

    const security = await withTenantTransaction(tenantA.id, 'user_rsv002_rls_meta', async (client) => {
      const role = await client.query<{ rolbypassrls: boolean }>(
        'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
      const tables = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE relnamespace = 'public'::regnamespace
            AND relname = ANY($1::text[])
          ORDER BY relname`,
        [['customer', 'reservation', 'reservation_line', 'custody_event']],
      );
      const privileges = await client.query<{ can_update: boolean; can_delete: boolean }>(
        `SELECT has_table_privilege(current_user, 'custody_event', 'UPDATE') AS can_update,
                has_table_privilege(current_user, 'custody_event', 'DELETE') AS can_delete`,
      );
      return {
        bypassRls: role.rows[0]?.rolbypassrls,
        tables: tables.rows,
        privileges: privileges.rows[0],
      };
    });

    expect({ foreignRows, security }).toEqual({
      foreignRows: [],
      security: {
        bypassRls: false,
        tables: [
          { relname: 'custody_event', relrowsecurity: true, relforcerowsecurity: true },
          { relname: 'customer', relrowsecurity: true, relforcerowsecurity: true },
          { relname: 'reservation', relrowsecurity: true, relforcerowsecurity: true },
          { relname: 'reservation_line', relrowsecurity: true, relforcerowsecurity: true },
        ],
        privileges: { can_update: false, can_delete: false },
      },
    });
  });

  type DbClient = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];

  interface ReservationGraph {
    tenantId: string;
    branchId: string;
    variantId: string;
    assetAId: string;
    assetBId: string;
    storefrontId: string;
    policySnapshotId: string;
    paymentMethodId: string;
    customerId: string;
    reservationId: string;
    lineAId: string;
    lineBId: string;
  }

  async function seedReservationGraph(
    tenantId: string,
    principalId: string,
    referenceCode: string,
  ): Promise<ReservationGraph> {
    return withTenantTransaction(tenantId, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila')
         RETURNING id`,
        [tenantId],
      );
      const branchId = requireRow(branch.rows, 'branch').id;

      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, $2, 'Reservation Gown', 'active')
         RETURNING id`,
        [tenantId, `GWN-${referenceCode}`],
      );
      const productId = requireRow(product.rows, 'product').id;
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, measurements, measurement_unit,
            measurement_mode, rental_price_minor, security_deposit_minor, currency,
            pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes,
            turnaround_minutes, status)
         VALUES ($1, $2, $3, 'M', '{}'::jsonb, 'cm', 'none', 10000, 2000, 'PHP',
                 'daily', 1440, 10000, 0, 1440, 'active')
         RETURNING id`,
        [tenantId, productId, `SKU-${referenceCode}`],
      );
      const variantId = requireRow(variant.rows, 'variant').id;

      const assets = await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES
           ($1, $2, $3, $4, 'active', 'ready', 'at_branch'),
           ($1, $2, $3, $5, 'active', 'ready', 'at_branch')
         RETURNING id`,
        [tenantId, branchId, variantId, `AST-${referenceCode}-A`, `AST-${referenceCode}-B`],
      );
      const assetAId = requireRow(assets.rows, 'asset A').id;
      const assetBId = assets.rows[1]?.id;
      if (!assetBId) throw new Error('Expected asset B insert to return one row');

      const storefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb)
         RETURNING id`,
        [tenantId, branchId, `store-${referenceCode.toLowerCase()}-${tenantId.slice(0, 8)}`],
      );
      const storefrontId = requireRow(storefront.rows, 'storefront').id;
      const policy = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules,
            cancellation_rules, delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 'Reservation policy', now())
         RETURNING id`,
        [tenantId, storefrontId],
      );
      const policySnapshotId = requireRow(policy.rows, 'policy').id;
      const paymentMethod = await client.query<{ id: string }>(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES ($1, 'Cash', 'cash', '{}'::jsonb, true, 1)
         RETURNING id`,
        [tenantId],
      );
      const paymentMethodId = requireRow(paymentMethod.rows, 'payment method').id;
      const customer = await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, email)
         VALUES ($1, 'Reservation Customer', $2)
         RETURNING id`,
        [tenantId, `${referenceCode.toLowerCase()}@example.test`],
      );
      const customerId = requireRow(customer.rows, 'customer').id;

      const reservationId = await insertReservation(client, {
        tenantId,
        branchId,
        storefrontId,
        policySnapshotId,
        paymentMethodId,
      }, referenceCode, customerId);

      const lines = await client.query<{ id: string }>(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES
           ($1, $2, $3, 1, 'Reservation Gown', '{}'::jsonb, '{}'::jsonb, 10000, 2000, 'PHP'),
           ($1, $2, $3, 2, 'Reservation Gown', '{}'::jsonb, '{}'::jsonb, 10000, 2000, 'PHP')
         RETURNING id`,
        [tenantId, reservationId, variantId],
      );
      const lineAId = requireRow(lines.rows, 'line A').id;
      const lineBId = lines.rows[1]?.id;
      if (!lineBId) throw new Error('Expected line B insert to return one row');

      return {
        tenantId,
        branchId,
        variantId,
        assetAId,
        assetBId,
        storefrontId,
        policySnapshotId,
        paymentMethodId,
        customerId,
        reservationId,
        lineAId,
        lineBId,
      };
    });
  }

  async function insertReservation(
    client: DbClient,
    graph: Pick<
      ReservationGraph,
      'tenantId' | 'branchId' | 'storefrontId' | 'policySnapshotId' | 'paymentMethodId'
    >,
    referenceCode: string,
    customerId: string,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO reservation
         (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id,
          payment_method_id, reference_code, status, event_date, pickup_at, due_at,
          timezone_snapshot, customer_snapshot, delivery_snapshot, price_snapshot,
          rental_total_minor, security_required_minor, due_now_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'held', '2026-10-15',
               '2026-10-15T02:00:00Z', '2026-10-16T02:00:00Z', 'Asia/Manila',
               '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 10000, 2000, 12000)
       RETURNING id`,
      [
        graph.tenantId,
        graph.branchId,
        customerId,
        graph.storefrontId,
        graph.policySnapshotId,
        graph.paymentMethodId,
        referenceCode,
      ],
    );
    return requireRow(result.rows, 'reservation').id;
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} insert to return one row`);
    return row;
  }
});
