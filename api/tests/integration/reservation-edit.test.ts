import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PaymentMethodId,
  PermissionCode,
  ProductVariantId,
  StaffReservationCreateRequest,
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
    confirmReservation,
    createStaffReservation,
    editReservation,
    pickupReservation,
    submitReservation,
  } = await import('../../src/modules/reservations/reservations.service.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('edits only this confirmed reservation snapshot and leaves profile, sibling booking, schedule, and payment unchanged', async () => {
    const seed = await seedWorkspace('org_edit_customer', 'user_edit_customer');
    const booking = await confirmBooking(seed, await createBooking(seed, 'customer'));
    const sibling = await confirmBooking(
      seed,
      await createBooking(seed, 'sibling', { startDays: 10 }),
    );
    const initial = await reservationState(seed, booking.id);

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `UPDATE reservation SET customer_id = $3::uuid, customer_snapshot = $4::jsonb
          WHERE tenant_id = $1 AND id = $2::uuid`,
        [seed.tenantId, sibling.id, initial.customer_id, JSON.stringify(initial.customer_snapshot)],
      ),
    );
    const before = await reservationState(seed, booking.id);
    const siblingBefore = await reservationState(seed, sibling.id);

    const result = await editReservation(context(seed, 'edit-customer'), booking.id, {
      version: booking.version,
      customer: {
        full_name: 'Bea Santiago',
        phone: '09171234801',
        email: 'BEA@Example.test',
        address: '12 Mabini St, Quezon City',
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      data: { reservation: { version: booking.version + 1, status: 'confirmed' } },
    });
    const after = await reservationState(seed, booking.id);
    expect(after.customer_snapshot).toEqual({
      full_name: 'Bea Santiago',
      phone: '09171234801',
      email: 'bea@example.test',
      address: '12 Mabini St, Quezon City',
    });
    expect(after.version).toBe(before.version + 1);
    expect({
      ...after,
      customer_snapshot: before.customer_snapshot,
      version: before.version,
    }).toEqual(before);
    expect(await reservationState(seed, sibling.id)).toEqual(siblingBefore);
    expect(after.profile_name).toBe('Edit Customer');
    expect(await auditChanges(seed, booking.id)).toEqual([['customer']]);
  });

  it.each(['held', 'pending_confirmation'] as const)(
    'rejects edits while a reservation is %s',
    async (status) => {
      const seed = await seedWorkspace(`org_edit_${status}`, `user_edit_${status}`);
      let booking = await createBooking(seed, status);
      if (status === 'pending_confirmation') {
        const submitted = await submitReservation(context(seed, `submit-${status}`), booking.id, {
          version: booking.version,
          terms_accepted: true,
        });
        if (!submitted.body.success) throw new Error('Expected the reservation to submit.');
        booking = { ...booking, version: submitted.body.data.reservation.version };
      }
      const before = await reservationState(seed, booking.id);
      const result = await editReservation(context(seed, `edit-${status}`), booking.id, {
        version: booking.version,
        customer: {
          full_name: 'Updated Name',
          phone: '09171234801',
          email: 'bea@example.test',
          address: '12 Mabini St',
        },
      });
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        success: false,
        error: { code: 'INVALID_RESERVATION_TRANSITION' },
      });
      expect(await reservationState(seed, booking.id)).toEqual(before);
    },
  );

  it('rejects stale versions and edits after pickup', async () => {
    const seed = await seedWorkspace('org_edit_states', 'user_edit_states');
    const booking = await confirmBooking(seed, await createBooking(seed, 'stale'));
    const customer = {
      full_name: 'Edit Customer',
      phone: '09171234567',
      email: 'edit@example.test',
      address: '123 Edit Street',
    };
    const stale = await editReservation(context(seed, 'edit-stale'), booking.id, {
      version: booking.version - 1,
      customer,
    });
    expect(stale.body).toMatchObject({ success: false, error: { code: 'STALE_VERSION' } });

    const picked = await pickupReservation(context(seed, 'edit-pickup-handover'), booking.id, {
      version: booking.version,
    });
    if (picked.body.success !== true) throw new Error('Expected pickup to succeed.');
    const afterPickup = await editReservation(context(seed, 'edit-after-pickup'), booking.id, {
      version: picked.body.data.reservation.version,
      customer,
    });
    expect(afterPickup.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_RESERVATION_TRANSITION' },
    });
  });

  it('applies one confirmed customer edit for a sequential or concurrent double-fire of the same intent', async () => {
    const seed = await seedWorkspace('org_edit_double', 'user_edit_double');
    const booking = await confirmBooking(seed, await createBooking(seed, 'double'));
    const body = {
      version: booking.version,
      customer: {
        full_name: 'Updated Edit Customer',
        phone: '09171234567',
        email: 'edit@example.test',
        address: '123 Edit Street',
      },
    };

    const [first, second] = await Promise.all([
      editReservation(context(seed, 'edit-double'), booking.id, body),
      editReservation(context(seed, 'edit-double'), booking.id, body),
    ]);
    const replay = await editReservation(context(seed, 'edit-double'), booking.id, body);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(replay.body).toEqual(first.body);
    expect(await auditChanges(seed, booking.id)).toHaveLength(1);
    expect((await reservationState(seed, booking.id)).version).toBe(booking.version + 1);

    const racing = await editReservation(context(seed, 'edit-double-other'), booking.id, {
      version: booking.version,
      customer: { ...body.customer, full_name: 'Other intent' },
    });
    expect(racing.body).toMatchObject({ success: false, error: { code: 'STALE_VERSION' } });
  });

  it('exposes only customer snapshot fields to authenticated staff with an idempotency key', async () => {
    const seed = await seedWorkspace('org_edit_route', 'user_edit_route');
    const booking = await confirmBooking(seed, await createBooking(seed, 'route'));
    const customer = {
      full_name: 'Edited Route Customer',
      phone: '09171234801',
      email: 'route@example.test',
      address: '12 Mabini St',
    };

    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    expect(
      (
        await request(createApp())
          .patch(`/api/v1/reservations/${booking.id}`)
          .set('Idempotency-Key', 'route-edit-1')
          .send({ version: booking.version, customer })
      ).status,
    ).toBe(401);

    useClerk(seed);
    expect(
      (
        await request(createApp())
          .patch(`/api/v1/reservations/${booking.id}`)
          .send({ version: booking.version, customer })
      ).status,
    ).toBe(422);
    for (const [index, field] of [
      'requested_interval',
      'event_date',
      'fulfillment_method',
      'accept_price_change',
      'due_now_minor',
      'payment_method_id',
    ].entries()) {
      useClerk(seed);
      const rejected = await request(createApp())
        .patch(`/api/v1/reservations/${booking.id}`)
        .set('Idempotency-Key', `route-edit-invalid-${index}`)
        .send({
          version: booking.version,
          customer,
          [field]:
            field === 'requested_interval' ? { start: booking.start, end: booking.end } : null,
        });
      expect(rejected.status).toBe(422);
    }

    useClerk(seed);
    const edited = await request(createApp())
      .patch(`/api/v1/reservations/${booking.id}`)
      .set('Idempotency-Key', 'route-edit-valid')
      .send({ version: booking.version, customer });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'confirmed', version: booking.version + 1 } },
    });
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
      const plan = await one<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true LIMIT 1`,
        [],
      );
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

  async function createBooking(
    seed: Seed,
    suffix: string,
    options: { startDays?: number } = {},
  ): Promise<Booking> {
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
        customer: {
          full_name: 'Edit Customer',
          phone: '09171234567',
          email: 'edit@example.test',
          address: '123 Edit Street, Quezon City',
        },
      },
      variant_id: seed.variantId as ProductVariantId,
      requested_interval: { start: dates.start.toISOString(), end: dates.end.toISOString() },
      fulfillment_method: 'delivery',
      payment_method_id: seed.paymentMethodId as PaymentMethodId,
    };
    const result = await createStaffReservation(context(seed, `create-${suffix}`), body);
    if (result.status !== 201 || result.body.success !== true)
      throw new Error(`Expected a held booking, got ${result.status}.`);
    const reservation = result.body.data.reservation;
    const paymentId = await withTenantTransaction(
      seed.tenantId,
      seed.principalId,
      async (client) => {
        const payment = await client.query<{ id: string }>(
          `SELECT id FROM payment WHERE tenant_id = $1 AND reservation_id = $2`,
          [seed.tenantId, reservation.id],
        );
        const id = payment.rows[0]?.id;
        if (!id) throw new Error('Expected the initial payment.');
        return id;
      },
    );
    return {
      id: reservation.id,
      version: reservation.version,
      paymentId,
      start: reservation.pickup_at,
      end: reservation.due_at,
    };
  }

  /** Submits, records verified cash, and confirms, the way the counter flow does. */
  async function confirmBooking(seed: Seed, booking: Booking): Promise<Booking> {
    const submitted = await submitReservation(context(seed, `submit-${booking.id}`), booking.id, {
      version: booking.version,
      terms_accepted: true,
    });
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
        [
          seed.tenantId,
          booking.paymentId,
          seed.membershipId,
          paid.rows[0]?.amount_minor,
          `verify:${booking.paymentId}`,
        ],
      );
    });
    const confirmed = await confirmReservation(context(seed, `confirm-${booking.id}`), booking.id, {
      version: booking.version + 1,
    });
    if (confirmed.status !== 200 || confirmed.body.success !== true)
      throw new Error('Expected confirmation to succeed.');
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
        customer_id: string;
        version: number;
        status: string;
        pickup_at: Date;
        due_at: Date;
        fulfillment_method: string;
        event_date: string | null;
        customer_snapshot: Record<string, unknown>;
        delivery_snapshot: Record<string, unknown>;
        rental_total_minor: number;
        due_now_minor: number;
        payment_id: string;
        payment_amount_minor: number;
        payment_status: string;
        payment_merchant_reference: string | null;
        payment_verified_at: Date | null;
        payment_receipt_count: string;
        line_rental_minor: number;
        profile_name: string;
        profile_phone: string;
        profile_email: string;
      }>(
        `SELECT r.customer_id, r.version, r.status, r.pickup_at, r.due_at, r.fulfillment_method,
                r.event_date::text AS event_date, r.customer_snapshot, r.delivery_snapshot,
                r.rental_total_minor, r.due_now_minor, p.id AS payment_id, p.amount_minor AS payment_amount_minor,
                p.status AS payment_status, p.merchant_reference AS payment_merchant_reference,
                p.verified_at AS payment_verified_at,
                (SELECT count(*) FROM payment_receipt pr WHERE pr.tenant_id = r.tenant_id AND pr.payment_id = p.id) AS payment_receipt_count,
                (SELECT rental_minor FROM reservation_line WHERE tenant_id = r.tenant_id AND reservation_id = r.id) AS line_rental_minor,
                c.full_name AS profile_name, c.phone AS profile_phone, c.email AS profile_email
           FROM reservation r
           JOIN payment p ON p.tenant_id = r.tenant_id AND p.reservation_id = r.id
           JOIN customer c ON c.tenant_id = r.tenant_id AND c.id = r.customer_id
          WHERE r.tenant_id = $1 AND r.id = $2`,
        [seed.tenantId, reservationId],
      );
      const allocations = await client.query<{
        asset_id: string;
        is_blocking: boolean;
        upper: Date;
      }>(
        `SELECT aa.asset_id, aa.is_blocking, upper(aa.period) AS upper
           FROM asset_allocation aa JOIN reservation_line rl ON rl.tenant_id = aa.tenant_id AND rl.id = aa.reservation_line_id
          WHERE aa.tenant_id = $1 AND rl.reservation_id = $2`,
        [seed.tenantId, reservationId],
      );
      const row = reservation.rows[0];
      if (!row) throw new Error('Expected the reservation.');
      return {
        ...row,
        pickup_at: row.pickup_at.toISOString(),
        due_at: row.due_at.toISOString(),
        allocations: allocations.rows.map((allocation) => ({
          ...allocation,
          upper: allocation.upper.toISOString(),
        })),
      };
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
