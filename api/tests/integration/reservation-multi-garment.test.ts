import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PaymentMethodId, PermissionCode, ProductVariantId, StaffReservationCreateRequest } from '@drezivo/contracts';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: vi.fn(),
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
  principalId: string;
  membershipId: string;
  branchId: string;
  paymentMethodId: string;
  /** Celestine: two physical pieces, ₱1,500 for 3 days, ₱500 deposit. */
  celestineId: string;
  /** Amara: one physical piece, ₱1,000 for 3 days, ₱300 deposit. */
  amaraId: string;
}

/** Bookings run 3 rental days (pickup day 3, return day 5), so neither gown charges an extra day. */
describe('multi-garment reservations', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const service = await import('../../src/modules/reservations/reservations.service.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('books several garments at once, gives each its own piece and price, and charges delivery once', async () => {
    const seed = await seedWorkspace('org_multi_create', 'user_multi_create');

    const created = await service.createStaffReservation(
      context(seed, 'create'),
      await request(seed, [seed.celestineId, seed.celestineId, seed.amaraId]),
    );

    expect(created.status).toBe(201);
    if (created.body.success !== true) throw new Error('Expected the booking to be created.');
    const reservation = created.body.data.reservation;
    // Rentals 1,500 + 1,500 + 1,000, deposits 500 + 500 + 300, one ₱250 delivery fee.
    expect(reservation.price_snapshot).toMatchObject({
      rental_total_minor: '400000',
      security_required_minor: '130000',
      due_now_minor: '555000',
    });
    const lines = await lineState(seed, reservation.id);
    expect(lines.map((line) => [line.line_number, line.variant_id, line.rental_minor, line.deposit_minor])).toEqual([
      [1, seed.celestineId, 150000, 50000],
      [2, seed.celestineId, 150000, 50000],
      [3, seed.amaraId, 100000, 30000],
    ]);
    expect(new Set(lines.map((line) => line.asset_id)).size).toBe(3);
    expect(lines.every((line) => line.is_blocking && line.kind === 'reservation_hold')).toBe(true);
    expect(await paymentAmount(seed, reservation.id)).toBe(555000);

    const detail = await service.getReservationDetail(context(seed, 'detail'), reservation.id);
    expect(detail.lines.map((line) => line.name_snapshot)).toEqual(['Celestine', 'Celestine', 'Amara']);
    const list = await service.getReservationList(context(seed, 'list'), { limit: 10, sort: 'created_desc' });
    expect(list.items[0]).toMatchObject({ line_count: 3, line: { name_snapshot: 'Celestine' } });
  });

  it('refuses the whole booking and names the garment when one of them has no free piece', async () => {
    const seed = await seedWorkspace('org_multi_full', 'user_multi_full');

    const result = await service.createStaffReservation(
      context(seed, 'full'),
      await request(seed, [seed.celestineId, seed.amaraId, seed.amaraId]),
    );

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      success: false,
      error: { code: 'CAPACITY_CONFLICT', message: 'Amara is no longer available for those dates.' },
    });
    expect(await reservationCount(seed)).toBe(0);
  });

  it('confirms, hands over, receives back, inspects, and completes every garment together', async () => {
    const seed = await seedWorkspace('org_multi_life', 'user_multi_life');
    const booking = await createBooking(seed, 'life', [seed.celestineId, seed.amaraId]);
    const confirmed = await confirm(seed, booking);
    expect((await lineState(seed, booking.id)).every((line) => line.kind === 'reservation_confirmed')).toBe(true);

    const picked = await service.pickupReservation(context(seed, 'pickup'), booking.id, { version: confirmed });
    expect(picked.body).toMatchObject({ success: true, data: { reservation: { status: 'picked_up' } } });
    expect((await lineState(seed, booking.id)).map((line) => line.custody_kind)).toEqual(['with_customer', 'with_customer']);
    expect(await custodyEvents(seed, booking.id, 'pickup')).toBe(2);
    if (picked.body.success !== true) throw new Error('Expected pickup to succeed.');

    const returned = await service.returnReservation(context(seed, 'return'), booking.id, {
      version: picked.body.data.reservation.version,
    });
    expect(returned.body).toMatchObject({ success: true, data: { reservation: { status: 'returned' } } });
    expect((await lineState(seed, booking.id)).map((line) => line.custody_kind)).toEqual(['at_branch', 'at_branch']);
    expect(await custodyEvents(seed, booking.id, 'return')).toBe(2);
    if (returned.body.success !== true) throw new Error('Expected return to succeed.');
    const version = returned.body.data.reservation.version;

    const inspected = await service.inspectReturnedReservation(context(seed, 'inspect'), booking.id, { version, readiness: 'ready' });
    expect(inspected.body).toMatchObject({ success: true, data: { asset_readiness: 'ready' } });
    expect((await lineState(seed, booking.id)).map((line) => line.readiness)).toEqual(['ready', 'ready']);

    const completed = await service.completeRentalReservation(context(seed, 'complete'), booking.id, { version });
    expect(completed.body).toMatchObject({ success: true, data: { reservation: { status: 'completed' } } });
    expect((await lineState(seed, booking.id)).every((line) => !line.is_blocking)).toBe(true);
  });

  it('releases every garment when a multi-garment booking is cancelled', async () => {
    const seed = await seedWorkspace('org_multi_cancel', 'user_multi_cancel');
    const booking = await createBooking(seed, 'cancel', [seed.celestineId, seed.celestineId]);

    const cancelled = await service.cancelReservation(context(seed, 'cancel'), booking.id, { version: booking.version });

    expect(cancelled.body).toMatchObject({ success: true, data: { reservation: { status: 'cancelled' } } });
    expect((await lineState(seed, booking.id)).map((line) => line.is_blocking)).toEqual([false, false]);
    // Both pieces are free again for the same dates.
    const again = await service.createStaffReservation(context(seed, 'again'), await request(seed, [seed.celestineId, seed.celestineId]));
    expect(again.status).toBe(201);
  });

  it('moves every garment when the dates of a multi-garment booking are edited', async () => {
    const seed = await seedWorkspace('org_multi_edit', 'user_multi_edit');
    const booking = await createBooking(seed, 'edit', [seed.celestineId, seed.amaraId]);
    const end = new Date(Date.parse(booking.end) + 86_400_000).toISOString();

    const edited = await service.editReservation(context(seed, 'edit-dates'), booking.id, {
      version: booking.version,
      requested_interval: { start: booking.start, end },
    });

    expect(edited.status).toBe(200);
    const lines = await lineState(seed, booking.id);
    expect(lines.every((line) => line.is_blocking)).toBe(true);
    expect(new Set(lines.map((line) => line.upper)).size).toBe(1);
    expect(lines[0]?.upper).toBe(new Date(Date.parse(end) + 1_440 * 60_000).toISOString());
  });

  it('creates one booking for a sequential or concurrent double-fire of the same intent', async () => {
    const seed = await seedWorkspace('org_multi_double', 'user_multi_double');
    const body = await request(seed, [seed.celestineId, seed.amaraId]);

    const [first, second] = await Promise.all([
      service.createStaffReservation(context(seed, 'double'), body),
      service.createStaffReservation(context(seed, 'double'), body),
    ]);
    const replay = await service.createStaffReservation(context(seed, 'double'), body);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(replay.body).toEqual(first.body);
    expect(await reservationCount(seed)).toBe(1);
  });

  async function seedWorkspace(clerkOrgId: string, principalId: string): Promise<Seed> {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'owner');
    return withTenantTransaction(tenant.id, principalId, async (client) => {
      const one = async (text: string, values: unknown[]): Promise<string> => {
        const row = (await client.query<{ id: string }>(text, values)).rows[0];
        if (!row) throw new Error(`Seed query returned no row: ${text.slice(0, 40)}`);
        return row.id;
      };
      const branchId = await one(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active') RETURNING id`,
        [tenant.id],
      );
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes) VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, branchId, membershipId, JSON.stringify(PERMISSIONS)],
      );
      const planId = await one(`SELECT id FROM plan WHERE code = 'standard' AND version = 1 AND active = true LIMIT 1`, []);
      await client.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', statement_timestamp(), statement_timestamp() + interval '30 days')`,
        [tenant.id, planId],
      );
      const storefrontId = await one(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
        [tenant.id, branchId, `multi-${tenant.id.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO policy_snapshot (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
           delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"enabled":true,"fee_minor":"25000"}'::jsonb,
                 'Multi-garment privacy notice', statement_timestamp() - interval '1 minute')`,
        [tenant.id, storefrontId],
      );
      const paymentMethodId = await one(
        `INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES ($1, 'Cash', 'cash', '{"instructions":"Pay at the counter"}'::jsonb, true, 1) RETURNING id`,
        [tenant.id],
      );
      const gown = async (code: string, name: string, rental: number, deposit: number, pieces: number): Promise<string> => {
        const productId = await one(
          `INSERT INTO product (tenant_id, code, name, description, status) VALUES ($1, $2, $3, 'Multi test gown', 'active') RETURNING id`,
          [tenant.id, code, name],
        );
        const variantId = await one(
          `INSERT INTO product_variant (tenant_id, product_id, sku, size_label, color_label, measurement_mode, measurement_unit,
             measurements, rental_price_minor, security_deposit_minor, currency, pricing_mode, included_duration_minutes,
             extra_day_price_minor, prep_minutes, turnaround_minutes, status)
           VALUES ($1, $2, $3, 'M', 'Ivory', 'custom', 'in', '{"bust":34}'::jsonb, $4, $5, 'PHP',
                   'fixed_duration', 4320, 40000, 0, 1440, 'active') RETURNING id`,
          [tenant.id, productId, `${code}-M`, rental, deposit],
        );
        for (let piece = 1; piece <= pieces; piece += 1) {
          await client.query(
            `INSERT INTO physical_asset (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
             VALUES ($1, $2, $3, $4, 'active', 'ready', 'at_branch')`,
            [tenant.id, branchId, variantId, `${code}-${piece}`],
          );
        }
        return variantId;
      };
      return {
        tenantId: tenant.id,
        principalId,
        membershipId,
        branchId,
        paymentMethodId,
        celestineId: await gown('CELESTINE', 'Celestine', 150000, 50000, 2),
        amaraId: await gown('AMARA', 'Amara', 100000, 30000, 1),
      };
    });
  }

  async function request(seed: Seed, variantIds: string[]): Promise<StaffReservationCreateRequest> {
    const dates = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ start: Date; end: Date }>(
        `WITH pickup AS (SELECT date_trunc('day', statement_timestamp() AT TIME ZONE 'Asia/Manila') + interval '3 days 10 hours' AS local_at)
         SELECT local_at AT TIME ZONE 'Asia/Manila' AS start, (local_at + interval '2 days') AT TIME ZONE 'Asia/Manila' AS "end" FROM pickup`,
      );
      const row = result.rows[0];
      if (!row) throw new Error('Expected booking dates.');
      return row;
    });
    const [first, ...rest] = variantIds;
    return {
      customer: {
        source: 'new',
        customer: { full_name: 'Bea Santiago', phone: '09171234801', email: 'bea@example.test', address: '12 Mabini St, Quezon City' },
      },
      variant_id: first as ProductVariantId,
      ...(rest.length > 0 ? { additional_variant_ids: rest as ProductVariantId[] } : {}),
      requested_interval: { start: dates.start.toISOString(), end: dates.end.toISOString() },
      fulfillment_method: 'delivery',
      payment_method_id: seed.paymentMethodId as PaymentMethodId,
    };
  }

  async function createBooking(seed: Seed, key: string, variantIds: string[]) {
    const created = await service.createStaffReservation(context(seed, `create-${key}`), await request(seed, variantIds));
    if (created.status !== 201 || created.body.success !== true) throw new Error(`Expected a booking, got ${created.status}.`);
    const reservation = created.body.data.reservation;
    return { id: reservation.id, version: reservation.version, start: reservation.pickup_at, end: reservation.due_at };
  }

  /** Submit, record verified cash for the full amount, and confirm. Returns the confirmed version. */
  async function confirm(seed: Seed, booking: { id: string; version: number }): Promise<number> {
    const submitted = await service.submitReservation(context(seed, `submit-${booking.id}`), booking.id, {
      version: booking.version,
      terms_accepted: true,
    });
    if (submitted.status !== 200) throw new Error('Expected submission.');
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const paid = await client.query<{ id: string; amount_minor: number }>(
        `UPDATE payment SET status = 'paid', verified_at = statement_timestamp(), merchant_reference = 'cash-counter'
          WHERE tenant_id = $1 AND reservation_id = $2 RETURNING id, amount_minor`,
        [seed.tenantId, booking.id],
      );
      const payment = paid.rows[0];
      if (!payment) throw new Error('Expected the payment.');
      await client.query(
        `INSERT INTO payment_verification (tenant_id, payment_id, verifier_membership_id, decision, verified_amount_minor, evidence_note, business_key)
         VALUES ($1, $2, $3, 'verified', $4, 'Cash counted.', $5)`,
        [seed.tenantId, payment.id, seed.membershipId, payment.amount_minor, `verify:${payment.id}`],
      );
    });
    const confirmed = await service.confirmReservation(context(seed, `confirm-${booking.id}`), booking.id, { version: booking.version + 1 });
    if (confirmed.status !== 200 || confirmed.body.success !== true) throw new Error('Expected confirmation.');
    return confirmed.body.data.reservation.version;
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
      idempotencyKey: `idem-multi-${key}`,
    };
  }

  async function lineState(seed: Seed, reservationId: string) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{
        line_number: number;
        variant_id: string;
        rental_minor: number;
        deposit_minor: number;
        asset_id: string;
        kind: string;
        is_blocking: boolean;
        upper: Date;
        custody_kind: string;
        readiness: string;
      }>(
        `SELECT rl.line_number, rl.variant_id, rl.rental_minor, rl.deposit_minor, aa.asset_id, aa.kind, aa.is_blocking,
                upper(aa.period) AS upper, pa.custody_kind, pa.readiness
           FROM reservation_line rl
           JOIN asset_allocation aa ON aa.tenant_id = rl.tenant_id AND aa.reservation_line_id = rl.id
           JOIN physical_asset pa ON pa.tenant_id = aa.tenant_id AND pa.id = aa.asset_id
          WHERE rl.tenant_id = $1 AND rl.reservation_id = $2
          ORDER BY rl.line_number`,
        [seed.tenantId, reservationId],
      );
      return result.rows.map((row) => ({ ...row, upper: row.upper.toISOString() }));
    });
  }

  async function paymentAmount(seed: Seed, reservationId: string): Promise<number | undefined> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ amount_minor: number }>(`SELECT amount_minor FROM payment WHERE tenant_id = $1 AND reservation_id = $2`, [
        seed.tenantId,
        reservationId,
      ]);
      return result.rows[0]?.amount_minor;
    });
  }

  async function reservationCount(seed: Seed): Promise<number> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM reservation WHERE tenant_id = $1`, [seed.tenantId]);
      return result.rows[0]?.n ?? -1;
    });
  }

  async function custodyEvents(seed: Seed, reservationId: string, kind: 'pickup' | 'return'): Promise<number> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM custody_event ce
           JOIN reservation_line rl ON rl.tenant_id = ce.tenant_id AND rl.id = ce.reservation_line_id
          WHERE ce.tenant_id = $1 AND rl.reservation_id = $2 AND ce.event_kind = $3`,
        [seed.tenantId, reservationId, kind],
      );
      return result.rows[0]?.n ?? -1;
    });
  }
});
