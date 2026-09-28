import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  customerDetailResponse,
  customerListResponse,
  customerReservationHistoryResponse,
  customerSummaryResponse,
  successEnvelope,
} from '@drezivo/contracts';

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

describe('Customers read routes', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('requires authenticated staff access for the customer directory', async () => {
    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const response = await request(createApp()).get('/api/v1/customers');
    expect(response.status).toBe(401);
  });

  it('requires reservations.manage on the active branch', async () => {
    const seed = await seedWorkspace('org_customers_permission', 'user_customers_permission', []);
    useClerk(seed);
    const response = await request(createApp()).get('/api/v1/customers');
    expect(response.status).toBe(403);
  });

  it('paginates active customers deterministically and excludes other tenants', async () => {
    const seed = await seedWorkspace('org_customers_list', 'user_customers_list', ['reservations.manage']);
    const foreign = await seedWorkspace('org_customers_foreign', 'user_customers_foreign', ['reservations.manage']);
    useClerk(seed);

    await seedCustomer(seed, 'Carla Cruz', '09170000003', null);
    const annaId = await seedCustomer(seed, 'Anna Reyes', '09170000001', null);
    const beaId = await seedCustomer(seed, 'Bea Santos', null, 'bea@example.test');
    await seedCustomer(seed, 'Archived Person', '09170000004', null, { archived: true });
    await seedCustomer(foreign, 'Foreign Person', '09170000005', null);

    const first = await request(createApp()).get('/api/v1/customers?limit=2');
    expect(first.status).toBe(200);
    const firstBody = successEnvelope(customerListResponse).parse(first.body);
    expect(firstBody.data.items.map((item) => item.id)).toEqual([annaId, beaId]);
    expect(firstBody.data.page_meta.has_more).toBe(true);

    const nextCursor = firstBody.data.page_meta.next_cursor;
    if (!nextCursor) throw new Error('expected next customer cursor');
    const second = await request(createApp()).get(
      `/api/v1/customers?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
    );
    expect(second.status).toBe(200);
    const secondBody = successEnvelope(customerListResponse).parse(second.body);
    expect(secondBody.data.items).toHaveLength(1);
    expect(secondBody.data.items[0]?.full_name).toBe('Carla Cruz');
  });

  it('computes customer summary counts from active profiles and qualifying branch activity', async () => {
    const seed = await seedWorkspace('org_customers_summary', 'user_customers_summary', ['reservations.manage']);
    useClerk(seed);
    const returningId = await seedCustomer(seed, 'Returning Customer', '09170000011', null);
    const upcomingId = await seedCustomer(seed, 'Upcoming Customer', '09170000012', null);
    const oldId = await seedCustomer(seed, 'Old Customer', '09170000013', null);
    await seedCustomer(seed, 'Archived Customer', '09170000014', null, { archived: true });

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(`UPDATE customer SET created_at = now() - interval '40 days' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, oldId]),
    );
    await seedFitting(seed, returningId, 'completed', -72, 'summary-returning-1');
    await seedFitting(seed, returningId, 'completed', -48, 'summary-returning-2');
    await seedFitting(seed, upcomingId, 'confirmed', 72, 'summary-upcoming');
    await seedFitting(seed, oldId, 'no_show', 96, 'summary-no-show');

    const response = await request(createApp()).get('/api/v1/customers/summary');
    expect(response.status).toBe(200);
    const body = successEnvelope(customerSummaryResponse).parse(response.body);
    expect(body.data).toEqual({
      all_customers: 3,
      new_this_month: 2,
      returning_customers: 1,
      upcoming_customers: 1,
    });
  });

  it('returns one live customer detail and conceals foreign tenant ids', async () => {
    const seed = await seedWorkspace('org_customers_detail', 'user_customers_detail', ['reservations.manage']);
    const foreign = await seedWorkspace('org_customers_detail_foreign', 'user_customers_detail_foreign', ['reservations.manage']);
    useClerk(seed);
    const customerId = await seedCustomer(seed, 'Detail Customer', '09175550001', 'detail@example.test', {
      notes: 'Staff-only note',
      address: '24 Sampaguita Street',
      socialMedia: '@detail.customer',
    });
    const foreignCustomerId = await seedCustomer(foreign, 'Foreign Detail', '09175550002', null);
    await seedFitting(seed, customerId, 'completed', -48, 'detail-completed');
    await seedFitting(seed, customerId, 'confirmed', 72, 'detail-upcoming');

    const response = await request(createApp()).get(`/api/v1/customers/${customerId}`);
    expect(response.status).toBe(200);
    const body = successEnvelope(customerDetailResponse).parse(response.body);
    expect(body.data).toMatchObject({
      id: customerId,
      full_name: 'Detail Customer',
      phone: '09175550001',
      email: 'detail@example.test',
      address: '24 Sampaguita Street',
      social_media: '@detail.customer',
      notes: 'Staff-only note',
      status: 'active',
      reservation_count: 0,
      fitting_count: 2,
      completed_engagement_count: 1,
    });
    expect(body.data.last_activity?.type).toBe('fitting');
    expect(body.data.next_activity?.type).toBe('fitting');

    const concealed = await request(createApp()).get(`/api/v1/customers/${foreignCustomerId}`);
    expect(concealed.status).toBe(404);
  });

  it('paginates branch-scoped reservation history from immutable reservation snapshots', async () => {
    const seed = await seedWorkspace(
      'org_customers_reservation_history',
      'user_customers_reservation_history',
      ['reservations.manage'],
    );
    const foreign = await seedWorkspace(
      'org_customers_reservation_history_foreign',
      'user_customers_reservation_history_foreign',
      ['reservations.manage'],
    );
    useClerk(seed);
    const customerId = await seedCustomer(seed, 'History Customer', '09176660001', null);
    const foreignCustomerId = await seedCustomer(foreign, 'Foreign History', '09176660002', null);
    const secondBranchId = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, timezone, status)
         VALUES ($1, 'Other Branch', 'OTHER', 'Asia/Manila', 'active') RETURNING id`,
        [seed.tenantId],
      );
      const id = branch.rows[0]?.id;
      if (!id) throw new Error('second branch insert returned no row');
      return id;
    });

    await seedReservationHistory(seed, customerId, {
      referenceCode: 'RSV-HISTORY-001',
      lineName: 'Oldest Snapshot Gown',
      createdOffsetHours: -72,
    });
    await seedReservationHistory(seed, customerId, {
      referenceCode: 'RSV-HISTORY-002',
      lineName: 'Middle Snapshot Gown',
      createdOffsetHours: -48,
    });
    await seedReservationHistory(seed, customerId, {
      referenceCode: 'RSV-HISTORY-003',
      lineName: 'Newest Snapshot Gown',
      createdOffsetHours: -24,
    });
    await seedReservationHistory(seed, customerId, {
      referenceCode: 'RSV-OTHER-BRANCH',
      lineName: 'Other Branch Snapshot',
      createdOffsetHours: -12,
      branchId: secondBranchId,
    });

    const first = await request(createApp()).get(`/api/v1/customers/${customerId}/reservations?limit=2`);
    expect(first.status).toBe(200);
    const firstBody = successEnvelope(customerReservationHistoryResponse).parse(first.body);
    expect(firstBody.data.items.map((item) => item.clothing_name_snapshot)).toEqual([
      'Newest Snapshot Gown',
      'Middle Snapshot Gown',
    ]);
    expect(firstBody.data.page_meta.has_more).toBe(true);

    const cursor = firstBody.data.page_meta.next_cursor;
    if (!cursor) throw new Error('expected reservation history cursor');
    const second = await request(createApp()).get(
      `/api/v1/customers/${customerId}/reservations?limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(second.status).toBe(200);
    const secondBody = successEnvelope(customerReservationHistoryResponse).parse(second.body);
    expect(secondBody.data.items.map((item) => item.clothing_name_snapshot)).toEqual([
      'Oldest Snapshot Gown',
    ]);

    const concealed = await request(createApp()).get(
      `/api/v1/customers/${foreignCustomerId}/reservations?limit=10`,
    );
    expect(concealed.status).toBe(404);
  });

  it('searches only name phone and email and supports archived/all status filters', async () => {
    const seed = await seedWorkspace('org_customers_filters', 'user_customers_filters', ['reservations.manage']);
    useClerk(seed);
    await seedCustomer(seed, 'Maria Santos', '09175550101', 'maria@example.test');
    await seedCustomer(seed, 'Archived Maria', '09990000000', 'old@example.test', { archived: true });
    await seedCustomer(seed, 'Notes Match', '08880000000', 'notes@example.test', { notes: 'secretneedle' });

    const active = await request(createApp()).get('/api/v1/customers?search=maria');
    const activeBody = successEnvelope(customerListResponse).parse(active.body);
    expect(activeBody.data.items.map((item) => item.full_name)).toEqual(['Maria Santos']);

    const archived = await request(createApp()).get('/api/v1/customers?search=maria&status=archived');
    const archivedBody = successEnvelope(customerListResponse).parse(archived.body);
    expect(archivedBody.data.items.map((item) => item.full_name)).toEqual(['Archived Maria']);

    const privateSearch = await request(createApp()).get('/api/v1/customers?search=secretneedle&status=all');
    const privateSearchBody = successEnvelope(customerListResponse).parse(privateSearch.body);
    expect(privateSearchBody.data.items).toEqual([]);
  });

  async function seedWorkspace(clerkOrgId: string, principalId: string, permissions: string[]) {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    const branchId = await withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active') RETURNING id`,
        [tenant.id],
      );
      const id = branch.rows[0]?.id;
      if (!id) throw new Error('branch insert returned no row');
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, id, membershipId, JSON.stringify(permissions)],
      );
      await client.query(
        `INSERT INTO fitting_settings
           (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency, version)
         VALUES ($1, $2, true, 10, 60, 0, 'PHP', 1)`,
        [tenant.id, id],
      );
      const plan = await client.query<{ id: string }>(`SELECT id FROM plan WHERE code = 'starter' AND version = 1 AND active LIMIT 1`);
      const planId = plan.rows[0]?.id;
      if (!planId) throw new Error('starter plan missing');
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );
      return id;
    });
    return { tenantId: tenant.id, clerkOrgId: tenant.clerkOrgId, principalId, branchId };
  }

  async function seedReservationHistory(
    seed: { tenantId: string; principalId: string; branchId: string },
    customerId: string,
    input: {
      referenceCode: string;
      lineName: string;
      createdOffsetHours: number;
      branchId?: string;
    },
  ): Promise<string> {
    const branchId = input.branchId ?? seed.branchId;
    const suffix = input.referenceCode.toLowerCase();
    const createdAt = new Date(Date.now() + input.createdOffsetHours * 60 * 60 * 1000);
    const pickupAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    const dueAt = new Date(pickupAt.getTime() + 24 * 60 * 60 * 1000);

    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const storefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
        [seed.tenantId, branchId, `customer-${suffix}`],
      );
      const storefrontId = storefront.rows[0]?.id;
      if (!storefrontId) throw new Error('storefront insert returned no row');
      const policy = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules,
            cancellation_rules, delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 'Customer history policy', now()) RETURNING id`,
        [seed.tenantId, storefrontId],
      );
      const policyId = policy.rows[0]?.id;
      if (!policyId) throw new Error('policy insert returned no row');
      const paymentMethod = await client.query<{ id: string }>(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES ($1, $2, 'cash', '{}'::jsonb, true, 1) RETURNING id`,
        [seed.tenantId, `Cash ${suffix}`],
      );
      const paymentMethodId = paymentMethod.rows[0]?.id;
      if (!paymentMethodId) throw new Error('payment method insert returned no row');
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [seed.tenantId, `P-${suffix}`, `Live ${input.lineName}`],
      );
      const productId = product.rows[0]?.id;
      if (!productId) throw new Error('reservation history product insert returned no row');
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, measurements, measurement_unit,
            measurement_mode, rental_price_minor, security_deposit_minor, currency,
            pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes,
            turnaround_minutes, status)
         VALUES ($1, $2, $3, 'M', '{}'::jsonb, 'cm', 'none', 350000, 0, 'PHP',
                 'fixed_duration', 1440, 0, 0, 0, 'active') RETURNING id`,
        [seed.tenantId, productId, `SKU-${suffix}`],
      );
      const variantId = variant.rows[0]?.id;
      if (!variantId) throw new Error('reservation history variant insert returned no row');
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservation
           (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id,
            payment_method_id, reference_code, status, pickup_at, due_at, timezone_snapshot,
            customer_snapshot, delivery_snapshot, price_snapshot, currency, rental_total_minor,
            security_required_minor, due_now_minor, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8::timestamptz, $9::timestamptz,
                 'Asia/Manila', '{"full_name":"Historical Customer","phone":null,"email":null,"address":null}'::jsonb,
                 '{"fulfillment_method":"pickup"}'::jsonb,
                 '{"rental_total_minor":"350000","security_required_minor":"0","due_now_minor":"350000","currency":"PHP"}'::jsonb,
                 'PHP', 350000, 0, 350000, $10::timestamptz)
         RETURNING id`,
        [
          seed.tenantId,
          branchId,
          customerId,
          storefrontId,
          policyId,
          paymentMethodId,
          input.referenceCode,
          pickupAt.toISOString(),
          dueAt.toISOString(),
          createdAt.toISOString(),
        ],
      );
      const reservationId = reservation.rows[0]?.id;
      if (!reservationId) throw new Error('reservation history insert returned no row');
      await client.query(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, $4, '{}'::jsonb,
                 '{"rental_minor":"350000","deposit_minor":"0","currency":"PHP"}'::jsonb,
                 350000, 0, 'PHP')`,
        [seed.tenantId, reservationId, variantId, input.lineName],
      );
      return reservationId;
    });
  }

  async function seedFitting(
    seed: { tenantId: string; principalId: string; branchId: string },
    customerId: string,
    status: 'confirmed' | 'completed' | 'no_show',
    startOffsetHours: number,
    businessKey: string,
  ): Promise<void> {
    const start = new Date(Date.now() + startOffsetHours * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO fitting_appointment
           (tenant_id, branch_id, customer_id, booking_channel, status, period,
            timezone_snapshot, currency, fee_minor, business_key, version)
         VALUES ($1, $2, $3, 'staff', 'pending',
                 tstzrange($4::timestamptz, $5::timestamptz, '[)'),
                 'Asia/Manila', 'PHP', 0, $6, 1)
         RETURNING id`,
        [seed.tenantId, seed.branchId, customerId, start.toISOString(), end.toISOString(), businessKey],
      );
      const fittingId = inserted.rows[0]?.id;
      if (!fittingId) throw new Error('fitting insert returned no row');
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, $2, 'Summary Garment', 'active') RETURNING id`,
        [seed.tenantId, `P-${businessKey}`],
      );
      const productId = product.rows[0]?.id;
      if (!productId) throw new Error('product insert returned no row');
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, measurements, measurement_unit, measurement_mode,
            rental_price_minor, security_deposit_minor, currency, pricing_mode,
            included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, $3, 'M', '{}'::jsonb, 'cm', 'none', 1000, 0, 'PHP',
                 'fixed_duration', 1440, 0, 0, 0, 'active') RETURNING id`,
        [seed.tenantId, productId, `SKU-${businessKey}`],
      );
      const variantId = variant.rows[0]?.id;
      if (!variantId) throw new Error('variant insert returned no row');
      await client.query(
        `INSERT INTO fitting_line (tenant_id, fitting_id, variant_id, asset_id, garment_guaranteed)
         VALUES ($1, $2, $3, NULL, false)`,
        [seed.tenantId, fittingId, variantId],
      );
      const slot = await client.query<{ id: string }>(
        `INSERT INTO fitting_capacity_slot (tenant_id, branch_id, slot_number, active)
         SELECT $1, $2, coalesce(max(slot_number), 0) + 1, true
         FROM fitting_capacity_slot
         WHERE tenant_id = $1 AND branch_id = $2
         RETURNING id`,
        [seed.tenantId, seed.branchId],
      );
      const slotId = slot.rows[0]?.id;
      if (!slotId) throw new Error('fitting slot insert returned no row');
      const allocation = await client.query<{ id: string }>(
        `INSERT INTO fitting_slot_allocation (tenant_id, slot_id, fitting_id, period, is_blocking)
         VALUES ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), true)
         RETURNING id`,
        [seed.tenantId, slotId, fittingId, start.toISOString(), end.toISOString()],
      );
      const allocationId = allocation.rows[0]?.id;
      if (!allocationId) throw new Error('fitting slot allocation insert returned no row');
      await client.query(
        `UPDATE fitting_appointment SET status = 'confirmed', version = version + 1 WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, fittingId],
      );
      if (status !== 'confirmed') {
        await client.query(
          `UPDATE fitting_slot_allocation SET is_blocking = false, released_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [seed.tenantId, allocationId],
        );
        await client.query(
          `UPDATE fitting_appointment SET status = $3, version = version + 1 WHERE tenant_id = $1 AND id = $2`,
          [seed.tenantId, fittingId, status],
        );
      }
    });
  }

  async function seedCustomer(
    seed: { tenantId: string; principalId: string },
    fullName: string,
    phone: string | null,
    email: string | null,
    options: {
      archived?: boolean;
      notes?: string;
      address?: string;
      socialMedia?: string;
    } = {},
  ): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO customer
           (tenant_id, full_name, phone, email, notes, address, social_media, archived_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::boolean THEN now() ELSE NULL END)
         RETURNING id`,
        [
          seed.tenantId,
          fullName,
          phone,
          email,
          options.notes ?? null,
          options.address ?? null,
          options.socialMedia ?? null,
          options.archived ?? false,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('customer insert returned no row');
      return id;
    });
  }

  function useClerk(seed: { principalId: string; clerkOrgId: string }): void {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }
});
