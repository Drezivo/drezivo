import request from 'supertest';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerId, PermissionCode, StaffReservationCreateRequest } from '@drezivo/contracts';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';
import { reservationTestDate, reservationTestInstant } from './helpers/reservation-dates.js';

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

interface CreateSeed {
  tenantId: string;
  clerkOrgId: string;
  principalId: string;
  membershipId: string;
  branchId: string;
  storefrontId: string;
  policySnapshotId: string;
  paymentMethodId: string;
  variantId: string;
  assetId: string;
}

describe('RSV-021/022 staff reservation creation', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { createStaffReservation } = await import('../../src/modules/reservations/reservations.service.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  it('atomically creates one held reservation, customer, line, allocation, audit, outbox, and idempotency result', async () => {
    const seed = await seedWorkspace('org_rsv021_success', 'user_rsv021_success', ['reservations.manage']);
    const response = await createStaffReservation(
      commandContext(seed, 'req-rsv021-success', 'idem-rsv021-success'),
      createRequest(seed),
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        reservation: {
          status: 'held',
          branch_id: seed.branchId,
          variant_id: seed.variantId,
          fulfillment_method: 'delivery',
          price_snapshot: {
            // Oct 10 to Oct 13 is four rental days: the 3-day package plus one extra day.
            rental_total_minor: '190000',
            security_required_minor: '50000',
            due_now_minor: '265000',
            currency: 'PHP',
          },
        },
        payment_instructions: {
          method_name: 'Cash',
          rail: 'cash',
          destination_note: 'Pay at the counter before pickup.',
        },
      },
    });

    const reservationId = successReservationId(response.body);
    const persisted = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservation = await client.query<{
        status: string;
        customer_snapshot: Record<string, unknown>;
        delivery_snapshot: Record<string, unknown>;
        price_snapshot: Record<string, unknown>;
        hold_expires_at: Date;
        hold_acquired_at: Date;
      }>(
        `SELECT status, customer_snapshot, delivery_snapshot, price_snapshot,
                hold_expires_at, hold_acquired_at
           FROM reservation WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, reservationId],
      );
      const lines = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM reservation_line
          WHERE tenant_id = $1 AND reservation_id = $2`,
        [seed.tenantId, reservationId],
      );
      const allocation = await client.query<{
        asset_id: string;
        starts_at: Date;
        ends_at: Date;
        is_blocking: boolean;
      }>(
        `SELECT aa.asset_id, lower(aa.period) AS starts_at, upper(aa.period) AS ends_at, aa.is_blocking
           FROM asset_allocation aa
           JOIN reservation_line rl ON rl.tenant_id = aa.tenant_id AND rl.id = aa.reservation_line_id
          WHERE aa.tenant_id = $1 AND rl.reservation_id = $2`,
        [seed.tenantId, reservationId],
      );
      const payment = await client.query<{ status: string; amount_minor: number }>(
        `SELECT status, amount_minor FROM payment
          WHERE tenant_id = $1 AND reservation_id = $2
            AND business_key = ('reservation:' || $2::text || ':initial-payment')`,
        [seed.tenantId, reservationId],
      );
      const customer = await client.query<{ address: string | null; social_media: string | null }>(
        `SELECT address, social_media FROM customer WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      const audit = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_event
          WHERE tenant_id = $1 AND entity_id = $2 AND action = 'reservation.created'`,
        [seed.tenantId, reservationId],
      );
      const outbox = await client.query<{ event_type: string; payload: Record<string, unknown> }>(
        `SELECT event_type, payload FROM outbox_event
          WHERE tenant_id = $1 AND dedupe_key = $2`,
        [seed.tenantId, `reservation-created:${reservationId}`],
      );
      const idempotency = await client.query<{ status: string; response_code: number }>(
        `SELECT status, response_code FROM idempotency_record
          WHERE tenant_id = $1 AND principal_key = $2
            AND operation = 'reservation.staff.create.v1' AND intent_key = $3`,
        [seed.tenantId, seed.membershipId, 'idem-rsv021-success'],
      );
      return {
        reservation: requireRow(reservation.rows, 'reservation'),
        lineCount: lines.rows[0]?.count ?? 0,
        allocation: requireRow(allocation.rows, 'allocation'),
        payment: requireRow(payment.rows, 'payment intent'),
        customer: requireRow(customer.rows, 'reservation customer'),
        auditCount: audit.rows[0]?.count ?? 0,
        outbox: requireRow(outbox.rows, 'reservation outbox'),
        idempotency: requireRow(idempotency.rows, 'idempotency'),
      };
    });

    expect(persisted.reservation.status).toBe('held');
    expect(persisted.reservation.customer_snapshot).toEqual({
      full_name: 'Walk-in Customer',
      phone: '09171234567',
      email: 'walkin@example.test',
      address: '123 Test Street, Quezon City',
    });
    expect(persisted.reservation.delivery_snapshot).toEqual({
      fulfillment_method: 'delivery',
      fee_minor: '25000',
      terms: 'set_fee',
    });
    expect(persisted.reservation.price_snapshot).toMatchObject({
      rental_total_minor: '190000',
      security_required_minor: '50000',
      delivery_total_minor: '25000',
      due_now_minor: '265000',
      extra_day_count: 1,
      rental_day_basis: 'calendar_day_inclusive',
      included_rental_days: 3,
      rental_day_count: 4,
    });
    expect(persisted.reservation.hold_expires_at.getTime() - persisted.reservation.hold_acquired_at.getTime())
      .toBe(15 * 60 * 1000);
    expect(persisted.lineCount).toBe(1);
    expect(persisted.allocation).toMatchObject({ asset_id: seed.assetId, is_blocking: true });
    expect(persisted.allocation.starts_at.toISOString()).toBe(reservationTestInstant(0));
    expect(persisted.allocation.ends_at.toISOString()).toBe(reservationTestInstant(4));
    expect(persisted.payment).toEqual({ status: 'pending', amount_minor: 265000 });
    expect(persisted.customer).toEqual({
      address: '123 Test Street, Quezon City',
      social_media: '@walkin',
    });
    expect(persisted.auditCount).toBe(1);
    expect(persisted.outbox).toEqual({
      event_type: 'reservation.held',
      payload: {
        reservationId,
        reservationVersion: 1,
        branchId: seed.branchId,
        variantId: seed.variantId,
        assetId: seed.assetId,
      },
    });
    expect(persisted.idempotency).toEqual({ status: 'succeeded', response_code: 201 });
  });

  it('rebooks every line at current prices and persists no partial hold when capacity is short', async () => {
    const seed = await seedWorkspace('org_rsv021_multi_line', 'user_rsv021_multi_line', ['reservations.manage']);
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'RSV021-ASSET-2', 'active', 'ready', 'at_branch')`,
        [seed.tenantId, seed.branchId, seed.variantId],
      );
      await client.query(
        `UPDATE product_variant SET rental_price_minor = 180000
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.variantId],
      );
    });

    const multi = await createStaffReservation(
      commandContext(seed, 'req-rsv021-multi-line', 'idem-rsv021-multi-line'),
      { ...createFastHoldRequest(seed), lines: [{ variant_id: seed.variantId as never }, { variant_id: seed.variantId as never }] },
    );
    expect(multi.status).toBe(201);
    expect(multi.body).toMatchObject({
      success: true,
      data: { reservation: { price_snapshot: { rental_total_minor: '440000', security_required_minor: '100000', due_now_minor: '565000' } } },
    });
    if (multi.body.success !== true) throw new Error('Expected multi-line reservation success.');
    const reservationId = multi.body.data.reservation.id;
    const persisted = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const lines = await client.query<{ rental_minor: number; deposit_minor: number; asset_id: string }>(
        `SELECT rl.rental_minor, rl.deposit_minor, aa.asset_id
           FROM reservation_line rl
           JOIN asset_allocation aa ON aa.tenant_id = rl.tenant_id AND aa.reservation_line_id = rl.id
          WHERE rl.tenant_id = $1 AND rl.reservation_id = $2 AND aa.is_blocking = true
          ORDER BY rl.line_number`,
        [seed.tenantId, reservationId],
      );
      const payment = await client.query<{ status: string; amount_minor: number }>(
        `SELECT status, amount_minor FROM payment
          WHERE tenant_id = $1 AND reservation_id = $2`,
        [seed.tenantId, reservationId],
      );
      return { lines: lines.rows, payment: requireRow(payment.rows, 'multi-line payment') };
    });
    expect(persisted.lines).toHaveLength(2);
    expect(persisted.lines.map((line) => line.rental_minor)).toEqual([220000, 220000]);
    expect(persisted.lines.map((line) => line.deposit_minor)).toEqual([50000, 50000]);
    expect(new Set(persisted.lines.map((line) => line.asset_id)).size).toBe(2);
    expect(persisted.payment).toEqual({ status: 'pending', amount_minor: 565000 });

    const shortSeed = await seedWorkspace('org_rsv021_multi_short', 'user_rsv021_multi_short', ['reservations.manage']);
    const failed = await createStaffReservation(
      commandContext(shortSeed, 'req-rsv021-multi-short', 'idem-rsv021-multi-short'),
      { ...createFastHoldRequest(shortSeed), lines: [{ variant_id: shortSeed.variantId as never }, { variant_id: shortSeed.variantId as never }] },
    );
    expect(failed.status).toBe(409);
    expect(failed.body).toMatchObject({ success: false, error: { code: 'CAPACITY_CONFLICT' } });
    expect(await graphCounts(shortSeed)).toEqual({ reservations: 0, lines: 0, allocations: 0, customers: 0 });
  });

  it('snapshots flexible fit range, fit notes, exact measurements, and unit on a reservation line', async () => {
    const seed = await seedWorkspace('org_rsv021_flexible_snapshot', 'user_rsv021_flexible_snapshot', ['reservations.manage']);
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `UPDATE product SET sizing_mode = 'free_size' WHERE tenant_id = $1 AND id = (
           SELECT product_id FROM product_variant WHERE tenant_id = $1 AND id = $2
         )`,
        [seed.tenantId, seed.variantId],
      );
      await client.query(
        `UPDATE product_variant
            SET size_label = NULL,
                fit_range = 'Small–XL',
                measurement_unit = 'in',
                measurements = '{"bust":{"type":"fit_note","text":"Flexible fit"},"waist":28,"length":61}'::jsonb
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.variantId],
      );
    });

    const response = await createStaffReservation(
      commandContext(seed, 'req-rsv021-flexible-snapshot', 'idem-rsv021-flexible-snapshot'),
      createRequest(seed),
    );
    expect(response.status).toBe(201);
    const reservationId = successReservationId(response.body);
    const line = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{
        measurements_snapshot: Record<string, unknown>;
        fit_range_snapshot: string | null;
        measurement_unit_snapshot: string | null;
      }>(
        `SELECT measurements_snapshot, fit_range_snapshot, measurement_unit_snapshot
           FROM reservation_line
          WHERE tenant_id = $1 AND reservation_id = $2`,
        [seed.tenantId, reservationId],
      );
      return requireRow(result.rows, 'flexible-fit reservation line');
    });

    expect(line).toEqual({
      measurements_snapshot: {
        bust: { type: 'fit_note', text: 'Flexible fit' },
        waist: 28,
        length: 61,
      },
      fit_range_snapshot: 'Small–XL',
      measurement_unit_snapshot: 'in',
    });
  });

  it('acquires an idempotent walk-in hold before customer entry without fabricating a customer row', async () => {
    const seed = await seedWorkspace('org_rsv023_fast_hold', 'user_rsv023_fast_hold', ['reservations.manage']);
    const requestBody = createFastHoldRequest(seed);

    const first = await createStaffReservation(
      commandContext(seed, 'req-rsv023-fast-hold-a', 'idem-rsv023-fast-hold'),
      requestBody,
    );
    const replay = await createStaffReservation(
      commandContext(seed, 'req-rsv023-fast-hold-b', 'idem-rsv023-fast-hold'),
      requestBody,
    );

    expect(first.status).toBe(201);
    expect(replay).toEqual(first);
    const reservationId = successReservationId(first.body);

    const state = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservation = await client.query<{
        customer_id: string | null;
        customer_snapshot: Record<string, unknown> | null;
        status: string;
        hold_acquired_at: Date;
        hold_expires_at: Date;
      }>(
        `SELECT customer_id, customer_snapshot, status, hold_acquired_at, hold_expires_at
           FROM reservation
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, reservationId],
      );
      const customers = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM customer WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      const allocations = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM asset_allocation aa
           JOIN reservation_line rl
             ON rl.tenant_id = aa.tenant_id
            AND rl.id = aa.reservation_line_id
          WHERE aa.tenant_id = $1
            AND rl.reservation_id = $2
            AND aa.kind = 'reservation_hold'
            AND aa.is_blocking = true`,
        [seed.tenantId, reservationId],
      );
      return {
        reservation: requireRow(reservation.rows, 'walk-in hold reservation'),
        customerCount: customers.rows[0]?.count ?? 0,
        allocationCount: allocations.rows[0]?.count ?? 0,
      };
    });

    expect(state.reservation).toMatchObject({
      customer_id: null,
      customer_snapshot: null,
      status: 'held',
    });
    expect(state.reservation.hold_expires_at.getTime() - state.reservation.hold_acquired_at.getTime())
      .toBe(15 * 60 * 1000);
    expect(state.customerCount).toBe(0);
    expect(state.allocationCount).toBe(1);
    expect(await graphCounts(seed)).toMatchObject({
      reservations: 1,
      lines: 1,
      allocations: 1,
      customers: 0,
    });
  });

  it('uses an authorized existing customer without duplicating or reading live notes into the reservation snapshot', async () => {
    const seed = await seedWorkspace('org_rsv021_existing', 'user_rsv021_existing', ['reservations.manage']);
    const customerId = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const customer = await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, phone, email, address, notes)
         VALUES ($1, 'Existing Customer', '09175550000', 'EXISTING@EXAMPLE.TEST', '123 Existing Street, Quezon City', 'Private live note')
         RETURNING id`,
        [seed.tenantId],
      );
      return requireRow(customer.rows, 'existing customer').id;
    });
    const base = createRequest(seed);
    const requestBody: StaffReservationCreateRequest = {
      ...base,
      customer: {
        source: 'existing',
        customer_id: customerId as CustomerId,
      },
    };
    const result = await createStaffReservation(
      commandContext(seed, 'req-existing', 'idem-existing'),
      requestBody,
    );
    expect(result.status).toBe(201);

    const reservationId = successReservationId(result.body);
    const state = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const customers = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM customer WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      const reservation = await client.query<{ customer_id: string; customer_snapshot: Record<string, unknown> }>(
        `SELECT customer_id, customer_snapshot FROM reservation WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, reservationId],
      );
      return {
        customerCount: customers.rows[0]?.count ?? 0,
        reservation: requireRow(reservation.rows, 'existing customer reservation'),
      };
    });
    expect(state.customerCount).toBe(1);
    expect(state.reservation.customer_id).toBe(customerId);
    expect(state.reservation.customer_snapshot).toEqual({
      full_name: 'Existing Customer',
      phone: '09175550000',
      email: 'existing@example.test',
      address: '123 Existing Street, Quezon City',
    });
    expect(state.reservation.customer_snapshot).not.toHaveProperty('notes');
  });

  it('requires an inline address for an addressless existing customer, fills it once, and snapshots it atomically', async () => {
    const seed = await seedWorkspace('org_rsv021_address_fill', 'user_rsv021_address_fill', [
      'reservations.manage',
    ]);
    const customerId = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const customer = await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, phone, email)
         VALUES ($1, 'Addressless Customer', '09175550001', 'addressless@example.test')
         RETURNING id`,
        [seed.tenantId],
      );
      return requireRow(customer.rows, 'addressless customer').id;
    });
    const base = createRequest(seed);
    const missingAddress: StaffReservationCreateRequest = {
      ...base,
      customer: { source: 'existing', customer_id: customerId as CustomerId },
    };
    const rejected = await createStaffReservation(
      commandContext(seed, 'req-address-missing', 'idem-address-missing'),
      missingAddress,
    );
    expect(rejected).toMatchObject({
      status: 422,
      body: { success: false, error: { code: 'VALIDATION_FAILED' } },
    });

    const requestBody: StaffReservationCreateRequest = {
      ...base,
      customer: {
        source: 'existing',
        customer_id: customerId as CustomerId,
        address: '456 Captured Street, Quezon City',
      },
    };
    const first = await createStaffReservation(
      commandContext(seed, 'req-address-fill-a', 'idem-address-fill'),
      requestBody,
    );
    const replay = await createStaffReservation(
      commandContext(seed, 'req-address-fill-b', 'idem-address-fill'),
      requestBody,
    );
    expect(first.status).toBe(201);
    expect(replay).toEqual(first);
    const reservationId = successReservationId(first.body);

    const state = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const customer = await client.query<{ address: string | null }>(
        `SELECT address FROM customer WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, customerId],
      );
      const reservation = await client.query<{ customer_snapshot: Record<string, unknown> }>(
        `SELECT customer_snapshot FROM reservation WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, reservationId],
      );
      return {
        customer: requireRow(customer.rows, 'filled customer'),
        reservation: requireRow(reservation.rows, 'address snapshot'),
      };
    });
    expect(state.customer.address).toBe('456 Captured Street, Quezon City');
    expect(state.reservation.customer_snapshot).toMatchObject({
      full_name: 'Addressless Customer',
      address: '456 Captured Street, Quezon City',
    });
    expect(await graphCounts(seed)).toMatchObject({ reservations: 1, customers: 1 });
  });

  it('replays the same intent exactly once and rejects the same key with a different canonical payload', async () => {
    const seed = await seedWorkspace('org_rsv021_replay', 'user_rsv021_replay', ['reservations.manage']);
    const requestBody = createRequest(seed);
    const first = await createStaffReservation(
      commandContext(seed, 'req-rsv021-replay-a', 'idem-rsv021-replay'),
      requestBody,
    );
    const replay = await createStaffReservation(
      commandContext(seed, 'req-rsv021-replay-b', 'idem-rsv021-replay'),
      requestBody,
    );

    expect(replay).toEqual(first);
    await expect(
      createStaffReservation(
        commandContext(seed, 'req-rsv021-replay-c', 'idem-rsv021-replay'),
        { ...requestBody, event_date: reservationTestDate(2) },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    const counts = await graphCounts(seed);
    expect(counts).toMatchObject({ reservations: 1, lines: 1, allocations: 1, customers: 1 });
  });

  it('collapses concurrent duplicate submits with one idempotency key into one reservation graph', async () => {
    const seed = await seedWorkspace('org_rsv021_double', 'user_rsv021_double', ['reservations.manage']);
    const requestBody = createRequest(seed);
    const [first, second] = await Promise.all([
      createStaffReservation(commandContext(seed, 'req-double-a', 'idem-double'), requestBody),
      createStaffReservation(commandContext(seed, 'req-double-b', 'idem-double'), requestBody),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(successReservationId(first.body)).toBe(successReservationId(second.body));
    expect(await graphCounts(seed)).toMatchObject({
      reservations: 1,
      lines: 1,
      allocations: 1,
      customers: 1,
    });
  });

  it('serializes competing intents for the last garment so one wins and one gets a stable capacity conflict', async () => {
    const seed = await seedWorkspace('org_rsv021_race', 'user_rsv021_race', ['reservations.manage']);
    const firstRequest = createRequest(seed);
    const secondRequest: StaffReservationCreateRequest = {
      ...firstRequest,
      customer: {
        source: 'new',
        customer: {
          full_name: 'Second Walk-in',
          phone: '09170000002',
          email: 'second@example.test',
          address: '123 Second Street, Quezon City',
        },
      },
    };
    const results = await Promise.all([
      createStaffReservation(commandContext(seed, 'req-race-a', 'idem-race-a'), firstRequest),
      createStaffReservation(commandContext(seed, 'req-race-b', 'idem-race-b'), secondRequest),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const loserIndex = results.findIndex((result) => result.status === 409);
    const loser = results[loserIndex];
    expect(loser?.body).toMatchObject({
      success: false,
      error: { code: 'CAPACITY_CONFLICT' },
    });
    const loserReplay = await createStaffReservation(
      commandContext(
        seed,
        'req-race-replay',
        loserIndex === 0 ? 'idem-race-a' : 'idem-race-b',
      ),
      loserIndex === 0 ? firstRequest : secondRequest,
    );
    expect(loserReplay).toEqual(loser);
    expect(await graphCounts(seed)).toMatchObject({
      reservations: 1,
      lines: 1,
      allocations: 1,
      customers: 1,
    });
  });

  it('reclaims an expired blocking hold using database time before allocating the garment to the new intent', async () => {
    const seed = await seedWorkspace('org_rsv021_expiry', 'user_rsv021_expiry', ['reservations.manage']);
    const expiredReservationId = await seedExpiredHold(seed);

    const result = await createStaffReservation(
      commandContext(seed, 'req-expiry', 'idem-expiry'),
      createRequest(seed),
    );
    expect(result.status).toBe(201);

    const state = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const oldReservation = await client.query<{ status: string; version: number }>(
        `SELECT status, version FROM reservation WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, expiredReservationId],
      );
      const oldAllocation = await client.query<{ is_blocking: boolean; released_at: Date | null }>(
        `SELECT aa.is_blocking, aa.released_at
           FROM asset_allocation aa
           JOIN reservation_line rl ON rl.tenant_id = aa.tenant_id AND rl.id = aa.reservation_line_id
          WHERE aa.tenant_id = $1 AND rl.reservation_id = $2`,
        [seed.tenantId, expiredReservationId],
      );
      const expiryAudit = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_event
          WHERE tenant_id = $1 AND entity_id = $2 AND action = 'reservation.expired'`,
        [seed.tenantId, expiredReservationId],
      );
      const expiryOutbox = await client.query<{ event_type: string; payload: Record<string, unknown> }>(
        `SELECT event_type, payload FROM outbox_event
          WHERE tenant_id = $1 AND dedupe_key = $2`,
        [seed.tenantId, `reservation-expired:${expiredReservationId}:2`],
      );
      return {
        oldReservation: requireRow(oldReservation.rows, 'expired reservation'),
        oldAllocation: requireRow(oldAllocation.rows, 'expired allocation'),
        expiryAuditCount: expiryAudit.rows[0]?.count ?? 0,
        expiryOutbox: requireRow(expiryOutbox.rows, 'expiry outbox'),
      };
    });

    expect(state.oldReservation).toEqual({ status: 'expired', version: 2 });
    expect(state.oldAllocation.is_blocking).toBe(false);
    expect(state.oldAllocation.released_at).toBeInstanceOf(Date);
    expect(state.expiryAuditCount).toBe(1);
    expect(state.expiryOutbox).toEqual({
      event_type: 'reservation.hold_expired',
      payload: { reservationId: expiredReservationId, reservationVersion: 2 },
    });
    expect((await graphCounts(seed)).reservations).toBe(2);
  });

  it('reclaims expired holds in batches atomically and can safely retry after a later batch fails', async () => {
    const seed = await seedWorkspace('org_rsv021_expiry_batch', 'user_rsv021_expiry_batch', [
      'reservations.manage',
    ]);
    const expiredReservationIds = await seedExpiredHoldBatch(seed, 101);
    const lastReservationId = [...expiredReservationIds].sort().at(-1);
    if (!lastReservationId) throw new Error('Expected an expired reservation batch.');

    try {
      await withAdmin(async (client) => {
        await client.query(
          'DROP TRIGGER IF EXISTS test_reject_reservation_expiry_outbox ON outbox_event',
        );
        await client.query('DROP FUNCTION IF EXISTS test_reject_reservation_expiry_outbox()');
        await client.query(`
          CREATE FUNCTION test_reject_reservation_expiry_outbox() RETURNS trigger
          LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.dedupe_key = 'reservation-expired:${lastReservationId}:2' THEN
              RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'test_reservation_expiry_rejected',
                MESSAGE = 'Test-only rejection of the second reservation expiry batch.';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await client.query(`
          CREATE TRIGGER test_reject_reservation_expiry_outbox
          BEFORE INSERT ON outbox_event
          FOR EACH ROW EXECUTE FUNCTION test_reject_reservation_expiry_outbox()
        `);
      });

      const context = commandContext(seed, 'req-expiry-batch', 'idem-expiry-batch');
      await expect(createStaffReservation(context, createRequest(seed))).rejects.toMatchObject({
        constraint: 'test_reservation_expiry_rejected',
      });

      const rolledBack = await withTenantTransaction(
        seed.tenantId,
        seed.principalId,
        async (client) => {
          const result = await client.query<{
            held: number;
            blocking: number;
            audit_events: number;
            outbox_events: number;
          }>(
            `SELECT
               (SELECT count(*)::int FROM reservation
                 WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'held') AS held,
               (SELECT count(*)::int FROM asset_allocation
                 WHERE tenant_id = $1 AND is_blocking = true
                   AND reservation_line_id IN (
                     SELECT id FROM reservation_line WHERE tenant_id = $1 AND reservation_id = ANY($2::uuid[])
                   )) AS blocking,
               (SELECT count(*)::int FROM audit_event
                 WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])
                   AND action = 'reservation.expired') AS audit_events,
               (SELECT count(*)::int FROM outbox_event
                 WHERE tenant_id = $1 AND dedupe_key LIKE 'reservation-expired:%') AS outbox_events`,
            [seed.tenantId, expiredReservationIds],
          );
          return requireRow(result.rows, 'rolled back expiry state');
        },
      );
      expect(rolledBack).toEqual({ held: 101, blocking: 101, audit_events: 0, outbox_events: 0 });
      expect((await graphCounts(seed)).reservations).toBe(101);

      await withAdmin(async (client) => {
        await client.query('DROP TRIGGER test_reject_reservation_expiry_outbox ON outbox_event');
        await client.query('DROP FUNCTION test_reject_reservation_expiry_outbox()');
      });

      const retry = await createStaffReservation(context, createRequest(seed));
      expect(retry.status).toBe(201);

      const reclaimed = await withTenantTransaction(
        seed.tenantId,
        seed.principalId,
        async (client) => {
          const result = await client.query<{
            expired: number;
            released: number;
            audit_events: number;
            outbox_events: number;
            valid_audit_events: number;
            valid_outbox_events: number;
          }>(
            `SELECT
               (SELECT count(*)::int FROM reservation
                 WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'expired') AS expired,
               (SELECT count(*)::int FROM asset_allocation
                 WHERE tenant_id = $1 AND is_blocking = false
                   AND reservation_line_id IN (
                     SELECT id FROM reservation_line WHERE tenant_id = $1 AND reservation_id = ANY($2::uuid[])
                   )) AS released,
               (SELECT count(*)::int FROM audit_event
                 WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])
                   AND action = 'reservation.expired') AS audit_events,
               (SELECT count(*)::int FROM audit_event
                 WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])
                   AND action = 'reservation.expired' AND request_id = 'req-expiry-batch'
                   AND redacted_summary = '{"reason":"hold_deadline_elapsed","version":2}'::jsonb) AS valid_audit_events,
               (SELECT count(*)::int FROM outbox_event
                 WHERE tenant_id = $1 AND dedupe_key LIKE 'reservation-expired:%') AS outbox_events,
               (SELECT count(*)::int FROM outbox_event
                 WHERE tenant_id = $1 AND dedupe_key = 'reservation-expired:' || (payload->>'reservationId') || ':2'
                   AND event_type = 'reservation.hold_expired' AND payload->>'reservationVersion' = '2') AS valid_outbox_events`,
            [seed.tenantId, expiredReservationIds],
          );
          return requireRow(result.rows, 'reclaimed expiry state');
        },
      );
      expect(reclaimed).toEqual({
        expired: 101,
        released: 101,
        audit_events: 101,
        outbox_events: 101,
        valid_audit_events: 101,
        valid_outbox_events: 101,
      });
      expect((await graphCounts(seed)).reservations).toBe(102);
    } finally {
      await withAdmin(async (client) => {
        await client.query(
          'DROP TRIGGER IF EXISTS test_reject_reservation_expiry_outbox ON outbox_event',
        );
        await client.query('DROP FUNCTION IF EXISTS test_reject_reservation_expiry_outbox()');
      });
    }
  });

  it('exposes bounded staff intake options without payment destination secrets', async () => {
    const seed = await seedWorkspace('org_rsv063_intake', 'user_rsv063_intake', [
      'reservations.manage',
    ]);
    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `INSERT INTO customer (tenant_id, full_name, phone, email, notes)
         VALUES ($1, 'Maria Intake', '09171234567', 'maria@example.test', 'private note')`,
        [seed.tenantId],
      ),
    );
    useClerk(seed);

    const response = await request(createApp())
      .get('/api/v1/reservations/intake-options')
      .query({ customer_search: 'Maria' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        payment_methods: [
          { id: seed.paymentMethodId, name: 'Cash', rail: 'cash' },
        ],
        customers: [
          {
            full_name: 'Maria Intake',
            phone: '09171234567',
            email: 'maria@example.test',
            has_address: false,
          },
        ],
      },
    });
    const intakeBody = response.body as {
      data: {
        payment_methods: Array<Record<string, unknown>>;
        customers: Array<Record<string, unknown>>;
      };
    };
    expect(intakeBody.data.payment_methods[0]).not.toHaveProperty('destination_snapshot');
    expect(intakeBody.data.customers[0]).not.toHaveProperty('notes');

    useClerk(seed);
    const tooShort = await request(createApp())
      .get('/api/v1/reservations/intake-options')
      .query({ customer_search: 'M' });
    expect(tooShort.status).toBe(422);
    expectSafeError(tooShort.body, 'VALIDATION_FAILED');
  });

  it('excludes archived customers from reservation intake and existing-customer creation', async () => {
    const seed = await seedWorkspace('org_rsv063_archived_customer', 'user_rsv063_archived_customer', [
      'reservations.manage',
    ]);
    const archivedCustomerId = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO customer (tenant_id, full_name, phone, email, archived_at)
         VALUES ($1, 'Archived Intake Customer', '09171234568', 'archived-intake@example.test', now())
         RETURNING id`,
        [seed.tenantId],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('archived customer insert returned no row');
      return id;
    });
    useClerk(seed);

    const lookup = await request(createApp())
      .get('/api/v1/reservations/intake-options')
      .query({ customer_search: 'Archived Intake' });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toMatchObject({ data: { customers: [] } });

    const before = await graphCounts(seed);
    const create = await request(createApp())
      .post('/api/v1/reservations')
      .set('Idempotency-Key', 'rsv063-archived-customer')
      .send({
        ...createRequest(seed),
        customer: { source: 'existing', customer_id: archivedCustomerId },
      });
    expect(create.status).toBe(404);
    expectSafeError(create.body, 'NOT_FOUND');
    expect(await graphCounts(seed)).toEqual(before);
  });

  it('returns a variant-aware calendar preview and exact timestamp availability without claiming capacity', async () => {
    const seed = await seedWorkspace('org_rsv063_calendar', 'user_rsv063_calendar', [
      'reservations.manage',
    ]);
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'RSV063-ASSET-2', 'active', 'ready', 'at_branch')`,
        [seed.tenantId, seed.branchId, seed.variantId],
      );
      const workOrder = await client.query<{ id: string }>(
        `INSERT INTO maintenance_work_order
           (tenant_id, branch_id, asset_id, kind, status, reason)
         VALUES ($1, $2, $3, 'manual_block', 'open', 'Variant calendar regression block')
         RETURNING id`,
        [seed.tenantId, seed.branchId, seed.assetId],
      );
      const workOrderId = requireRow(workOrder.rows, 'calendar maintenance work order').id;
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, maintenance_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'maintenance',
                 tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
        [
          seed.tenantId,
          seed.branchId,
          seed.assetId,
          workOrderId,
          reservationTestInstant(1),
          reservationTestInstant(2),
        ],
      );
      // Staff availability is operational inventory data and must not depend on storefront policy
      // configuration. Reservation creation still requires/snapshots an effective policy.
      await client.query('DELETE FROM policy_snapshot WHERE tenant_id = $1', [seed.tenantId]);
    });
    useClerk(seed);

    const calendar = await request(createApp())
      .get('/api/v1/reservations/availability-calendar')
      .query({
        variant_id: seed.variantId,
        start_date: reservationTestDate(0),
        end_date: reservationTestDate(4),
      });

    expect(calendar.status).toBe(200);
    expect(calendar.body).toMatchObject({
      success: true,
      data: {
        variant_id: seed.variantId,
        timezone: 'Asia/Manila',
        active_assets: 2,
        ready_assets: 2,
        pricing: {
          pricing_mode: 'fixed_duration',
          rental_price_minor: '150000',
          security_deposit_minor: '50000',
          included_duration_minutes: 4320,
          minimum_duration_minutes: 4320,
          extra_day_price_minor: '40000',
          recovery_minutes: 1440,
        },
      },
    });
    const calendarBody = calendar.body as {
      data: { days: Array<{ date: string; state: string; available_assets: number }> };
    };
    const calendarData = calendarBody.data;
    expect(calendarData.days).toHaveLength(5);
    expect(calendarData.days).toEqual([
      expect.objectContaining({ date: reservationTestDate(0), available_assets: 2, state: 'available' }),
      expect.objectContaining({ date: reservationTestDate(1), available_assets: 1, state: 'limited' }),
      expect.objectContaining({ date: reservationTestDate(2), available_assets: 1, state: 'limited' }),
      expect.objectContaining({ date: reservationTestDate(3), available_assets: 2, state: 'available' }),
      expect.objectContaining({ date: reservationTestDate(4), available_assets: 2, state: 'available' }),
    ]);

    const exact = await request(createApp())
      .get('/api/v1/reservations/availability-check')
      .query({
        variant_id: seed.variantId,
        pickup_at: reservationTestInstant(0),
        due_at: reservationTestInstant(3),
      });
    expect(exact.status).toBe(200);
    expect(exact.body).toMatchObject({
      success: true,
      data: {
        variant_id: seed.variantId,
        available: true,
        available_assets: 1,
        guaranteed: false,
        requested_interval: {
          start: reservationTestInstant(0),
          end: reservationTestInstant(3),
        },
        blocked_interval: {
          start: reservationTestInstant(0),
          end: reservationTestInstant(4),
        },
        rental_preview: {
          rental_total_minor: '190000',
          extra_day_count: 1,
          currency: 'PHP',
        },
      },
    });
    expect(await graphCounts(seed)).toMatchObject({ reservations: 0, allocations: 0 });

    // Owner rule: pickup Oct 10 (Day 1), Oct 11 (Day 2), return Oct 12 (Day 3) is the 3-day package.
    const pickupDayOne = await request(createApp())
      .get('/api/v1/reservations/availability-check')
      .query({
        variant_id: seed.variantId,
        pickup_at: reservationTestInstant(0, '08:00:00.000Z'),
        due_at: reservationTestInstant(2, '01:00:00.000Z'),
      });
    expect(pickupDayOne.status).toBe(200);
    expect(pickupDayOne.body).toMatchObject({
      data: { rental_preview: { rental_total_minor: '150000', extra_day_count: 0, currency: 'PHP' } },
    });

    const tooShort = await request(createApp())
      .get('/api/v1/reservations/availability-check')
      .query({
        variant_id: seed.variantId,
        pickup_at: reservationTestInstant(0),
        due_at: reservationTestInstant(1, '08:00:00.000Z'),
      });
    expect(tooShort.status).toBe(409);
    expectSafeError(tooShort.body, 'STATE_CONFLICT');
  });

  it('blocks active Recovery but allows a later reservation while normal cleaning is still recovery-managed', async () => {
    const seed = await seedWorkspace('org_rsv063_recovery_readiness', 'user_rsv063_recovery_readiness', [
      'reservations.manage',
    ]);
    await seedReturnedRecovery(seed, {
      pickupAt: reservationTestInstant(-3),
      dueAt: reservationTestInstant(0),
      recoveryEnd: reservationTestInstant(1),
    });
    useClerk(seed);

    const overlapping = await request(createApp())
      .get('/api/v1/reservations/availability-check')
      .query({
        variant_id: seed.variantId,
        pickup_at: reservationTestInstant(0, '10:00:00.000Z'),
        due_at: reservationTestInstant(3, '10:00:00.000Z'),
      });
    expect(overlapping.status).toBe(200);
    expect(overlapping.body).toMatchObject({
      success: true,
      data: { available: false, available_assets: 0 },
    });

    const afterRecovery = await request(createApp())
      .get('/api/v1/reservations/availability-check')
      .query({
        variant_id: seed.variantId,
        pickup_at: reservationTestInstant(1),
        due_at: reservationTestInstant(4),
      });
    expect(afterRecovery.status).toBe(200);
    expect(afterRecovery.body).toMatchObject({
      success: true,
      data: { available: true, available_assets: 1 },
    });

    const created = await createStaffReservation(
      commandContext(seed, 'req-rsv063-after-recovery', 'idem-rsv063-after-recovery'),
      {
        variant_id: seed.variantId as StaffReservationCreateRequest['variant_id'],
        requested_interval: {
          start: reservationTestInstant(1),
          end: reservationTestInstant(4),
        },
        fulfillment_method: 'pickup',
        payment_method_id: seed.paymentMethodId as StaffReservationCreateRequest['payment_method_id'],
      },
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ success: true, data: { reservation: { status: 'held' } } });

    const readiness = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ readiness: string; recovery_managed_readiness: boolean }>(
        `SELECT readiness, recovery_managed_readiness
           FROM physical_asset
          WHERE tenant_id = $1 AND id = $2::uuid`,
        [seed.tenantId, seed.assetId],
      );
      return requireRow(result.rows, 'recovery-managed asset readiness');
    });
    expect(readiness).toEqual({ readiness: 'needs_cleaning', recovery_managed_readiness: true });
  });

  it('treats a database-expired hold as available in staff previews before create releases it', async () => {
    const seed = await seedWorkspace('org_rsv063_expired_preview', 'user_rsv063_expired_preview', [
      'reservations.manage',
    ]);
    await seedExpiredHold(seed);
    useClerk(seed);

    const calendar = await request(createApp())
      .get('/api/v1/reservations/availability-calendar')
      .query({
        variant_id: seed.variantId,
        start_date: reservationTestDate(0),
        end_date: reservationTestDate(3),
      });
    expect(calendar.status).toBe(200);
    const calendarBody = calendar.body as {
      data: { days: Array<{ date: string; available_assets: number }> };
    };
    expect(calendarBody.data.days.every((day) => day.available_assets === 1)).toBe(true);

    const exact = await request(createApp())
      .get('/api/v1/reservations/availability-check')
      .query({
        variant_id: seed.variantId,
        pickup_at: reservationTestInstant(0),
        due_at: reservationTestInstant(3),
      });
    expect(exact.status).toBe(200);
    expect(exact.body).toMatchObject({
      success: true,
      data: { available: true, available_assets: 1, guaranteed: false },
    });
  });

  it('guards staff intake options with auth, branch permission, and new-booking lifecycle policy', async () => {
    clerk.getAuth.mockReturnValueOnce({ userId: null, orgId: null });
    const unauthenticated = await request(createApp()).get('/api/v1/reservations/intake-options');
    expect(unauthenticated.status).toBe(401);
    expectSafeError(unauthenticated.body, 'UNAUTHENTICATED');

    const denied = await seedWorkspace('org_rsv063_intake_denied', 'user_rsv063_intake_denied', []);
    useClerk(denied);
    const forbidden = await request(createApp()).get('/api/v1/reservations/intake-options');
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');

    const restricted = await seedWorkspace(
      'org_rsv063_intake_restricted',
      'user_rsv063_intake_restricted',
      ['reservations.manage'],
    );
    await withTenantTransaction(restricted.tenantId, restricted.principalId, (client) =>
      client.query(`UPDATE tenant SET status = 'restricted' WHERE id = $1`, [restricted.tenantId]),
    );
    useClerk(restricted);
    const restrictedResponse = await request(createApp()).get('/api/v1/reservations/intake-options');
    expect(restrictedResponse.status).toBe(409);
    expectSafeError(restrictedResponse.body, 'TENANT_RESTRICTED');
  });

  it('accepts the walk-in fast-path hold shape through POST /api/v1/reservations', async () => {
    const seed = await seedWorkspace('org_rsv023_route_hold', 'user_rsv023_route_hold', [
      'reservations.manage',
    ]);
    useClerk(seed);

    const response = await request(createApp())
      .post('/api/v1/reservations')
      .set('Idempotency-Key', 'route-rsv023-fast-hold')
      .send(createFastHoldRequest(seed));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        reservation: {
          status: 'held',
          branch_id: seed.branchId,
          variant_id: seed.variantId,
        },
      },
    });
    expect(await graphCounts(seed)).toMatchObject({
      reservations: 1,
      lines: 1,
      allocations: 1,
      customers: 0,
    });
  });

  it('exposes POST /api/v1/reservations with auth, lifecycle, permission, strict-body, size, and idempotency guards', async () => {
    clerk.getAuth.mockReturnValueOnce({ userId: null, orgId: null });
    const unauthenticated = await request(createApp())
      .post('/api/v1/reservations')
      .set('Idempotency-Key', 'route-unauth')
      .send({});
    expect(unauthenticated.status).toBe(401);
    expectSafeError(unauthenticated.body, 'UNAUTHENTICATED');

    const denied = await seedWorkspace('org_rsv022_denied', 'user_rsv022_denied', []);
    useClerk(denied);
    const forbidden = await request(createApp())
      .post('/api/v1/reservations')
      .set('Idempotency-Key', 'route-denied')
      .send(createRequest(denied));
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');

    const restricted = await seedWorkspace('org_rsv022_restricted', 'user_rsv022_restricted', [
      'reservations.manage',
    ]);
    await withTenantTransaction(restricted.tenantId, restricted.principalId, (client) =>
      client.query(`UPDATE tenant SET status = 'restricted' WHERE id = $1`, [restricted.tenantId]),
    );
    useClerk(restricted);
    const restrictedResponse = await request(createApp())
      .post('/api/v1/reservations')
      .set('Idempotency-Key', 'route-restricted')
      .send(createRequest(restricted));
    expect(restrictedResponse.status).toBe(409);
    expectSafeError(restrictedResponse.body, 'TENANT_RESTRICTED');

    const allowed = await seedWorkspace('org_rsv022_allowed', 'user_rsv022_allowed', [
      'reservations.manage',
    ]);
    useClerk(allowed);
    const missingKey = await request(createApp()).post('/api/v1/reservations').send(createRequest(allowed));
    expect(missingKey.status).toBe(422);
    expectSafeError(missingKey.body, 'VALIDATION_FAILED');

    useClerk(allowed);
    const authorityInjection = await request(createApp())
      .post('/api/v1/reservations')
      .set('Idempotency-Key', 'route-authority')
      .send({
        ...createRequest(allowed),
        tenant_id: allowed.tenantId,
        selected_asset_id: allowed.assetId,
        rental_total_minor: '1',
        status: 'confirmed',
      });
    expect(authorityInjection.status).toBe(422);
    expectSafeError(authorityInjection.body, 'VALIDATION_FAILED');

    useClerk(allowed);
    const success = await request(createApp())
      .post('/api/v1/reservations')
      .set('Idempotency-Key', 'route-success')
      .send(createRequest(allowed));
    expect(success.status).toBe(201);
    expect(success.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'held', branch_id: allowed.branchId } },
    });
    const createdId = successReservationId(success.body);

    useClerk(allowed);
    const replay = await request(createApp())
      .post('/api/v1/reservations')
      .set('Idempotency-Key', 'route-success')
      .send(createRequest(allowed));
    expect(replay.status).toBe(201);
    expect(successReservationId(replay.body)).toBe(createdId);

    useClerk(allowed);
    const reusedKey = await request(createApp())
      .post('/api/v1/reservations')
      .set('Idempotency-Key', 'route-success')
      .send({ ...createRequest(allowed), event_date: reservationTestDate(2) });
    expect(reusedKey.status).toBe(409);
    expectSafeError(reusedKey.body, 'IDEMPOTENCY_KEY_REUSED');

    const oversized = await request(createApp())
      .post('/api/v1/reservations')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(20_000) }));
    expect(oversized.status).toBe(422);
    expectSafeError(oversized.body, 'VALIDATION_FAILED');
  });

  async function seedWorkspace(
    clerkOrgId: string,
    principalId: string,
    permissions: PermissionCode[],
  ): Promise<CreateSeed> {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'frontdesk');
    return withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active') RETURNING id`,
        [tenant.id],
      );
      const branchId = requireRow(branch.rows, 'branch').id;
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, branchId, membershipId, JSON.stringify(permissions)],
      );

      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true LIMIT 1`,
      );
      const planId = requireRow(plan.rows, 'starter plan').id;
      await client.query(
        `INSERT INTO subscription
           (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', statement_timestamp(), statement_timestamp() + interval '30 days')`,
        [tenant.id, planId],
      );

      const storefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
        [tenant.id, branchId, `rsv021-${tenant.id.slice(0, 8)}`],
      );
      const storefrontId = requireRow(storefront.rows, 'storefront').id;
      const policy = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
            delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 '{"enabled":true,"fee_minor":"25000"}'::jsonb,
                 'Reservation create privacy notice', statement_timestamp() - interval '1 minute')
         RETURNING id`,
        [tenant.id, storefrontId],
      );
      const policySnapshotId = requireRow(policy.rows, 'policy').id;
      const payment = await client.query<{ id: string }>(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES ($1, 'Cash', 'cash', '{"instructions":"Pay at the counter before pickup."}'::jsonb, true, 1)
         RETURNING id`,
        [tenant.id],
      );
      const paymentMethodId = requireRow(payment.rows, 'payment method').id;
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, description, status)
         VALUES ($1, 'RSV021-GOWN', 'RSV-021 Emerald Gown', 'Creation test garment', 'active')
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
         VALUES ($1, $2, 'RSV021-M', 'M', 'Emerald', 'custom', 'cm',
                 '{"bust":91.5,"waist":72}'::jsonb, 150000, 50000, 'PHP',
                 'fixed_duration', 4320, 40000, 60, 1440, 'active') RETURNING id`,
        [tenant.id, productId],
      );
      const variantId = requireRow(variant.rows, 'variant').id;
      const asset = await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'RSV021-ASSET-1', 'active', 'ready', 'at_branch') RETURNING id`,
        [tenant.id, branchId, variantId],
      );

      return {
        tenantId: tenant.id,
        clerkOrgId: tenant.clerkOrgId,
        principalId,
        membershipId,
        branchId,
        storefrontId,
        policySnapshotId,
        paymentMethodId,
        variantId,
        assetId: requireRow(asset.rows, 'asset').id,
      };
    });
  }

  function createRequest(seed: CreateSeed): StaffReservationCreateRequest {
    return {
      customer: {
        source: 'new',
        customer: {
          full_name: 'Walk-in Customer',
          phone: '09171234567',
          email: 'WALKIN@EXAMPLE.TEST',
          address: '123 Test Street, Quezon City',
          social_media: '@walkin',
          notes: 'Internal staff note',
        },
      },
      variant_id: seed.variantId as StaffReservationCreateRequest['variant_id'],
      requested_interval: {
        start: reservationTestInstant(0),
        end: reservationTestInstant(3),
      },
      event_date: reservationTestDate(1),
      fulfillment_method: 'delivery',
      payment_method_id: seed.paymentMethodId as StaffReservationCreateRequest['payment_method_id'],
    };
  }

  function createFastHoldRequest(seed: CreateSeed): StaffReservationCreateRequest {
    const fullRequest = createRequest(seed);
    return {
      variant_id: fullRequest.variant_id,
      requested_interval: fullRequest.requested_interval,
      ...(fullRequest.event_date ? { event_date: fullRequest.event_date } : {}),
      fulfillment_method: fullRequest.fulfillment_method,
      payment_method_id: fullRequest.payment_method_id,
    };
  }

  function commandContext(seed: CreateSeed, requestId: string, idempotencyKey: string) {
    return {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      membershipId: seed.membershipId,
      principalId: seed.principalId,
      permissionCodes: ['reservations.manage'] as PermissionCode[],
      effectiveTenantStatus: 'active' as const,
      requestId,
      idempotencyKey,
    };
  }

  async function graphCounts(seed: CreateSeed) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservations = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM reservation WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      const lines = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM reservation_line WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      const allocations = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM asset_allocation
          WHERE tenant_id = $1 AND reservation_line_id IS NOT NULL AND is_blocking = true`,
        [seed.tenantId],
      );
      const customers = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM customer WHERE tenant_id = $1`,
        [seed.tenantId],
      );
      return {
        reservations: reservations.rows[0]?.count ?? 0,
        lines: lines.rows[0]?.count ?? 0,
        allocations: allocations.rows[0]?.count ?? 0,
        customers: customers.rows[0]?.count ?? 0,
      };
    });
  }

  async function seedReturnedRecovery(
    seed: CreateSeed,
    input: { pickupAt: string; dueAt: string; recoveryEnd: string },
  ): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `UPDATE physical_asset
            SET readiness = 'needs_cleaning', recovery_managed_readiness = true
          WHERE tenant_id = $1 AND id = $2::uuid`,
        [seed.tenantId, seed.assetId],
      );
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservation
           (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, delivery_snapshot,
            price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor)
         VALUES ($1, $2, $3, $4, $5, 'RSV-RETURNED-RECOVERY', 'returned',
                 $6::timestamptz, $7::timestamptz, 'Asia/Manila',
                 '{"fulfillment_method":"pickup"}'::jsonb, '{}'::jsonb,
                 'PHP', 150000, 50000, 200000)
         RETURNING id`,
        [
          seed.tenantId,
          seed.branchId,
          seed.storefrontId,
          seed.policySnapshotId,
          seed.paymentMethodId,
          input.pickupAt,
          input.dueAt,
        ],
      );
      const reservationId = requireRow(reservation.rows, 'returned recovery reservation').id;
      const line = await client.query<{ id: string }>(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, 'Recovery Gown', '{}'::jsonb, '{}'::jsonb, 150000, 50000, 'PHP')
         RETURNING id`,
        [seed.tenantId, reservationId, seed.variantId],
      );
      const lineId = requireRow(line.rows, 'returned recovery line').id;
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'reservation_confirmed',
                 tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
        [seed.tenantId, seed.branchId, seed.assetId, lineId, input.pickupAt, input.recoveryEnd],
      );
      return reservationId;
    });
  }

  async function seedExpiredHold(seed: CreateSeed): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservation
           (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, delivery_snapshot,
            price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor,
            hold_acquired_at, hold_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'RSV-EXPIRED-SEED', 'held',
                 $6::timestamptz, $7::timestamptz, 'Asia/Manila',
                 '{"fulfillment_method":"pickup"}'::jsonb, '{}'::jsonb, 'PHP', 150000, 50000, 200000,
                 statement_timestamp() - interval '20 minutes', statement_timestamp() - interval '5 minutes')
         RETURNING id`,
        [
          seed.tenantId,
          seed.branchId,
          seed.storefrontId,
          seed.policySnapshotId,
          seed.paymentMethodId,
          reservationTestInstant(0),
          reservationTestInstant(2, '04:00:00.000Z'),
        ],
      );
      const reservationId = requireRow(reservation.rows, 'expired reservation').id;
      const line = await client.query<{ id: string }>(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, 'Expired Gown', '{}'::jsonb, '{}'::jsonb, 150000, 50000, 'PHP')
         RETURNING id`,
        [seed.tenantId, reservationId, seed.variantId],
      );
      const lineId = requireRow(line.rows, 'expired line').id;
      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
         VALUES ($1, $2, $3, $4, 'reservation_hold',
                 tstzrange($5::timestamptz, $6::timestamptz, '[)'), true)`,
        [
          seed.tenantId,
          seed.branchId,
          seed.assetId,
          lineId,
          reservationTestInstant(0, '01:00:00.000Z'),
          reservationTestInstant(3, '04:00:00.000Z'),
        ],
      );
      return reservationId;
    });
  }

  async function seedExpiredHoldBatch(seed: CreateSeed, count: number): Promise<string[]> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const extraAssets = await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         SELECT $1, $2, $3, 'RSV021-ASSET-BATCH-' || number::text, 'active', 'ready', 'at_branch'
           FROM generate_series(2, $4) AS number
         RETURNING id`,
        [seed.tenantId, seed.branchId, seed.variantId, count],
      );
      const assetIds = [seed.assetId, ...extraAssets.rows.map((row) => row.id)];
      if (assetIds.length !== count) {
        throw new Error(`Expected ${count} candidate assets, received ${assetIds.length}.`);
      }

      const referenceCodes = assetIds.map(
        (_, index) => `RSV-EXPIRED-BATCH-${String(index + 1).padStart(3, '0')}`,
      );
      const reservations = await client.query<{ id: string; reference_code: string }>(
        `INSERT INTO reservation
           (tenant_id, branch_id, storefront_id, policy_snapshot_id, payment_method_id,
            reference_code, status, pickup_at, due_at, timezone_snapshot, delivery_snapshot,
            price_snapshot, currency, rental_total_minor, security_required_minor, due_now_minor,
            hold_acquired_at, hold_expires_at)
         SELECT $1, $2, $3, $4, $5, requested.reference_code, 'held',
                $6::timestamptz, $7::timestamptz, 'Asia/Manila',
                '{"fulfillment_method":"pickup"}'::jsonb, '{}'::jsonb, 'PHP', 150000, 50000, 200000,
                statement_timestamp() - interval '20 minutes', statement_timestamp() - interval '5 minutes'
           FROM unnest($8::text[]) AS requested(reference_code)
         RETURNING id, reference_code`,
        [
          seed.tenantId,
          seed.branchId,
          seed.storefrontId,
          seed.policySnapshotId,
          seed.paymentMethodId,
          reservationTestInstant(0),
          reservationTestInstant(2, '04:00:00.000Z'),
          referenceCodes,
        ],
      );
      const reservationIdsByReference = new Map(
        reservations.rows.map((row) => [row.reference_code, row.id]),
      );
      const reservationIds = referenceCodes.map((referenceCode) => {
        const id = reservationIdsByReference.get(referenceCode);
        if (!id) throw new Error(`Expected reservation ${referenceCode} to be inserted.`);
        return id;
      });

      const lines = await client.query<{ id: string; reservation_id: string }>(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         SELECT $1, requested.reservation_id, $2, 1, 'Expired Gown', '{}'::jsonb, '{}'::jsonb,
                150000, 50000, 'PHP'
           FROM unnest($3::uuid[]) AS requested(reservation_id)
         RETURNING id, reservation_id`,
        [seed.tenantId, seed.variantId, reservationIds],
      );
      const assetsByReservation = new Map(reservationIds.map((id, index) => [id, assetIds[index]]));
      const lineRows = lines.rows.map((line) => ({
        lineId: line.id,
        assetId: assetsByReservation.get(line.reservation_id),
      }));
      if (lineRows.some((line) => !line.assetId)) {
        throw new Error('Expected every expired reservation line to map to its candidate asset.');
      }

      await client.query(
        `INSERT INTO asset_allocation
           (tenant_id, branch_id, asset_id, reservation_line_id, kind, period, is_blocking)
         SELECT $1, $2, requested.asset_id, requested.line_id, 'reservation_hold',
                tstzrange($5::timestamptz, $6::timestamptz, '[)'), true
           FROM unnest($3::uuid[], $4::uuid[]) AS requested(asset_id, line_id)`,
        [
          seed.tenantId,
          seed.branchId,
          lineRows.map((line) => line.assetId),
          lineRows.map((line) => line.lineId),
          reservationTestInstant(0, '01:00:00.000Z'),
          reservationTestInstant(3, '04:00:00.000Z'),
        ],
      );

      return reservationIds;
    });
  }

  function useClerk(seed: Pick<CreateSeed, 'principalId' | 'clerkOrgId'>): void {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }

  function successReservationId(body: unknown): string {
    const value = body as { success?: boolean; data?: { reservation?: { id?: string } } };
    const id = value.data?.reservation?.id;
    if (!id) throw new Error('Expected reservation id in success response.');
    return id;
  }

  function expectSafeError(body: unknown, code: string): void {
    const envelope = body as {
      success?: unknown;
      error?: { code?: unknown; message?: unknown; stack?: unknown };
      request_id?: unknown;
    };
    expect(envelope.success).toBe(false);
    expect(envelope.error?.code).toBe(code);
    expect(envelope.error?.message).toEqual(expect.any(String));
    expect(envelope.error?.stack).toBeUndefined();
    expect(envelope.request_id).toEqual(expect.any(String));
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} to return one row.`);
    return row;
  }
});
