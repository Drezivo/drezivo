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
  membershipId: string;
  principalId: string;
  clerkOrgId: string;
  storefrontId: string;
  policyId: string;
  paymentMethodId: string;
  customerId: string;
  variantId: string;
  slotIds: [string, string];
}

const DASHBOARD_MONTHLY_METRIC_FIXTURE_SQL = `WITH branch_window AS (
       SELECT
         b.timezone,
         (date_trunc('month', statement_timestamp() AT TIME ZONE b.timezone)::date::timestamp
           AT TIME ZONE b.timezone) AS month_start,
         ((date_trunc('month', statement_timestamp() AT TIME ZONE b.timezone)::date
           + interval '1 month')::timestamp AT TIME ZONE b.timezone) AS month_end
       FROM branch b
       WHERE b.tenant_id = $1::uuid AND b.id = $2::uuid
     ),
     monthly_facts(reference_code, status, pickup_at, line_count) AS (
       SELECT 'monthly-start-confirmed', 'confirmed', w.month_start, 2 FROM branch_window w
       UNION ALL
       SELECT 'monthly-picked-up', 'picked_up', w.month_start + interval '2 days', 1 FROM branch_window w
       UNION ALL
       SELECT 'monthly-returned', 'returned', w.month_start + interval '3 days', 1 FROM branch_window w
       UNION ALL
       SELECT 'monthly-completed', 'completed', w.month_end - interval '2 seconds', 1 FROM branch_window w
       UNION ALL
       SELECT 'before-month', 'confirmed', w.month_start - interval '1 second', 1 FROM branch_window w
       UNION ALL
       SELECT 'after-month', 'confirmed', w.month_end, 1 FROM branch_window w
       UNION ALL
       SELECT 'monthly-held', 'held', w.month_start + interval '4 days', 1 FROM branch_window w
       UNION ALL
       SELECT 'monthly-pending', 'pending_confirmation', w.month_start + interval '5 days', 1 FROM branch_window w
       UNION ALL
       SELECT 'monthly-cancelled', 'cancelled', w.month_start + interval '6 days', 1 FROM branch_window w
       UNION ALL
       SELECT 'monthly-expired', 'expired', w.month_start + interval '7 days', 1 FROM branch_window w
       UNION ALL
       SELECT 'monthly-rejected', 'rejected', w.month_start + interval '8 days', 1 FROM branch_window w
     ),
     inserted_reservations AS (
       INSERT INTO reservation
         (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id, payment_method_id,
          reference_code, status, pickup_at, due_at, timezone_snapshot, customer_snapshot,
          price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor,
          completed_at)
       SELECT $1, $2, $3, $4, $5, $6, facts.reference_code, facts.status,
              facts.pickup_at, facts.pickup_at + interval '1 day', w.timezone,
              '{}'::jsonb, '{}'::jsonb, 'PHP', 1000, 0, 1000,
              CASE WHEN facts.status = 'completed' THEN statement_timestamp() END
       FROM monthly_facts facts
       CROSS JOIN branch_window w
       RETURNING id, reference_code
     )
     INSERT INTO reservation_line
       (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
        measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
     SELECT $1, reservation.id, $7, line.line_number,
            reservation.reference_code || ' item ' || line.line_number,
            '{}'::jsonb, '{}'::jsonb, 1000, 0, 'PHP'
     FROM inserted_reservations reservation
     JOIN monthly_facts facts USING (reference_code)
     CROSS JOIN LATERAL generate_series(1, facts.line_count) AS line(line_number)`;

function monthKeyAt(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Could not derive the branch-local month.');
  return `${year}-${month}`;
}

function shiftMonth(month: string, offset: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('A valid year-month value is required.');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
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

  it('filters completed and upcoming expected sales by their inclusive branch-local months', async () => {
    const seed = await seedDashboardWorkspace(
      'dashboard_expected_sales_months',
      'user_dashboard_expected_sales_months',
      ['reservations.manage'],
    );
    useClerk(seed);
    await insertExpectedSalesReservation(seed, {
      label: 'Previous month completed',
      status: 'completed',
      monthOffset: -1,
      amount: 150000,
      completedMonthOffset: 0,
    });
    await insertExpectedSalesReservation(seed, {
      label: 'Current month completed',
      status: 'completed',
      monthOffset: 0,
      amount: 50000,
      completedMonthOffset: -1,
    });
    await insertExpectedSalesReservation(seed, {
      label: 'Next month confirmed',
      status: 'confirmed',
      monthOffset: 1,
      day: -1,
      hour: 23,
      minute: 59,
      second: 59,
      amount: 100000,
      securityRequiredAmount: 900000,
    });
    await insertExpectedSalesReservation(seed, {
      label: 'Following month confirmed',
      status: 'confirmed',
      monthOffset: 2,
      amount: 200000,
    });

    const read = async (query = '') => {
      const response = await request(createApp()).get(`/api/v1/dashboard/overview${query}`);
      expect(response.status).toBe(200);
      return successEnvelope(dashboardOverviewResponse).parse(response.body).data;
    };
    const defaultMonth = await read();
    const currentMonth = monthKeyAt(defaultMonth.window.as_of, defaultMonth.window.timezone);
    const previousMonth = shiftMonth(currentMonth, -1);
    const nextMonth = shiftMonth(currentMonth, 1);
    const allTime = await read('?all_time=true');
    const fromCurrentMonth = await read(`?start_month=${currentMonth}`);
    const throughCurrentMonth = await read(`?end_month=${currentMonth}`);
    const currentMonthOnly = await read(
      `?start_month=${currentMonth}&end_month=${currentMonth}`,
    );
    const currentThroughNextMonth = await read(
      `?start_month=${currentMonth}&end_month=${nextMonth}`,
    );
    const throughPreviousMonth = await read(`?end_month=${previousMonth}`);

    expect(defaultMonth.business_performance.projected_rental_value).toEqual({
      current_minor: '150000',
      reservations: 0,
    });
    expect(defaultMonth.business_performance.projected_rental_value).toEqual(
      defaultMonth.business_performance.projected_sales_current_month,
    );
    expect(allTime.business_performance.projected_rental_value).toEqual({
      current_minor: '500000',
      reservations: 2,
    });
    expect(fromCurrentMonth.business_performance.projected_rental_value).toEqual({
      current_minor: '450000',
      reservations: 2,
    });
    expect(throughCurrentMonth.business_performance.projected_rental_value).toEqual({
      current_minor: '200000',
      reservations: 0,
    });
    expect(currentMonthOnly.business_performance.projected_rental_value).toEqual(
      defaultMonth.business_performance.projected_sales_current_month,
    );
    expect(currentThroughNextMonth.business_performance.projected_rental_value).toEqual({
      current_minor: '250000',
      reservations: 1,
    });
    expect(throughPreviousMonth.business_performance.projected_rental_value).toEqual({
      current_minor: '50000',
      reservations: 0,
    });
    expect(currentThroughNextMonth.business_performance).toMatchObject({
      completed_rental_value: defaultMonth.business_performance.completed_rental_value,
      projected_sales_current_month:
        defaultMonth.business_performance.projected_sales_current_month,
      completed_rentals: defaultMonth.business_performance.completed_rentals,
      new_customers: defaultMonth.business_performance.new_customers,
    });
  });

  it('counts completed and upcoming sales while excluding overdue and other ineligible statuses', async () => {
    const seed = await seedDashboardWorkspace(
      'dashboard_expected_sales_statuses',
      'user_dashboard_expected_sales_statuses',
      ['reservations.manage'],
    );
    useClerk(seed);
    const included = [
      {
        label: 'Completed booking',
        status: 'completed',
        monthOffset: -2,
        amount: 20000,
        completedMonthOffset: -1,
      },
      { label: 'Overdue confirmed booking', status: 'confirmed', monthOffset: -1, amount: 11000 },
      { label: 'Overdue picked up booking', status: 'picked_up', monthOffset: -1, amount: 12000 },
      { label: 'Overdue returned booking', status: 'returned', monthOffset: -1, amount: 13000 },
      { label: 'Upcoming confirmed booking', status: 'confirmed', monthOffset: 1, amount: 14000 },
    ] as const;
    for (const reservation of included) {
      await insertExpectedSalesReservation(seed, reservation);
    }

    for (const [index, status] of [
      'held',
      'pending_confirmation',
      'cancelled',
      'rejected',
      'expired',
    ].entries()) {
      await insertExpectedSalesReservation(seed, {
        label: `Excluded ${status}`,
        status,
        monthOffset: 0,
        amount: 50000 + index * 1000,
      });
    }
    for (const status of ['confirmed', 'picked_up', 'returned']) {
      await insertExpectedSalesReservation(seed, {
        label: `Not yet due ${status}`,
        status,
        monthOffset: -1,
        dueDaysAfterPickup: 90,
        amount: 16000,
      });
    }
    for (const status of ['picked_up', 'returned']) {
      await insertExpectedSalesReservation(seed, {
        label: `Future ${status}`,
        status,
        monthOffset: 1,
        amount: 17000,
      });
    }
    const foreignSeed = await seedDashboardWorkspace(
      'dashboard_expected_sales_foreign_tenant',
      'user_dashboard_expected_sales_foreign_tenant',
      ['reservations.manage'],
    );
    await insertExpectedSalesReservation(foreignSeed, {
      label: 'Foreign tenant confirmed booking',
      status: 'confirmed',
      monthOffset: 1,
      amount: 999999,
    });

    const response = await request(createApp()).get('/api/v1/dashboard/overview?all_time=true');
    expect(response.status).toBe(200);
    const { data } = successEnvelope(dashboardOverviewResponse).parse(response.body);
    expect(data.business_performance.projected_rental_value).toEqual({
      current_minor: '34000',
      reservations: 1,
    });
  });

  it('keeps expected sales scoped to the requested branch', async () => {
    const seed = await seedDashboardWorkspace(
      'dashboard_expected_sales_branch_scope',
      'user_dashboard_expected_sales_branch_scope',
      ['reservations.manage'],
    );
    useClerk(seed);
    await insertExpectedSalesReservation(seed, {
      label: 'Active branch confirmed booking',
      status: 'confirmed',
      monthOffset: 1,
      amount: 1000,
    });

    const otherBranchSetup = await withTenantTransaction(
      seed.tenantId,
      seed.principalId,
      async (client) => {
        const storefront = await client.query<{ id: string }>(
          `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
           VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}') RETURNING id`,
          [seed.tenantId, seed.otherBranchId, `expected-sales-other-${seed.tenantId.slice(0, 8)}`],
        );
        const storefrontId = requireId(storefront.rows[0]?.id, 'expected sales other storefront');
        const policy = await client.query<{ id: string }>(
          `INSERT INTO policy_snapshot
             (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
              delivery_rules, privacy_notice, effective_at)
           VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                   'dashboard fixture', statement_timestamp()) RETURNING id`,
          [seed.tenantId, storefrontId],
        );
        return {
          storefrontId,
          policyId: requireId(policy.rows[0]?.id, 'expected sales other policy'),
        };
      },
    );
    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, '["reservations.manage"]'::jsonb)`,
        [seed.tenantId, seed.otherBranchId, seed.membershipId],
      ),
    );
    await insertExpectedSalesReservation(seed, {
      label: 'Other branch confirmed booking',
      status: 'confirmed',
      monthOffset: 1,
      amount: 999999,
      branchId: seed.otherBranchId,
      storefrontId: otherBranchSetup.storefrontId,
      policyId: otherBranchSetup.policyId,
    });

    const response = await request(createApp())
      .get('/api/v1/dashboard/overview?all_time=true')
      .set('X-Drezivo-Branch-Id', seed.otherBranchId);
    expect(response.status).toBe(200);
    const { data } = successEnvelope(dashboardOverviewResponse).parse(response.body);
    expect(data.business_performance.projected_rental_value).toEqual({
      current_minor: '999999',
      reservations: 1,
    });
  });

  it('rejects malformed, reversed, and conflicting month-filter queries', async () => {
    const seed = await seedDashboardWorkspace(
      'dashboard_invalid_expected_sales_months',
      'user_dashboard_invalid_expected_sales_months',
      ['reservations.manage'],
    );
    useClerk(seed);

    for (const query of [
      '?start_month=2026-13',
      '?end_month=2026-00',
      '?start_month=2026-11&end_month=2026-10',
      '?all_time=true&start_month=2026-10',
    ]) {
      const response = await request(createApp()).get(`/api/v1/dashboard/overview${query}`);
      expect(response.status).toBe(422);
    }
  });

  it('counts monthly rental pieces across confirmed booking stages and isolates branch and tenant data', async () => {
    const seed = await seedDashboardWorkspace(
      'dashboard_monthly_items',
      'user_dashboard_monthly_items',
      ['reservations.manage'],
    );
    useClerk(seed);
    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(DASHBOARD_MONTHLY_METRIC_FIXTURE_SQL, [
        seed.tenantId,
        seed.branchId,
        seed.customerId,
        seed.storefrontId,
        seed.policyId,
        seed.paymentMethodId,
        seed.variantId,
      ]),
    );

    const otherBranchStorefront = await withTenantTransaction(
      seed.tenantId,
      seed.principalId,
      async (client) => {
        const storefront = await client.query<{ id: string }>(
          `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
           VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
          [seed.tenantId, seed.otherBranchId, `monthly-${seed.tenantId.slice(0, 8)}`],
        );
        const storefrontId = requireId(storefront.rows[0]?.id, 'monthly metric storefront');
        const policy = await client.query<{ id: string }>(
          `INSERT INTO policy_snapshot
             (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
              delivery_rules, privacy_notice, effective_at)
           VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                   'dashboard fixture', statement_timestamp()) RETURNING id`,
          [seed.tenantId, storefrontId],
        );
        return {
          storefrontId,
          policyId: requireId(policy.rows[0]?.id, 'monthly metric policy'),
        };
      },
    );
    await insertCurrentMonthConfirmedItem(seed, {
      branchId: seed.otherBranchId,
      storefrontId: otherBranchStorefront.storefrontId,
      policyId: otherBranchStorefront.policyId,
      referenceCode: 'monthly-other-branch',
    });

    const foreignSeed = await seedDashboardWorkspace(
      'dashboard_foreign_monthly_items',
      'user_dashboard_foreign_monthly_items',
      ['reservations.manage'],
    );
    await insertCurrentMonthConfirmedItem(foreignSeed, {
      branchId: foreignSeed.branchId,
      storefrontId: foreignSeed.storefrontId,
      policyId: foreignSeed.policyId,
      referenceCode: 'monthly-foreign-tenant',
    });

    const response = await request(createApp()).get('/api/v1/dashboard/overview');
    expect(response.status).toBe(200);
    const { data } = successEnvelope(dashboardOverviewResponse).parse(response.body);

    expect(data.metrics.confirmed_rental_items_current_month).toBe(5);
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

    expect(data.metrics).toMatchObject({
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
      projected_sales_current_month: { current_minor: '0', reservations: 0 },
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
          [seed.tenantId, seed.branchId, null, null, false],
        );
        return result.rows.map((row) => String(row['QUERY PLAN'])).join('\n');
      },
    );

    expect(queryPlan).not.toMatch(/Seq Scan on customer(?:\s|$)/);
    expect(queryPlan).toContain('reservation_tenant_branch_completed_at_idx');
    expect(queryPlan).toContain('customer_tenant_active_created_idx');
  });

  it('returns branch-local metrics, bounded operational lists, and safe month comparisons', async () => {
    const seed = await seedDashboardWorkspace('dashboard_overview', 'user_dashboard_overview', [
      'reservations.manage',
    ]);
    useClerk(seed);
    await seedDashboardFacts(seed);
    const foreignSeed = await seedDashboardWorkspace(
      'dashboard_foreign_projection',
      'user_dashboard_foreign_projection',
      ['reservations.manage'],
    );
    await withTenantTransaction(foreignSeed.tenantId, foreignSeed.principalId, async (client) => {
      await client.query(
        `INSERT INTO reservation
             (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id, payment_method_id,
              reference_code, status, pickup_at, due_at, timezone_snapshot, customer_snapshot,
              price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor)
           VALUES ($1, $2, $3, $4, $5, $6, 'Foreign Tenant Future Reservation', 'confirmed',
                   statement_timestamp() + interval '40 days',
                   statement_timestamp() + interval '42 days', 'America/Los_Angeles',
                   '{"full_name":"Foreign Tenant Customer"}'::jsonb,
                   '{}'::jsonb, 'PHP', 1000000, 0, 1000000)`,
        [
          foreignSeed.tenantId,
          foreignSeed.branchId,
          foreignSeed.customerId,
          foreignSeed.storefrontId,
          foreignSeed.policyId,
          foreignSeed.paymentMethodId,
        ],
      );
    });

    const response = await request(createApp()).get('/api/v1/dashboard/overview?all_time=true');
    expect(response.status).toBe(200);
    const { data } = successEnvelope(dashboardOverviewResponse).parse(response.body);

    expect(data.window.timezone).toBe('America/Los_Angeles');
    expect(Date.parse(data.window.today.start)).toBeLessThan(Date.parse(data.window.today.end));
    expect(data.window.upcoming_fittings.start).toBe(data.window.as_of);
    expect(data.metrics).toMatchObject({
      active_rentals: 2,
      pickups_today: 1,
      returns_today: 1,
      fittings_today: 1,
      payments_to_review: 2,
    });
    expect(data.metrics.confirmed_rental_items_current_month).toBeGreaterThanOrEqual(0);
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
      projected_sales_current_month: { current_minor: '17000', reservations: 1 },
      new_customers: { current: 1, previous: 1 },
    });
    expect(data.business_performance.projected_rental_value).toEqual({
      current_minor: '35500',
      reservations: 2,
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
        `SELECT id FROM plan WHERE code = 'standard' AND active = true ORDER BY version DESC LIMIT 1`,
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
        membershipId,
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
        securityRequiredAmount?: number;
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
                  '{}'::jsonb, 'PHP', $14, $17, $14::int + $17::int,
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
            input.securityRequiredAmount ?? 0,
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
        pickupDayOffset: -3,
        pickupHour: 10,
        dueDayOffset: 0,
        dueHour: 0,
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
        securityRequiredAmount: 2500,
      });
      await insertReservation({
        label: 'Future Month Confirmed Gown',
        status: 'confirmed',
        pickupDayOffset: 40,
        pickupHour: 11,
        dueDayOffset: 42,
        dueHour: 12,
        amount: 9000,
        securityRequiredAmount: 4000,
      });
      await insertReservation({
        label: 'Past Pickup Still Confirmed Gown',
        status: 'confirmed',
        pickupDayOffset: -2,
        pickupHour: 11,
        dueDayOffset: -1,
        dueHour: 12,
        amount: 8000,
      });
      await insertReservation({
        label: 'Returned Gown',
        status: 'returned',
        pickupDayOffset: -10,
        pickupHour: 11,
        dueDayOffset: -8,
        dueHour: 12,
        amount: 7000,
      });
      await insertReservation({
        label: 'Cancelled Future Gown',
        status: 'cancelled',
        pickupDayOffset: 3,
        pickupHour: 11,
        dueDayOffset: 5,
        dueHour: 12,
        amount: 6000,
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
      await insertReservation({
        label: 'Older Historical Completed Gown',
        status: 'completed',
        pickupDayOffset: -730,
        pickupHour: 10,
        dueDayOffset: -729,
        dueHour: 10,
        amount: 2500,
        completedMonthOffset: -24,
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
                ((clock.today + 10)::timestamp + interval '10 hours') AT TIME ZONE clock.timezone,
                ((clock.today + 11)::timestamp + interval '10 hours') AT TIME ZONE clock.timezone,
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

  async function insertExpectedSalesReservation(
    seed: DashboardSeed,
    input: {
      label: string;
      status: string;
      monthOffset: number;
      amount: number;
      day?: number;
      hour?: number;
      minute?: number;
      second?: number;
      dueDaysAfterPickup?: number;
      securityRequiredAmount?: number;
      completedMonthOffset?: number;
      branchId?: string;
      storefrontId?: string;
      policyId?: string;
    },
  ): Promise<void> {
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `WITH branch_clock AS (
           SELECT timezone,
                  date_trunc('month', statement_timestamp() AT TIME ZONE timezone)::date AS local_month
             FROM branch
            WHERE tenant_id = $1::uuid AND id = $2::uuid
         ), local_times AS (
           SELECT timezone,
                  (
                    CASE WHEN $10::int = -1
                      THEN (local_month + make_interval(months => $9::int + 1) - interval '1 day')::date
                      ELSE (local_month + make_interval(months => $9::int))::date + ($10::int - 1)
                    END
                  )::timestamp + make_interval(hours => $11::int, mins => $12::int, secs => $13::double precision)
                    AS pickup_local
             FROM branch_clock
         )
         INSERT INTO reservation
           (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, customer_snapshot,
            price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor,
            completed_at)
         SELECT $1, $2, $3, COALESCE($4::uuid, $5::uuid), COALESCE($6::uuid, $7::uuid), $8,
                $14, $15, local_times.pickup_local AT TIME ZONE local_times.timezone,
                (local_times.pickup_local + make_interval(days => $16::int)) AT TIME ZONE local_times.timezone,
                local_times.timezone, '{}'::jsonb, '{}'::jsonb, 'PHP', $17, $18, $17::int + $18::int,
                CASE WHEN $19::int IS NULL THEN NULL ELSE
                  (((date_trunc('month', statement_timestamp() AT TIME ZONE local_times.timezone)::date
                    + make_interval(months => $19::int))::date + 5)::timestamp AT TIME ZONE local_times.timezone)
                END
           FROM local_times
         RETURNING id`,
        [
          seed.tenantId,
          input.branchId ?? seed.branchId,
          seed.customerId,
          input.storefrontId ?? null,
          seed.storefrontId,
          input.policyId ?? null,
          seed.policyId,
          seed.paymentMethodId,
          input.monthOffset,
          input.day ?? 1,
          input.hour ?? 12,
          input.minute ?? 0,
          input.second ?? 0,
          input.label,
          input.status,
          input.dueDaysAfterPickup ?? 2,
          input.amount,
          input.securityRequiredAmount ?? 0,
          input.completedMonthOffset ?? null,
        ],
      );
      const reservationId = requireId(result.rows[0]?.id, `${input.label} reservation`);
      await client.query(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot, measurements_snapshot,
            pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, $4, '{}'::jsonb, '{}'::jsonb, $5, $6, 'PHP')`,
        [
          seed.tenantId,
          reservationId,
          seed.variantId,
          input.label,
          input.amount,
          input.securityRequiredAmount ?? 0,
        ],
      );
    });
  }

  async function insertCurrentMonthConfirmedItem(
    seed: DashboardSeed,
    input: { branchId: string; storefrontId: string; policyId: string; referenceCode: string },
  ): Promise<void> {
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservation = await client.query<{ id: string }>(
        `WITH branch_window AS (
           SELECT b.timezone,
                  (date_trunc('month', statement_timestamp() AT TIME ZONE b.timezone)::date::timestamp
                    AT TIME ZONE b.timezone) AS month_start
             FROM branch b
            WHERE b.tenant_id = $1::uuid AND b.id = $2::uuid
         )
         INSERT INTO reservation
           (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, customer_snapshot,
            price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor)
         SELECT $1, $2, $3, $4, $5, $6, $7, 'confirmed',
                branch_window.month_start + interval '2 days',
                branch_window.month_start + interval '3 days', branch_window.timezone,
                '{}'::jsonb, '{}'::jsonb, 'PHP', 1000, 0, 1000
           FROM branch_window
         RETURNING id`,
        [
          seed.tenantId,
          input.branchId,
          seed.customerId,
          input.storefrontId,
          input.policyId,
          seed.paymentMethodId,
          input.referenceCode,
        ],
      );
      const reservationId = requireId(reservation.rows[0]?.id, 'monthly metric reservation');
      await client.query(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, 'Monthly isolation fixture', '{}'::jsonb,
                 '{}'::jsonb, 1000, 0, 'PHP')`,
        [seed.tenantId, reservationId, seed.variantId],
      );
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
