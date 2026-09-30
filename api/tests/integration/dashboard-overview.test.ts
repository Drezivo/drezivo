import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { dashboardOverviewResponse, successEnvelope } from '@drezivo/contracts';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const clerk = vi.hoisted(() => ({ getAuth: vi.fn() }));
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

interface DashboardSeed {
  tenantId: string;
  branchId: string;
  otherBranchId: string;
  principalId: string;
  clerkOrgId: string;
  storefrontId: string;
  policyId: string;
  paymentMethodId: string;
  customerId: string;
  variantId: string;
  slotIds: [string, string];
}

describe('Dashboard overview API', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { DASHBOARD_OVERVIEW_SQL } =
    await import('../../src/modules/dashboard/dashboard.repository.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('requires a staff identity and branch operational permission', async () => {
    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const unauthenticated = await request(createApp()).get('/api/v1/dashboard/overview');
    expect(unauthenticated.status).toBe(401);

    const seed = await seedDashboardWorkspace(
      'dashboard_permission',
      'user_dashboard_permission',
      [],
    );
    useClerk(seed);
    const forbidden = await request(createApp()).get('/api/v1/dashboard/overview');
    expect(forbidden.status).toBe(403);
  });

  it('returns empty operational values and isolates new-customer counts by tenant', async () => {
    const seed = await seedDashboardWorkspace('dashboard_empty', 'user_dashboard_empty', [
      'reservations.manage',
    ]);
    const foreignTenant = await createTestTenant({ clerkOrgId: 'org_dashboard_foreign_customer' });
    await withTenantTransaction(
      foreignTenant.id,
      'user_dashboard_foreign_customer',
      async (client) => {
        await client.query(
          `INSERT INTO customer (tenant_id, full_name, email)
         VALUES ($1, 'Foreign Dashboard Customer', 'foreign-dashboard@example.test')`,
          [foreignTenant.id],
        );
      },
    );
    useClerk(seed);

    const response = await request(createApp()).get('/api/v1/dashboard/overview');
    expect(response.status).toBe(200);
    const { data } = successEnvelope(dashboardOverviewResponse).parse(response.body);

    expect(data.metrics).toEqual({
      active_rentals: 0,
      pickups_today: 0,
      returns_today: 0,
      fittings_today: 0,
      payments_to_review: 0,
    });
    expect(data.today_schedule).toMatchObject({ items: [], total: 0, truncated: false });
    expect(data.upcoming_rentals).toMatchObject({ items: [], total: 0, truncated: false });
    expect(data.upcoming_fitting_appointments).toMatchObject({
      items: [],
      total: 0,
      truncated: false,
    });
    expect(data.business_performance).toMatchObject({
      completed_rental_value: { current_minor: '0', previous_minor: '0' },
      completed_rentals: { current: 0, previous: 0 },
      average_rental_value: { current_minor: null, previous_minor: null },
      new_customers: { current: 1, previous: 1 },
    });
  });

  it('checks the overview plan against representative completed-reservation history', async () => {
    const seed = await seedDashboardWorkspace('dashboard_query_plan', 'user_dashboard_query_plan', [
      'reservations.manage',
    ]);

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `INSERT INTO reservation
           (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, customer_snapshot,
            price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor, completed_at)
         SELECT $1, $2, $3, $4, $5, $6, 'dashboard-history-' || sample.seq, 'completed',
                statement_timestamp() - interval '4001 days',
                statement_timestamp() - interval '4000 days', 'America/Los_Angeles',
                '{"full_name":"History Customer"}'::jsonb, '{}'::jsonb, 'PHP', 1000, 0, 1000,
                statement_timestamp() - make_interval(days => sample.seq::int)
           FROM generate_series(1, 5000) AS sample(seq)`,
        [
          seed.tenantId,
          seed.branchId,
          seed.customerId,
          seed.storefrontId,
          seed.policyId,
          seed.paymentMethodId,
        ],
      );
      await client.query(
        `INSERT INTO customer (tenant_id, full_name, email, created_at)
         SELECT $1, 'Dashboard history customer ' || sample.seq,
                'dashboard-history-' || sample.seq || '@example.test',
                statement_timestamp() - make_interval(days => sample.seq::int)
           FROM generate_series(1, 5000) AS sample(seq)`,
        [seed.tenantId],
      );
    });

    const adminPool = new Pool({ connectionString: adminUrl });
    try {
      await adminPool.query('ANALYZE reservation');
      await adminPool.query('ANALYZE customer');
    } finally {
      await adminPool.end();
    }

    const queryPlan = await withTenantTransaction(
      seed.tenantId,
      seed.principalId,
      async (client) => {
        const result = await client.query<{ 'QUERY PLAN': unknown }>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${DASHBOARD_OVERVIEW_SQL}`,
          [seed.tenantId, seed.branchId],
        );
        return result.rows.map((row) => String(row['QUERY PLAN'])).join('\n');
      },
    );

    expect(queryPlan).not.toContain('Seq Scan on reservation');
    expect(queryPlan).not.toContain('Seq Scan on customer');
    expect(queryPlan).toContain('reservation_tenant_branch_completed_at_idx');
    expect(queryPlan).toContain('customer_tenant_active_created_idx');
  });

  it('returns branch-local metrics, bounded operational lists, and safe month comparisons', async () => {
    const seed = await seedDashboardWorkspace('dashboard_overview', 'user_dashboard_overview', [
      'reservations.manage',
    ]);
    useClerk(seed);
    await seedDashboardFacts(seed);

    const response = await request(createApp()).get(
      `/api/v1/dashboard/overview?branch_id=${seed.otherBranchId}`,
    );
    expect(response.status).toBe(200);
    const { data } = successEnvelope(dashboardOverviewResponse).parse(response.body);

    expect(data.window.timezone).toBe('America/Los_Angeles');
    expect(Date.parse(data.window.today.start)).toBeLessThan(Date.parse(data.window.today.end));
    expect(data.window.upcoming_fittings.start).toBe(data.window.as_of);
    expect(data.metrics).toEqual({
      active_rentals: 2,
      pickups_today: 1,
      returns_today: 1,
      fittings_today: 1,
      payments_to_review: 2,
    });
    expect(data.today_schedule.items.map((item) => item.event_type)).toContain('pickup');
    expect(data.today_schedule.items.map((item) => item.event_type)).toContain('return');
    expect(data.today_schedule.items.map((item) => item.event_type)).toContain('fitting');
    expect(data.today_schedule.total).toBe(data.today_schedule.items.length);
    const pickupEvent = data.today_schedule.items.find((item) => item.event_type === 'pickup');
    const returnEvent = data.today_schedule.items.find((item) => item.event_type === 'return');
    const fittingEvent = data.today_schedule.items.find((item) => item.event_type === 'fitting');
    expect(pickupEvent).toMatchObject({
      customer_phone: '555-0101',
      rental_days: 3,
      rental_items: [
        { name: 'Today Pickup Gown', rental_minor: '1000', currency: 'PHP' },
        { name: 'Second Pickup Gown', rental_minor: '2000', currency: 'PHP' },
      ],
    });
    expect(returnEvent).toMatchObject({ customer_phone: null, rental_days: 3 });
    expect(fittingEvent).toMatchObject({
      customer_phone: '555-0199',
      item_names: ['Dashboard Gown'],
    });

    expect(data.upcoming_rentals.items).toHaveLength(2);
    expect(data.upcoming_rentals.items.map((item) => item.item_names[0])).toEqual([
      'Upcoming Gown',
      'Second Upcoming Gown',
    ]);
    const storefrontFitting = data.upcoming_fitting_appointments.items.find(
      (item) => item.booking_channel === 'storefront',
    );
    expect(storefrontFitting).toMatchObject({
      booking_channel: 'storefront',
      status: 'pending',
      garment_names: ['Storefront Fitting Gown'],
    });
    expect(
      data.upcoming_fitting_appointments.items.map((item) => item.garment_names).flat(),
    ).toContain('Two-Day Window Fitting Gown');
    expect(
      data.upcoming_fitting_appointments.items.map((item) => item.garment_names).flat(),
    ).not.toContain('Outside-Window Fitting Gown');
    expect(data.business_performance).toMatchObject({
      currency: 'PHP',
      completed_rental_value: { current_minor: '12000', previous_minor: '7000' },
      completed_rentals: { current: 1, previous: 1 },
      average_rental_value: { current_minor: '12000', previous_minor: '7000' },
      new_customers: { current: 1, previous: 1 },
    });

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('dashboard-private@example.test');
    expect(serialized).not.toContain('secret@example.test');
    expect(serialized).not.toContain('private fitting note');
    expect(serialized).not.toContain('payment_receipt');
    expect(serialized).not.toContain('fittingType');
    expect(serialized).not.toContain(seed.otherBranchId);
  });

  async function seedDashboardWorkspace(
    orgLabel: string,
    principalId: string,
    permissions: string[],
  ): Promise<DashboardSeed> {
    const tenant = await createTestTenant({ clerkOrgId: `org_${orgLabel}` });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');

    return withTenantTransaction(tenant.id, principalId, async (client) => {
      const branchResult = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Los Angeles', 'LA', true, 'America/Los_Angeles', 'active') RETURNING id`,
        [tenant.id],
      );
      const branchId = requireId(branchResult.rows[0]?.id, 'branch');
      const otherBranchResult = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, timezone, status)
         VALUES ($1, 'Other Branch', 'OTHER', 'America/Los_Angeles', 'active') RETURNING id`,
        [tenant.id],
      );
      const otherBranchId = requireId(otherBranchResult.rows[0]?.id, 'other branch');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, branchId, membershipId, JSON.stringify(permissions)],
      );

      const planResult = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE active = true ORDER BY code LIMIT 1`,
      );
      const planId = requireId(planResult.rows[0]?.id, 'active plan');
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', statement_timestamp(), statement_timestamp() + interval '30 days')`,
        [tenant.id, planId],
      );

      const storefrontResult = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
        [tenant.id, branchId, `dashboard-${tenant.id.slice(0, 8)}`],
      );
      const storefrontId = requireId(storefrontResult.rows[0]?.id, 'storefront');
      const policyResult = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
            delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 'dashboard fixture', statement_timestamp()) RETURNING id`,
        [tenant.id, storefrontId],
      );
      const policyId = requireId(policyResult.rows[0]?.id, 'policy');
      const methodResult = await client.query<{ id: string }>(
        `INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot)
         VALUES ($1, 'Cash', 'cash', '{}'::jsonb) RETURNING id`,
        [tenant.id],
      );
      const paymentMethodId = requireId(methodResult.rows[0]?.id, 'payment method');

      const customerResult = await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, email)
         VALUES ($1, 'Dashboard Customer', 'dashboard-private@example.test') RETURNING id`,
        [tenant.id],
      );
      const customerId = requireId(customerResult.rows[0]?.id, 'customer');
      await client.query(
        `UPDATE customer SET phone = '555-0199' WHERE tenant_id = $1 AND id = $2`,
        [tenant.id, customerId],
      );
      await client.query(
        `INSERT INTO customer (tenant_id, full_name, email, created_at)
         SELECT $1, 'Previous Month Customer', 'previous@example.test',
                ((date_trunc('month', statement_timestamp() AT TIME ZONE b.timezone) - interval '1 month' + interval '5 days')::timestamp AT TIME ZONE b.timezone)
           FROM branch b WHERE b.tenant_id = $1 AND b.id = $2`,
        [tenant.id, branchId],
      );

      const productResult = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, $2, 'Dashboard Gown', 'active') RETURNING id`,
        [tenant.id, `DASH-${tenant.id.slice(0, 8)}`],
      );
      const productId = requireId(productResult.rows[0]?.id, 'product');
      const variantResult = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurement_mode, measurement_unit,
            measurements, rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, $3, 'M', 'Blue', 'none', 'cm', '{}'::jsonb, 12000, 0, 'PHP',
                 'fixed_duration', 1440, 0, 0, 0, 'active') RETURNING id`,
        [tenant.id, productId, `DASH-M-${tenant.id.slice(0, 6)}`],
      );
      const variantId = requireId(variantResult.rows[0]?.id, 'variant');

      await client.query(
        `INSERT INTO fitting_settings (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency, version)
         VALUES ($1, $2, true, 2, 60, 500, 'PHP', 1)`,
        [tenant.id, branchId],
      );
      const slotResult = await client.query<{ id: string }>(
        `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number, active)
         VALUES ($1, $2, 1, true), ($1, $2, 2, true) RETURNING id`,
        [tenant.id, branchId],
      );
      const slotIds = [
        requireId(slotResult.rows[0]?.id, 'fitting slot one'),
        requireId(slotResult.rows[1]?.id, 'fitting slot two'),
      ] as [string, string];

      return {
        tenantId: tenant.id,
        branchId,
        otherBranchId,
        principalId,
        clerkOrgId: tenant.clerkOrgId,
        storefrontId,
        policyId,
        paymentMethodId,
        customerId,
        variantId,
        slotIds,
      };
    });
  }

  async function seedDashboardFacts(seed: DashboardSeed): Promise<void> {
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const insertReservation = async (input: {
        label: string;
        status: string;
        pickupDayOffset: number;
        pickupHour: number;
        dueDayOffset: number;
        dueHour: number;
        amount: number;
        lineAmount?: number;
        snapshotPhone?: string | null;
        completedMonthOffset?: number;
        branchId?: string;
      }): Promise<string> => {
        const result = await client.query<{ id: string }>(
          `WITH branch_clock AS (
             SELECT b.timezone, (statement_timestamp() AT TIME ZONE b.timezone)::date AS today
               FROM branch b WHERE b.tenant_id = $1::uuid AND b.id = $2::uuid
           )
           INSERT INTO reservation
             (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id, payment_method_id,
              reference_code, status, pickup_at, due_at, timezone_snapshot, customer_snapshot,
              price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor, completed_at)
           SELECT $1, COALESCE($10::uuid, $2::uuid), $3, $4, $5, $6, $7, $8,
                  ((clock.today + $9::int)::timestamp + make_interval(hours => $11::int)) AT TIME ZONE clock.timezone,
                  ((clock.today + $12::int)::timestamp + make_interval(hours => $13::int)) AT TIME ZONE clock.timezone,
                  clock.timezone,
                  jsonb_build_object(
                    'full_name', 'Dashboard Customer',
                    'email', 'secret@example.test',
                    'phone', $16::text
                  ),
                  '{}'::jsonb, 'PHP', $14, 0, $14,
                  CASE WHEN $15::int IS NULL THEN NULL ELSE
                    (((date_trunc('month', statement_timestamp() AT TIME ZONE clock.timezone)
                       + make_interval(months => $15::int))::date + 5)::timestamp AT TIME ZONE clock.timezone)
                  END
             FROM branch_clock clock
           RETURNING id`,
          [
            seed.tenantId,
            seed.branchId,
            seed.customerId,
            seed.storefrontId,
            seed.policyId,
            seed.paymentMethodId,
            input.label,
            input.status,
            input.pickupDayOffset,
            input.branchId ?? null,
            input.pickupHour,
            input.dueDayOffset,
            input.dueHour,
            input.amount,
            input.completedMonthOffset ?? null,
            input.snapshotPhone ?? null,
          ],
        );
        const id = requireId(result.rows[0]?.id, `${input.label} reservation`);
        await client.query(
          `INSERT INTO reservation_line
             (tenant_id, reservation_id, variant_id, line_number, name_snapshot, measurements_snapshot,
              pricing_snapshot, rental_minor, deposit_minor, currency)
           VALUES ($1, $2, $3, 1, $4, '{}'::jsonb, '{}'::jsonb, $5, 0, 'PHP')`,
          [seed.tenantId, id, seed.variantId, input.label, input.lineAmount ?? input.amount],
        );
        return id;
      };

      const pickupId = await insertReservation({
        label: 'Today Pickup Gown',
        status: 'confirmed',
        pickupDayOffset: 0,
        pickupHour: 0,
        dueDayOffset: 2,
        dueHour: 12,
        amount: 3000,
        lineAmount: 1000,
        snapshotPhone: '555-0101',
      });
      await client.query(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot, measurements_snapshot,
            pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 2, 'Second Pickup Gown', '{}'::jsonb, '{}'::jsonb, 2000, 0, 'PHP')`,
        [seed.tenantId, pickupId, seed.variantId],
      );
      const returnId = await insertReservation({
        label: 'Today Return Gown',
        status: 'picked_up',
        pickupDayOffset: -2,
        pickupHour: 10,
        dueDayOffset: 0,
        dueHour: 13,
        amount: 2000,
      });
      await insertReservation({
        label: 'Active Gown',
        status: 'picked_up',
        pickupDayOffset: -2,
        pickupHour: 11,
        dueDayOffset: 3,
        dueHour: 14,
        amount: 3000,
      });
      await insertReservation({
        label: 'Upcoming Gown',
        status: 'pending_confirmation',
        pickupDayOffset: 1,
        pickupHour: 10,
        dueDayOffset: 3,
        dueHour: 12,
        amount: 4000,
      });
      await insertReservation({
        label: 'Second Upcoming Gown',
        status: 'confirmed',
        pickupDayOffset: 2,
        pickupHour: 11,
        dueDayOffset: 4,
        dueHour: 12,
        amount: 5000,
      });
      const currentCompleteId = await insertReservation({
        label: 'Current Completed Gown',
        status: 'completed',
        pickupDayOffset: -10,
        pickupHour: 10,
        dueDayOffset: -9,
        dueHour: 10,
        amount: 12000,
        completedMonthOffset: 0,
      });
      await insertReservation({
        label: 'Previous Completed Gown',
        status: 'completed',
        pickupDayOffset: -40,
        pickupHour: 10,
        dueDayOffset: -39,
        dueHour: 10,
        amount: 7000,
        completedMonthOffset: -1,
      });

      const otherBranchStorefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
        [seed.tenantId, seed.otherBranchId, `other-${seed.tenantId.slice(0, 8)}`],
      );
      const otherStorefrontId = requireId(
        otherBranchStorefront.rows[0]?.id,
        'other branch storefront',
      );
      const otherPolicy = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
            delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 'dashboard fixture', statement_timestamp()) RETURNING id`,
        [seed.tenantId, otherStorefrontId],
      );
      const otherPolicyId = requireId(otherPolicy.rows[0]?.id, 'other branch policy');
      await client.query(
        `WITH clock AS (
           SELECT b.timezone, (statement_timestamp() AT TIME ZONE b.timezone)::date AS today
             FROM branch b WHERE b.tenant_id = $1::uuid AND b.id = $2::uuid
         )
         INSERT INTO reservation
           (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, customer_snapshot,
            price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor)
         SELECT $1, $2, $3, $4, $5, $6, 'Other branch reservation', 'confirmed',
                ((clock.today)::timestamp + interval '10 hours') AT TIME ZONE clock.timezone,
                ((clock.today + 1)::timestamp + interval '10 hours') AT TIME ZONE clock.timezone,
                clock.timezone, '{"full_name":"Foreign Branch Customer"}'::jsonb,
                '{}'::jsonb, 'PHP', 500, 0, 500 FROM clock`,
        [
          seed.tenantId,
          seed.otherBranchId,
          seed.customerId,
          otherStorefrontId,
          otherPolicyId,
          seed.paymentMethodId,
        ],
      );

      const paymentRows = await client.query<{ id: string }>(
        `INSERT INTO payment (tenant_id, reservation_id, payment_method_id, amount_minor, currency, business_key)
         VALUES ($1, $2, $3, 1000, 'PHP', 'dashboard-uploaded'),
                ($1, $2, $3, 1000, 'PHP', 'dashboard-under-review'),
                ($1, $2, $3, 1000, 'PHP', 'dashboard-verified') RETURNING id`,
        [seed.tenantId, pickupId, seed.paymentMethodId],
      );
      const evidenceStatuses = ['uploaded', 'under_review', 'verified'] as const;
      for (const [index, payment] of paymentRows.rows.entries()) {
        const file = await client.query<{ id: string }>(
          `INSERT INTO file_object
             (tenant_id, purpose, storage_key, mime_type, byte_size, lifecycle_status,
              is_private, upload_expires_at)
           VALUES ($1, 'payment_receipt', $2, 'image/png', 100, 'uploaded', true,
                   statement_timestamp() + interval '1 day') RETURNING id`,
          [seed.tenantId, `dashboard-test-${index}`],
        );
        await client.query(
          `INSERT INTO payment_receipt (tenant_id, payment_id, file_id, evidence_status)
           VALUES ($1, $2, $3, $4)`,
          [
            seed.tenantId,
            payment.id,
            requireId(file.rows[0]?.id, 'receipt file'),
            evidenceStatuses[index],
          ],
        );
      }

      await insertFitting(seed, client, {
        label: 'today',
        dayOffset: 0,
        hour: 9,
        channel: 'staff',
        slotId: seed.slotIds[0],
        internalNote: 'private fitting note',
      });
      await insertFitting(seed, client, {
        label: 'upcoming',
        dayOffset: 1,
        hour: 10,
        channel: 'storefront',
        slotId: seed.slotIds[1],
        name: 'Storefront Fitting Gown',
      });
      await insertFitting(seed, client, {
        label: 'two-day-window',
        dayOffset: 2,
        hour: 10,
        channel: 'staff',
        slotId: seed.slotIds[1],
        name: 'Two-Day Window Fitting Gown',
      });
      await insertFitting(seed, client, {
        label: 'outside-window',
        dayOffset: 3,
        hour: 10,
        channel: 'staff',
        slotId: seed.slotIds[1],
        name: 'Outside-Window Fitting Gown',
      });

      const completeRow = await client.query<{ completed_at: Date }>(
        `SELECT completed_at FROM reservation WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, currentCompleteId],
      );
      expect(completeRow.rows[0]?.completed_at).toBeTruthy();
      expect(returnId).toBeTruthy();
    });
  }

  function insertFitting(
    seed: DashboardSeed,
    client: import('pg').PoolClient,
    input: {
      label: string;
      dayOffset: number;
      hour: number;
      channel: 'staff' | 'storefront';
      slotId: string;
      internalNote?: string;
      name?: string;
    },
  ): Promise<void> {
    return (async () => {
      const appointment = await client.query<{ id: string }>(
        `WITH clock AS (
           SELECT b.timezone, (statement_timestamp() AT TIME ZONE b.timezone)::date AS today
             FROM branch b WHERE b.tenant_id = $1::uuid AND b.id = $2::uuid
         )
         INSERT INTO fitting_appointment
           (tenant_id, branch_id, customer_id, booking_channel, status, period, timezone_snapshot,
            currency, fee_minor, internal_note, business_key)
         SELECT $1, $2, $3, $4, 'pending',
                tstzrange(
                  ((clock.today + $5::int)::timestamp + make_interval(hours => $6::int)) AT TIME ZONE clock.timezone,
                  ((clock.today + $5::int)::timestamp + make_interval(hours => $6::int, mins => 60)) AT TIME ZONE clock.timezone,
                  '[)'
                ), clock.timezone, 'PHP', 500, $7, $8
           FROM clock RETURNING id`,
        [
          seed.tenantId,
          seed.branchId,
          seed.customerId,
          input.channel,
          input.dayOffset,
          input.hour,
          input.internalNote ?? null,
          `dashboard-${input.label}-${seed.tenantId}`,
        ],
      );
      const fittingId = requireId(appointment.rows[0]?.id, 'fitting appointment');
      await client.query(
        `INSERT INTO fitting_line (tenant_id, fitting_id, variant_id, asset_id, garment_guaranteed)
         VALUES ($1, $2, $3, NULL, false)`,
        [seed.tenantId, fittingId, seed.variantId],
      );
      if (input.name) {
        const otherProduct = await client.query<{ id: string }>(
          `INSERT INTO product (tenant_id, code, name, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
          [seed.tenantId, `FIT-${seed.tenantId.slice(0, 6)}-${input.label}`, input.name],
        );
        const otherVariant = await client.query<{ id: string }>(
          `INSERT INTO product_variant
             (tenant_id, product_id, sku, size_label, color_label, measurement_mode, measurement_unit,
              measurements, rental_price_minor, currency, pricing_mode, included_duration_minutes, status)
           VALUES ($1, $2, $3, 'Free size', 'Green', 'none', 'cm', '{}'::jsonb, 1000,
                   'PHP', 'fixed_duration', 1440, 'active') RETURNING id`,
          [
            seed.tenantId,
            requireId(otherProduct.rows[0]?.id, 'fitting product'),
            `FIT-SKU-${seed.tenantId.slice(0, 6)}-${input.label}`,
          ],
        );
        await client.query(
          `UPDATE fitting_line SET variant_id = $3 WHERE tenant_id = $1 AND fitting_id = $2`,
          [seed.tenantId, fittingId, requireId(otherVariant.rows[0]?.id, 'fitting variant')],
        );
      }
      await client.query(
        `INSERT INTO fitting_slot_allocation (tenant_id, slot_id, fitting_id, period, is_blocking)
         SELECT $1, $3, $2, fa.period, true
           FROM fitting_appointment fa WHERE fa.tenant_id = $1 AND fa.id = $2`,
        [seed.tenantId, fittingId, input.slotId],
      );
    })();
  }

  function useClerk(seed: Pick<DashboardSeed, 'principalId' | 'clerkOrgId'>): void {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }
});

function requireId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} insert returned no id`);
  return value;
}
