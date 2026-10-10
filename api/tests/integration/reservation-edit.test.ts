import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaymentMethodId, PermissionCode, ProductVariantId, StaffReservationCreateRequest } from '@drezivo/contracts';

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

const PERMISSIONS: PermissionCode[] = [
  'assets.manage',
  'reservations.manage',
  'reservations.custody',
  'payments.manage',
  'payments.view',
  'evidence.verify',
  'evidence.view',
];

interface Seed {
  tenantId: string;
  clerkOrgId: string;
  principalId: string;
  membershipId: string;
  branchId: string;
  paymentMethodId: string;
  variantId: string;
  assetId: string;
}

interface Booking {
  id: string;
  version: number;
  paymentId: string;
  start: string;
  end: string;
}

/**
 * Seeded garment: 3-day fixed rental at ₱1,500 plus ₱400 per extra day, ₱500 deposit, and a
 * ₱250 delivery fee. The default booking is pickup on day 3 at 10:00, return on day 6 (4 rental
 * days, one extra), delivered: due now = 1,900 + 500 + 250 = ₱2,650.
 */
describe('reservation edit (PATCH /reservations/:id)', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const {
    collectReservationBalance,
    confirmReservation,
    createStaffReservation,
    editReservation,
    getReservationDetail,
    pickupReservation,
    submitReservation,
  } = await import(
    '../../src/modules/reservations/reservations.service.js'
  );
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('corrects the customer and event date on one booking without touching the customer profile', async () => {
    const seed = await seedWorkspace('org_edit_customer', 'user_edit_customer');
    const booking = await createBooking(seed, 'customer');

    const result = await editReservation(context(seed, 'edit-customer'), booking.id, {
      version: booking.version,
      customer: { full_name: 'Bea Santiago', phone: '09171234801', email: 'BEA@Example.test', address: '12 Mabini St, Quezon City' },
      event_date: localDate(booking.start, 2),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      data: { price_changed: false, previous_due_now_minor: '265000', reservation: { version: 2, due_at: booking.end } },
    });
    const state = await reservationState(seed, booking.id);
    expect(state.customer_snapshot).toEqual({
      full_name: 'Bea Santiago',
      phone: '09171234801',
      email: 'bea@example.test',
      address: '12 Mabini St, Quezon City',
    });
    expect(state.event_date).toBe(localDate(booking.start, 2));
    expect(state.profile_name).toBe('Edit Customer');
    expect(await auditChanges(seed, booking.id)).toEqual([['customer', 'event_date']]);
  });

  it('re-prices an unpaid booking when delivery changes to pickup and moves the pending payment with it', async () => {
    const seed = await seedWorkspace('org_edit_pickup', 'user_edit_pickup');
    const booking = await createBooking(seed, 'pickup');

    const result = await editReservation(context(seed, 'edit-pickup'), booking.id, {
      version: booking.version,
      fulfillment_method: 'pickup',
    });

    expect(result.body).toMatchObject({ success: true, data: { price_changed: true, reservation: { fulfillment_method: 'pickup' } } });
    const state = await reservationState(seed, booking.id);
    expect(state.due_now_minor).toBe(240000);
    expect(state.payment_amount_minor).toBe(240000);
    expect(state.delivery_snapshot).toEqual({ fulfillment_method: 'pickup', fee_minor: '0' });
  });

  it('moves the booking to new dates with the price terms accepted at booking and keeps the same garment', async () => {
    const seed = await seedWorkspace('org_edit_dates', 'user_edit_dates');
    const booking = await createBooking(seed, 'dates');
    // The catalogue price changes after booking; the edit must still use the booked terms.
    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(`UPDATE product_variant SET rental_price_minor = 999900 WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.variantId]),
    );
    const end = addHours(booking.end, 24);

    const result = await editReservation(context(seed, 'edit-dates'), booking.id, {
      version: booking.version,
      requested_interval: { start: booking.start, end },
    });

    expect(result.body).toMatchObject({ success: true, data: { price_changed: true, reservation: { due_at: end } } });
    const state = await reservationState(seed, booking.id);
    // Five rental days: the 3-day package plus two extra days at ₱400.
    expect(state.rental_total_minor).toBe(230000);
    expect(state.due_now_minor).toBe(305000);
    expect(state.payment_amount_minor).toBe(305000);
    expect(state.line_rental_minor).toBe(230000);
    expect(state.allocations).toEqual([{ asset_id: seed.assetId, is_blocking: true, upper: addHours(end, 24) }]);
  });

  it('leaves the booking untouched when the garment is not free for the new dates', async () => {
    const seed = await seedWorkspace('org_edit_conflict', 'user_edit_conflict');
    const booking = await createBooking(seed, 'conflict-a');
    const other = await createBooking(seed, 'conflict-b', { startDays: 10 });
    const before = await reservationState(seed, booking.id);

    const result = await editReservation(context(seed, 'edit-conflict'), booking.id, {
      version: booking.version,
      requested_interval: { start: addHours(other.start, -24), end: addHours(other.end, -24) },
    });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ success: false, error: { code: 'CAPACITY_CONFLICT' } });
    expect(await reservationState(seed, booking.id)).toEqual(before);
  });

  it('turns a higher total on a paid booking into a balance that pickup waits for until staff collect it', async () => {
    const seed = await seedWorkspace('org_edit_balance', 'user_edit_balance');
    const booking = await confirmBooking(seed, await createBooking(seed, 'balance'));
    const longer = { version: booking.version, requested_interval: { start: booking.start, end: addHours(booking.end, 24) } };

    const unconfirmed = await editReservation(context(seed, 'edit-balance-unconfirmed'), booking.id, longer);
    expect(unconfirmed.body).toMatchObject({ success: false, error: { code: 'PRICE_CHANGE_NOT_ACCEPTED' } });

    const raised = await editReservation(context(seed, 'edit-balance-raise'), booking.id, { ...longer, accept_price_change: true });
    expect(raised.body).toMatchObject({ success: true, data: { price_changed: true, previous_due_now_minor: '265000' } });
    const detail = await getReservationDetail(context(seed, 'edit-balance-detail'), booking.id);
    // One more rental day at ₱400; the first payment stays as recorded.
    expect(detail.payment).toMatchObject({ amount_minor: '265000', status: 'paid' });
    expect(detail.balance_payments).toEqual([expect.objectContaining({ amount_minor: '40000', status: 'pending', verified_at: null })]);

    const blocked = await pickupReservation(context(seed, 'edit-balance-pickup-blocked'), booking.id, { version: booking.version + 1 });
    expect(blocked.body).toMatchObject({ success: false, error: { code: 'PAYMENT_PREREQUISITE_FAILED' } });

    const balanceId = detail.balance_payments?.[0]?.id as string;
    const wrongAmount = await collectReservationBalance(context(seed, 'edit-balance-wrong'), booking.id, balanceId, { verified_amount_minor: '30000' });
    expect(wrongAmount.body).toMatchObject({ success: false, error: { code: 'PAYMENT_PREREQUISITE_FAILED' } });
    const [collected, again] = await Promise.all([
      collectReservationBalance(context(seed, 'edit-balance-collect'), booking.id, balanceId, { verified_amount_minor: '40000' }),
      collectReservationBalance(context(seed, 'edit-balance-collect'), booking.id, balanceId, { verified_amount_minor: '40000' }),
    ]);
    expect(collected.body).toMatchObject({ success: true });
    expect(again.body).toEqual(collected.body);
    const replayed = await collectReservationBalance(context(seed, 'edit-balance-collect'), booking.id, balanceId, { verified_amount_minor: '40000' });
    expect(replayed.body).toEqual(collected.body);
    const secondIntent = await collectReservationBalance(context(seed, 'edit-balance-collect-again'), booking.id, balanceId, { verified_amount_minor: '40000' });
    expect(secondIntent.body).toMatchObject({ success: false, error: { code: 'STATE_CONFLICT' } });
    const verifications = await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query('SELECT count(*)::int AS n FROM payment_verification WHERE payment_id = $1', [balanceId]),
    );
    expect(verifications.rows[0]).toEqual({ n: 1 });

    const picked = await pickupReservation(context(seed, 'edit-balance-pickup'), booking.id, { version: booking.version + 1 });
    expect(picked.body).toMatchObject({ success: true, data: { reservation: { status: 'picked_up' } } });
  });

  it('closes an open balance when a later edit brings the total back down', async () => {
    const seed = await seedWorkspace('org_edit_close', 'user_edit_close');
    const booking = await confirmBooking(seed, await createBooking(seed, 'close'));
    await editReservation(context(seed, 'edit-close-up'), booking.id, {
      version: booking.version,
      requested_interval: { start: booking.start, end: addHours(booking.end, 24) },
      accept_price_change: true,
    });

    const back = await editReservation(context(seed, 'edit-close-down'), booking.id, {
      version: booking.version + 1,
      requested_interval: { start: booking.start, end: booking.end },
      accept_price_change: true,
    });

    expect(back.body).toMatchObject({ success: true });
    const detail = await getReservationDetail(context(seed, 'edit-close-detail'), booking.id);
    expect(detail.balance_payments).toEqual([expect.objectContaining({ amount_minor: '40000', status: 'failed' })]);
    const picked = await pickupReservation(context(seed, 'edit-close-pickup'), booking.id, { version: booking.version + 2 });
    expect(picked.body).toMatchObject({ success: true });
  });

  it('asks staff to accept a lower total once the renter has paid and keeps the paid amount', async () => {
    const seed = await seedWorkspace('org_edit_paid', 'user_edit_paid');
    const booking = await confirmBooking(seed, await createBooking(seed, 'paid'));

    const refused = await editReservation(context(seed, 'edit-paid-refused'), booking.id, {
      version: booking.version,
      fulfillment_method: 'pickup',
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ success: false, error: { code: 'PRICE_CHANGE_NOT_ACCEPTED' } });

    const accepted = await editReservation(context(seed, 'edit-paid-accepted'), booking.id, {
      version: booking.version,
      fulfillment_method: 'pickup',
      accept_price_change: true,
    });
    expect(accepted.body).toMatchObject({
      success: true,
      data: { price_changed: true, previous_due_now_minor: '265000', reservation: { status: 'confirmed' } },
    });
    const state = await reservationState(seed, booking.id);
    expect(state.due_now_minor).toBe(240000);
    expect(state.payment_amount_minor).toBe(265000);
    expect(state.payment_status).toBe('paid');
  });

  it('rejects stale versions and edits after pickup', async () => {
    const seed = await seedWorkspace('org_edit_states', 'user_edit_states');
    const booking = await createBooking(seed, 'stale');
    const stale = await editReservation(context(seed, 'edit-stale'), booking.id, { version: booking.version + 1, event_date: null });
    expect(stale.body).toMatchObject({ success: false, error: { code: 'STALE_VERSION' } });

    const confirmed = await confirmBooking(seed, booking);
    const picked = await pickupReservation(context(seed, 'edit-pickup-handover'), confirmed.id, { version: confirmed.version });
    if (picked.body.success !== true) throw new Error('Expected pickup to succeed.');
    const afterPickup = await editReservation(context(seed, 'edit-after-pickup'), booking.id, {
      version: picked.body.data.reservation.version,
      event_date: null,
    });
    expect(afterPickup.body).toMatchObject({ success: false, error: { code: 'INVALID_RESERVATION_TRANSITION' } });
  });

  it('applies one edit for a sequential or concurrent double-fire of the same intent', async () => {
    const seed = await seedWorkspace('org_edit_double', 'user_edit_double');
    const booking = await createBooking(seed, 'double');
    const body = { version: booking.version, requested_interval: { start: booking.start, end: addHours(booking.end, 24) } };

    const [first, second] = await Promise.all([
      editReservation(context(seed, 'edit-double'), booking.id, body),
      editReservation(context(seed, 'edit-double'), booking.id, body),
    ]);
    const replay = await editReservation(context(seed, 'edit-double'), booking.id, body);

    expect([first.status, second.status].sort()).toEqual([200, 200].sort());
    expect(replay.body).toEqual(first.body.success ? first.body : second.body);
    expect(await auditChanges(seed, booking.id)).toHaveLength(1);
    expect((await reservationState(seed, booking.id)).version).toBe(2);

    // A different intent for the same old version loses on the version guard.
    const racing = await editReservation(context(seed, 'edit-double-other'), booking.id, { version: booking.version, event_date: null });
    expect(racing.body).toMatchObject({ success: false, error: { code: 'STALE_VERSION' } });
  });

  it('exposes the edit only to authenticated staff with an idempotency key and a valid body', async () => {
    const seed = await seedWorkspace('org_edit_route', 'user_edit_route');
    const booking = await createBooking(seed, 'route');

    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    expect((await request(createApp()).patch(`/api/v1/reservations/${booking.id}`).set('Idempotency-Key', 'route-edit-1').send({ version: 1, event_date: null })).status).toBe(401);

    useClerk(seed);
    expect((await request(createApp()).patch(`/api/v1/reservations/${booking.id}`).send({ version: 1, event_date: null })).status).toBe(422);
    useClerk(seed);
    const empty = await request(createApp()).patch(`/api/v1/reservations/${booking.id}`).set('Idempotency-Key', 'route-edit-2').send({ version: 1 });
    expect(empty.status).toBe(422);
    expect(empty.body).toMatchObject({ error: { message: 'Change at least one reservation detail.' } });
    useClerk(seed);
    const injected = await request(createApp())
      .patch(`/api/v1/reservations/${booking.id}`)
      .set('Idempotency-Key', 'route-edit-3')
      .send({ version: 1, due_now_minor: '1' });
    expect(injected.status).toBe(422);

    useClerk(seed);
    const edited = await request(createApp())
      .patch(`/api/v1/reservations/${booking.id}`)
      .set('Idempotency-Key', 'route-edit-4')
      .send({ version: 1, fulfillment_method: 'pickup' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ success: true, data: { reservation: { fulfillment_method: 'pickup', version: 2 } } });
  });

  async function seedWorkspace(clerkOrgId: string, principalId: string): Promise<Seed> {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    return withTenantTransaction(tenant.id, principalId, async (client) => {
      const one = async <T>(text: string, values: unknown[]): Promise<T> => {
        const row = (await client.query(text, values)).rows[0] as T | undefined;
        if (!row) throw new Error(`Seed query returned no row: ${text.slice(0, 40)}`);
        return row;
      };
      const branch = await one<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active') RETURNING id`,
        [tenant.id],
      );
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes) VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, branch.id, membershipId, JSON.stringify(PERMISSIONS)],
      );
      const plan = await one<{ id: string }>(`SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true LIMIT 1`, []);
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', statement_timestamp(), statement_timestamp() + interval '30 days')`,
        [tenant.id, plan.id],
      );
      const storefront = await one<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
        [tenant.id, branch.id, `edit-${tenant.id.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO policy_snapshot (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
           delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"enabled":true,"fee_minor":"25000"}'::jsonb,
                 'Edit test privacy notice', statement_timestamp() - interval '1 minute')`,
        [tenant.id, storefront.id],
      );
      const paymentMethod = await one<{ id: string }>(
        `INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES ($1, 'Cash', 'cash', '{"instructions":"Pay at the counter"}'::jsonb, true, 1) RETURNING id`,
        [tenant.id],
      );
      const product = await one<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, description, status)
         VALUES ($1, 'EDIT-GOWN', 'Edit Gown', 'Edit test garment', 'active') RETURNING id`,
        [tenant.id],
      );
      const variant = await one<{ id: string }>(
        `INSERT INTO product_variant (tenant_id, product_id, sku, size_label, color_label, measurement_mode, measurement_unit,
           measurements, rental_price_minor, security_deposit_minor, currency, pricing_mode, included_duration_minutes,
           extra_day_price_minor, prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'EDIT-M', 'M', 'Ivory', 'custom', 'cm', '{"bust":91.5}'::jsonb, 150000, 50000, 'PHP',
                 'fixed_duration', 4320, 40000, 0, 1440, 'active') RETURNING id`,
        [tenant.id, product.id],
      );
      const asset = await one<{ id: string }>(
        `INSERT INTO physical_asset (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'EDIT-ASSET-1', 'active', 'ready', 'at_branch') RETURNING id`,
        [tenant.id, branch.id, variant.id],
      );
      return {
        tenantId: tenant.id,
        clerkOrgId: tenant.clerkOrgId,
        principalId,
        membershipId,
        branchId: branch.id,
        paymentMethodId: paymentMethod.id,
        variantId: variant.id,
        assetId: asset.id,
      };
    });
  }

  async function createBooking(seed: Seed, suffix: string, options: { startDays?: number } = {}): Promise<Booking> {
    const startDays = options.startDays ?? 3;
    const dates = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ start: Date; end: Date }>(
        `WITH pickup AS (
           SELECT date_trunc('day', statement_timestamp() AT TIME ZONE 'Asia/Manila') + make_interval(days => $1) + interval '10 hours' AS local_at
         )
         SELECT local_at AT TIME ZONE 'Asia/Manila' AS start, (local_at + interval '3 days') AT TIME ZONE 'Asia/Manila' AS "end" FROM pickup`,
        [startDays],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Expected booking dates.');
      return row;
    });
    const body: StaffReservationCreateRequest = {
      customer: {
        source: 'new',
        customer: { full_name: 'Edit Customer', phone: '09171234567', email: 'edit@example.test', address: '123 Edit Street, Quezon City' },
      },
      variant_id: seed.variantId as ProductVariantId,
      requested_interval: { start: dates.start.toISOString(), end: dates.end.toISOString() },
      fulfillment_method: 'delivery',
      payment_method_id: seed.paymentMethodId as PaymentMethodId,
    };
    const result = await createStaffReservation(context(seed, `create-${suffix}`), body);
    if (result.status !== 201 || result.body.success !== true) throw new Error(`Expected a held booking, got ${result.status}.`);
    const reservation = result.body.data.reservation;
    const paymentId = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const payment = await client.query<{ id: string }>(`SELECT id FROM payment WHERE tenant_id = $1 AND reservation_id = $2`, [
        seed.tenantId,
        reservation.id,
      ]);
      const id = payment.rows[0]?.id;
      if (!id) throw new Error('Expected the initial payment.');
      return id;
    });
    return { id: reservation.id, version: reservation.version, paymentId, start: reservation.pickup_at, end: reservation.due_at };
  }

  /** Submits, records verified cash, and confirms, the way the counter flow does. */
  async function confirmBooking(seed: Seed, booking: Booking): Promise<Booking> {
    const submitted = await submitReservation(context(seed, `submit-${booking.id}`), booking.id, { version: booking.version, terms_accepted: true });
    if (submitted.status !== 200) throw new Error('Expected submission to succeed.');
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const paid = await client.query<{ amount_minor: number }>(
        `UPDATE payment SET status = 'paid', verified_at = statement_timestamp(), merchant_reference = $3
          WHERE tenant_id = $1 AND id = $2 RETURNING amount_minor`,
        [seed.tenantId, booking.paymentId, `ref-${booking.id}`],
      );
      await client.query(
        `INSERT INTO payment_verification (tenant_id, payment_id, verifier_membership_id, decision, verified_amount_minor, evidence_note, business_key)
         VALUES ($1, $2, $3, 'verified', $4, 'Cash counted at the counter.', $5)`,
        [seed.tenantId, booking.paymentId, seed.membershipId, paid.rows[0]?.amount_minor, `verify:${booking.paymentId}`],
      );
    });
    const confirmed = await confirmReservation(context(seed, `confirm-${booking.id}`), booking.id, { version: booking.version + 1 });
    if (confirmed.status !== 200 || confirmed.body.success !== true) throw new Error('Expected confirmation to succeed.');
    return { ...booking, version: confirmed.body.data.reservation.version };
  }

  function context(seed: Seed, key: string) {
    return {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      membershipId: seed.membershipId,
      principalId: seed.principalId,
      permissionCodes: PERMISSIONS,
      effectiveTenantStatus: 'active' as const,
      requestId: `req-${key}`,
      idempotencyKey: `idem-${key}`,
    };
  }

  async function reservationState(seed: Seed, reservationId: string) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservation = await client.query<{
        version: number;
        event_date: string | null;
        customer_snapshot: Record<string, unknown>;
        delivery_snapshot: Record<string, unknown>;
        rental_total_minor: number;
        due_now_minor: number;
        payment_amount_minor: number;
        payment_status: string;
        line_rental_minor: number;
        profile_name: string;
      }>(
        `SELECT r.version, r.event_date::text AS event_date, r.customer_snapshot, r.delivery_snapshot,
                r.rental_total_minor, r.due_now_minor, p.amount_minor AS payment_amount_minor, p.status AS payment_status,
                (SELECT rental_minor FROM reservation_line WHERE tenant_id = r.tenant_id AND reservation_id = r.id) AS line_rental_minor,
                c.full_name AS profile_name
           FROM reservation r
           JOIN payment p ON p.tenant_id = r.tenant_id AND p.reservation_id = r.id
           JOIN customer c ON c.tenant_id = r.tenant_id AND c.id = r.customer_id
          WHERE r.tenant_id = $1 AND r.id = $2`,
        [seed.tenantId, reservationId],
      );
      const allocations = await client.query<{ asset_id: string; is_blocking: boolean; upper: Date }>(
        `SELECT aa.asset_id, aa.is_blocking, upper(aa.period) AS upper
           FROM asset_allocation aa JOIN reservation_line rl ON rl.tenant_id = aa.tenant_id AND rl.id = aa.reservation_line_id
          WHERE aa.tenant_id = $1 AND rl.reservation_id = $2`,
        [seed.tenantId, reservationId],
      );
      const row = reservation.rows[0];
      if (!row) throw new Error('Expected the reservation.');
      return { ...row, allocations: allocations.rows.map((allocation) => ({ ...allocation, upper: allocation.upper.toISOString() })) };
    });
  }

  async function auditChanges(seed: Seed, reservationId: string): Promise<unknown[]> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ changed: unknown }>(
        `SELECT redacted_summary -> 'changed' AS changed FROM audit_event
          WHERE tenant_id = $1 AND entity_id = $2 AND action = 'reservation.edited' ORDER BY occurred_at`,
        [seed.tenantId, reservationId],
      );
      return result.rows.map((row) => row.changed);
    });
  }

  function useClerk(seed: Seed): void {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }
});

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

/** Manila calendar date `days` after the given instant. */
function localDate(iso: string, days: number): string {
  return new Date(Date.parse(iso) + 8 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}
