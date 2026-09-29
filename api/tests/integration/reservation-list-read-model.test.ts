import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionCode } from '@drezivo/contracts';

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
process.env.OBJECT_STORAGE_REGION ??= 'test';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE ??= 'private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC ??= 'public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID ??= 'test';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ??= 'test';

type ReservationState =
  | 'held'
  | 'pending_confirmation'
  | 'confirmed'
  | 'picked_up'
  | 'returned'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'rejected';

interface WorkspaceSeed {
  tenantId: string;
  clerkOrgId: string;
  principalId: string;
  membershipId: string;
  branchId: string;
  storefrontId: string;
  policySnapshotId: string;
  cashPaymentMethodId: string;
  qrPaymentMethodId: string;
  productCode: string;
  variantSku: string;
  variantId: string;
}

interface SeedReservationInput {
  referenceCode: string;
  status: ReservationState;
  pickupAt: string;
  dueAt: string;
  lineName: string;
  customer?: {
    fullName: string;
    phone?: string;
    email?: string;
  };
  payment?: {
    rail: 'cash' | 'manual_qr';
    status: 'pending' | 'partially_paid' | 'paid' | 'failed' | 'refunded';
    amountMinor: number;
  };
}

describe('RSV Phase 1 reservation read model', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { getReservationDetail, getReservationList } = await import(
    '../../src/modules/reservations/reservations.service.js'
  );
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  beforeEach(() => {
    clerk.getAuth.mockReset();
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('searches safe reservation/customer/clothing fields, filters by state/date, and keeps payment state separate', async () => {
    const seed = await seedWorkspace('org_rsv010_search', 'user_rsv010_search', ['reservations.manage']);
    const alphaId = await seedReservation(seed, {
      referenceCode: 'RSV-ALPHA',
      status: 'confirmed',
      pickupAt: '2026-10-10T02:00:00.000Z',
      dueAt: '2026-10-11T02:00:00.000Z',
      lineName: 'Emerald Formal Gown',
      customer: {
        fullName: 'Maria Santos',
        phone: '09171234567',
        email: 'maria@example.test',
      },
      payment: { rail: 'cash', status: 'paid', amountMinor: 12000 },
    });
    const betaId = await seedReservation(seed, {
      referenceCode: 'RSV-BETA',
      status: 'pending_confirmation',
      pickupAt: '2026-10-12T02:00:00.000Z',
      dueAt: '2026-10-13T02:00:00.000Z',
      lineName: 'Ruby Pageant Dress',
      customer: { fullName: 'Carla Reyes', email: 'carla@example.test' },
      payment: { rail: 'manual_qr', status: 'pending', amountMinor: 5000 },
    });
    const holdId = await seedReservation(seed, {
      referenceCode: 'RSV-HOLD',
      status: 'held',
      pickupAt: '2026-10-14T02:00:00.000Z',
      dueAt: '2026-10-15T02:00:00.000Z',
      lineName: 'Anonymous Hold Dress',
    });
    const context = reservationContext(seed);

    const byPhone = await getReservationList(context, {
      limit: 20,
      sort: 'pickup_asc',
      search: '09171234567',
    });
    expect(byPhone.items.map((item) => item.id)).toEqual([alphaId]);

    const byReference = await getReservationList(context, {
      limit: 20,
      sort: 'pickup_asc',
      search: 'RSV-BETA',
    });
    expect(byReference.items.map((item) => item.id)).toEqual([betaId]);

    const byClothing = await getReservationList(context, {
      limit: 20,
      sort: 'pickup_asc',
      search: 'Ruby Pageant',
    });
    expect(byClothing.items.map((item) => item.id)).toEqual([betaId]);

    const byCatalogueIdentity = await getReservationList(context, {
      limit: 20,
      sort: 'pickup_asc',
      search: seed.productCode,
    });
    expect(byCatalogueIdentity.items.map((item) => item.id)).toEqual([alphaId, betaId, holdId]);

    const byStatusAndWindow = await getReservationList(context, {
      limit: 20,
      sort: 'pickup_asc',
      status: 'pending_confirmation',
      pickup_start: '2026-10-11T00:00:00.000Z',
      pickup_end: '2026-10-13T00:00:00.000Z',
    });
    expect(byStatusAndWindow.items.map((item) => item.id)).toEqual([betaId]);

    const all = await getReservationList(context, { limit: 20, sort: 'pickup_asc' });
    const alpha = all.items.find((item) => item.id === alphaId);
    const beta = all.items.find((item) => item.id === betaId);
    const hold = all.items.find((item) => item.id === holdId);
    expect(alpha).toMatchObject({
      status: 'confirmed',
      customer: {
        snapshot: { full_name: 'Maria Santos', phone: '09171234567', email: 'maria@example.test' },
      },
      payment: { status: 'paid', evidence_status: 'not_required', amount_minor: '12000' },
    });
    expect(beta).toMatchObject({
      status: 'pending_confirmation',
      payment: { status: 'pending', evidence_status: 'awaiting_upload', amount_minor: '5000' },
    });
    expect(hold).toMatchObject({ customer: { customer_id: null, snapshot: null }, payment: null });
  });

  it('uses deterministic keyset pagination and rejects a cursor reused with another sort', async () => {
    const seed = await seedWorkspace('org_rsv010_page', 'user_rsv010_page', ['reservations.manage']);
    for (let day = 1; day <= 5; day += 1) {
      const dayText = String(day).padStart(2, '0');
      await seedReservation(seed, {
        referenceCode: `RSV-PAGE-${dayText}`,
        status: 'confirmed',
        pickupAt: `2026-11-${dayText}T02:00:00.000Z`,
        dueAt: `2026-11-${String(day + 1).padStart(2, '0')}T02:00:00.000Z`,
        lineName: `Pagination Gown ${dayText}`,
        customer: { fullName: `Customer ${dayText}`, email: `page${dayText}@example.test` },
      });
    }
    const context = reservationContext(seed);

    const first = await getReservationList(context, { limit: 2, sort: 'pickup_asc' });
    expect(first.items.map((item) => item.reference_code)).toEqual(['RSV-PAGE-01', 'RSV-PAGE-02']);
    expect(first.page_meta.has_more).toBe(true);
    expect(typeof first.page_meta.next_cursor).toBe('string');

    const second = await getReservationList(context, {
      limit: 2,
      sort: 'pickup_asc',
      cursor: first.page_meta.next_cursor ?? undefined,
    });
    expect(second.items.map((item) => item.reference_code)).toEqual(['RSV-PAGE-03', 'RSV-PAGE-04']);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4);

    await expect(
      getReservationList(context, {
        limit: 2,
        sort: 'reference_asc',
        cursor: first.page_meta.next_cursor ?? undefined,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('does not enumerate reservations from another tenant or another branch', async () => {
    const tenantA = await seedWorkspace('org_rsv010_iso_a', 'user_rsv010_iso_a', ['reservations.manage']);
    const tenantB = await seedWorkspace('org_rsv010_iso_b', 'user_rsv010_iso_b', ['reservations.manage']);
    await seedReservation(tenantA, {
      referenceCode: 'RSV-A-PUBLIC',
      status: 'confirmed',
      pickupAt: '2026-12-01T02:00:00.000Z',
      dueAt: '2026-12-02T02:00:00.000Z',
      lineName: 'Tenant A Gown',
      customer: { fullName: 'Tenant A Customer', email: 'a@example.test' },
    });
    await seedReservation(tenantB, {
      referenceCode: 'RSV-B-SECRET',
      status: 'confirmed',
      pickupAt: '2026-12-03T02:00:00.000Z',
      dueAt: '2026-12-04T02:00:00.000Z',
      lineName: 'Secret Tenant B Dress',
      customer: { fullName: 'Secret Tenant B Customer', email: 'secret-b@example.test' },
    });

    const foreignSearch = await getReservationList(reservationContext(tenantA), {
      limit: 20,
      sort: 'pickup_asc',
      search: 'RSV-B-SECRET',
    });
    expect(foreignSearch.items).toEqual([]);

    const branchTwoId = await withTenantTransaction(tenantA.tenantId, tenantA.principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Second Branch', 'SECOND', false, 'Asia/Manila', 'active')
         RETURNING id`,
        [tenantA.tenantId],
      );
      return requireRow(branch.rows, 'second branch').id;
    });
    await seedReservation({ ...tenantA, branchId: branchTwoId }, {
      referenceCode: 'RSV-A-OTHER-BRANCH',
      status: 'confirmed',
      pickupAt: '2026-12-05T02:00:00.000Z',
      dueAt: '2026-12-06T02:00:00.000Z',
      lineName: 'Other Branch Dress',
      customer: { fullName: 'Other Branch Customer', email: 'branch@example.test' },
    });

    const branchSearch = await getReservationList(reservationContext(tenantA), {
      limit: 20,
      sort: 'pickup_asc',
      search: 'RSV-A-OTHER-BRANCH',
    });
    expect(branchSearch.items).toEqual([]);
  });

  it('protects the HTTP list route with staff auth, reservation permission, and bounded query validation', async () => {
    clerk.getAuth.mockReturnValueOnce({ userId: null, orgId: null });
    const unauthenticated = await request(createApp()).get('/api/v1/reservations');
    expect(unauthenticated.status).toBe(401);
    expectSafeError(unauthenticated.body, 'UNAUTHENTICATED');

    const noPermission = await seedWorkspace('org_rsv010_route_denied', 'user_rsv010_route_denied', []);
    useClerk(noPermission);
    const forbidden = await request(createApp()).get('/api/v1/reservations');
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');

    const allowed = await seedWorkspace('org_rsv010_route_allowed', 'user_rsv010_route_allowed', [
      'reservations.manage',
    ]);
    await seedReservation(allowed, {
      referenceCode: 'RSV-ROUTE-1',
      status: 'confirmed',
      pickupAt: '2026-10-20T02:00:00.000Z',
      dueAt: '2026-10-21T02:00:00.000Z',
      lineName: 'Route Test Gown',
      customer: { fullName: 'Route Customer', email: 'route@example.test' },
    });
    useClerk(allowed);

    const invalidWindow = await request(createApp())
      .get('/api/v1/reservations')
      .query({
        pickup_start: '2026-10-01T00:00:00.000Z',
        pickup_end: '2026-11-02T00:00:00.000Z',
      });
    expect(invalidWindow.status).toBe(422);
    expectSafeError(invalidWindow.body, 'VALIDATION_FAILED');

    useClerk(allowed);
    const response = await request(createApp())
      .get('/api/v1/reservations')
      .query({ search: 'RSV-ROUTE-1', limit: '10', sort: 'reference_asc' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        items: [{ reference_code: 'RSV-ROUTE-1', status: 'confirmed' }],
        page_meta: { next_cursor: null, has_more: false },
      },
    });
  });

  it('returns snapshot-safe detail with payment evidence status and custody facts but no private notes or evidence metadata', async () => {
    const seed = await seedWorkspace('org_rsv011_detail', 'user_rsv011_detail', ['reservations.manage']);
    const reservationId = await seedReservation(seed, {
      referenceCode: 'RSV-DETAIL-1',
      status: 'picked_up',
      pickupAt: '2026-10-10T02:00:00.000Z',
      dueAt: '2026-10-13T02:00:00.000Z',
      lineName: 'Emerald Gown Snapshot',
      customer: {
        fullName: 'Maria Snapshot',
        phone: '09170001111',
        email: 'snapshot@example.test',
      },
      payment: { rail: 'manual_qr', status: 'paid', amountMinor: 12000 },
    });

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const relation = await client.query<{
        line_id: string;
        customer_id: string;
        payment_id: string;
      }>(
        `SELECT rl.id AS line_id, r.customer_id, p.id AS payment_id
           FROM reservation r
           JOIN reservation_line rl
             ON rl.tenant_id = r.tenant_id
            AND rl.reservation_id = r.id
           JOIN payment p
             ON p.tenant_id = r.tenant_id
            AND p.reservation_id = r.id
          WHERE r.tenant_id = $1
            AND r.id = $2`,
        [seed.tenantId, reservationId],
      );
      const ids = requireRow(relation.rows, 'detail relation');

      await client.query(
        `UPDATE reservation
            SET event_date = '2026-10-11',
                delivery_snapshot = '{"fulfillment_method":"pickup"}'::jsonb,
                hold_acquired_at = '2026-10-09T01:45:00.000Z',
                hold_expires_at = '2026-10-09T02:00:00.000Z',
                terms_accepted_at = '2026-10-09T01:50:00.000Z',
                submitted_at = '2026-10-09T01:51:00.000Z',
                confirmed_at = '2026-10-09T02:05:00.000Z',
                version = 4
          WHERE tenant_id = $1
            AND id = $2`,
        [seed.tenantId, reservationId],
      );
      await client.query(
        `UPDATE reservation_line
            SET measurements_snapshot = '{"bust":91.5,"waist":72}'::jsonb
          WHERE tenant_id = $1
            AND id = $2`,
        [seed.tenantId, ids.line_id],
      );
      await client.query(
        `UPDATE customer
            SET notes = 'PRIVATE CUSTOMER NOTE - MUST NOT LEAVE THE API',
                full_name = 'Live Customer Name Changed'
          WHERE tenant_id = $1
            AND id = $2`,
        [seed.tenantId, ids.customer_id],
      );

      const asset = await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'AST-RSV-DETAIL-1', 'active', 'ready', 'with_customer')
         RETURNING id`,
        [seed.tenantId, seed.branchId, seed.variantId],
      );
      const assetId = requireRow(asset.rows, 'detail asset').id;
      await client.query(
        `INSERT INTO custody_event
           (tenant_id, branch_id, asset_id, reservation_line_id, actor_membership_id,
            event_kind, occurred_at, condition_snapshot, business_key)
         VALUES ($1, $2, $3, $4, $5, 'pickup', '2026-10-10T02:00:00.000Z',
                 '{"condition_note":"Released in good condition."}'::jsonb,
                 'rsv011-detail-pickup')`,
        [seed.tenantId, seed.branchId, assetId, ids.line_id, seed.membershipId],
      );

      const file = await client.query<{ id: string }>(
        `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'payment_receipt', 'private/rsv011/payment-proof.png', 'proof-v1',
                 'image/png', 512, 'accepted', true, now() + interval '5 minutes', now())
         RETURNING id`,
        [seed.tenantId],
      );
      await client.query(
        `INSERT INTO payment_receipt (tenant_id, payment_id, file_id, evidence_status, submitted_at)
         VALUES ($1, $2, $3, 'verified', '2026-10-09T02:03:00.000Z')`,
        [seed.tenantId, ids.payment_id, requireRow(file.rows, 'payment evidence file').id],
      );
      await client.query(
        `INSERT INTO payment_verification
           (tenant_id, payment_id, verifier_membership_id, decision, verified_amount_minor,
            evidence_note, decided_at, business_key)
         VALUES ($1, $2, $3, 'verified', 12000,
                 'PRIVATE VERIFICATION NOTE - MUST NOT LEAVE THE API',
                 '2026-10-09T02:05:00.000Z', 'rsv011-detail-verification')`,
        [seed.tenantId, ids.payment_id, seed.membershipId],
      );
    });

    const detail = await getReservationDetail(reservationContext(seed), reservationId);
    expect(detail).toMatchObject({
      id: reservationId,
      reference_code: 'RSV-DETAIL-1',
      status: 'picked_up',
      customer: {
        snapshot: {
          full_name: 'Maria Snapshot',
          phone: '09170001111',
          email: 'snapshot@example.test',
        },
      },
      lines: [
        {
          name_snapshot: 'Emerald Gown Snapshot',
          variant: { sku: seed.variantSku, size_label: 'M', color_label: null, image_url: null },
          current_asset_readiness: 'ready',
          measurements_snapshot: { bust: 91.5, waist: 72 },
          pricing_snapshot: { rental_minor: '10000', deposit_minor: '2000', currency: 'PHP' },
        },
      ],
      event_date: '2026-10-11',
      delivery_snapshot: { fulfillment_method: 'pickup' },
      payment: {
        status: 'paid',
        evidence_status: 'verified',
        amount_minor: '12000',
      },
      custody_timeline: [
        {
          event_kind: 'pickup',
          occurred_at: '2026-10-10T02:00:00.000Z',
          condition_note: 'Released in good condition.',
        },
      ],
      version: 4,
    });
    expect(JSON.stringify(detail)).not.toContain('PRIVATE CUSTOMER NOTE');
    expect(JSON.stringify(detail)).not.toContain('PRIVATE VERIFICATION NOTE');
    expect(JSON.stringify(detail)).not.toContain('private/rsv011/payment-proof.png');
  });

  it('keeps accepted customer/clothing snapshots after live edits and conceals foreign tenant or branch ids', async () => {
    const tenantA = await seedWorkspace('org_rsv011_history_a', 'user_rsv011_history_a', [
      'reservations.manage',
    ]);
    const reservationA = await seedReservation(tenantA, {
      referenceCode: 'RSV-HISTORY-A',
      status: 'confirmed',
      pickupAt: '2026-11-10T02:00:00.000Z',
      dueAt: '2026-11-11T02:00:00.000Z',
      lineName: 'Original Accepted Gown Name',
      customer: { fullName: 'Original Customer Name', email: 'original@example.test' },
    });

    await withTenantTransaction(tenantA.tenantId, tenantA.principalId, async (client) => {
      const relation = await client.query<{ customer_id: string; line_id: string; product_id: string }>(
        `SELECT r.customer_id, rl.id AS line_id, pv.product_id
           FROM reservation r
           JOIN reservation_line rl
             ON rl.tenant_id = r.tenant_id
            AND rl.reservation_id = r.id
           JOIN product_variant pv
             ON pv.tenant_id = rl.tenant_id
            AND pv.id = rl.variant_id
          WHERE r.tenant_id = $1
            AND r.id = $2`,
        [tenantA.tenantId, reservationA],
      );
      const relationRow = requireRow(relation.rows, 'historical relation');
      await client.query(
        `UPDATE reservation_line
            SET measurements_snapshot = '{"bust":90,"waist":70}'::jsonb
          WHERE tenant_id = $1
            AND id = $2`,
        [tenantA.tenantId, relationRow.line_id],
      );
      await client.query(
        `UPDATE customer
            SET full_name = 'Edited Live Customer', email = 'edited@example.test'
          WHERE tenant_id = $1
            AND id = $2`,
        [tenantA.tenantId, relationRow.customer_id],
      );
      await client.query(
        `UPDATE product
            SET name = 'Renamed Live Product', status = 'archived'
          WHERE tenant_id = $1
            AND id = $2`,
        [tenantA.tenantId, relationRow.product_id],
      );
      await client.query(
        `UPDATE product_variant
            SET measurements = '{"bust":120,"waist":110}'::jsonb,
                measurement_mode = 'custom',
                status = 'archived'
          WHERE tenant_id = $1
            AND id = $2`,
        [tenantA.tenantId, tenantA.variantId],
      );
    });

    const historical = await getReservationDetail(reservationContext(tenantA), reservationA);
    expect(historical.customer.snapshot).toEqual({
      full_name: 'Original Customer Name',
      phone: null,
      email: 'original@example.test',
      address: null,
    });
    expect(historical.lines[0]).toMatchObject({
      name_snapshot: 'Original Accepted Gown Name',
      measurements_snapshot: { bust: 90, waist: 70 },
    });

    const tenantB = await seedWorkspace('org_rsv011_history_b', 'user_rsv011_history_b', [
      'reservations.manage',
    ]);
    const foreignReservation = await seedReservation(tenantB, {
      referenceCode: 'RSV-FOREIGN-B',
      status: 'confirmed',
      pickupAt: '2026-11-12T02:00:00.000Z',
      dueAt: '2026-11-13T02:00:00.000Z',
      lineName: 'Foreign Tenant Dress',
      customer: { fullName: 'Foreign Customer', email: 'foreign@example.test' },
    });
    await expect(
      getReservationDetail(reservationContext(tenantA), foreignReservation),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const secondBranchId = await withTenantTransaction(
      tenantA.tenantId,
      tenantA.principalId,
      async (client) => {
        const branch = await client.query<{ id: string }>(
          `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
           VALUES ($1, 'Second Branch', 'SECOND-RSV011', false, 'Asia/Manila', 'active')
           RETURNING id`,
          [tenantA.tenantId],
        );
        return requireRow(branch.rows, 'RSV-011 second branch').id;
      },
    );
    const otherBranchReservation = await seedReservation(
      { ...tenantA, branchId: secondBranchId },
      {
        referenceCode: 'RSV-OTHER-BRANCH',
        status: 'confirmed',
        pickupAt: '2026-11-14T02:00:00.000Z',
        dueAt: '2026-11-15T02:00:00.000Z',
        lineName: 'Other Branch Dress',
        customer: { fullName: 'Other Branch Customer', email: 'other-branch@example.test' },
      },
    );
    await expect(
      getReservationDetail(reservationContext(tenantA), otherBranchReservation),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('protects the HTTP detail route and conceals a valid foreign reservation id as not found', async () => {
    clerk.getAuth.mockReturnValueOnce({ userId: null, orgId: null });
    const unauthenticated = await request(createApp()).get(
      '/api/v1/reservations/00000000-0000-4000-8000-000000000001',
    );
    expect(unauthenticated.status).toBe(401);
    expectSafeError(unauthenticated.body, 'UNAUTHENTICATED');

    const denied = await seedWorkspace('org_rsv011_route_denied', 'user_rsv011_route_denied', []);
    const deniedReservation = await seedReservation(denied, {
      referenceCode: 'RSV-DENIED',
      status: 'confirmed',
      pickupAt: '2026-12-10T02:00:00.000Z',
      dueAt: '2026-12-11T02:00:00.000Z',
      lineName: 'Denied Detail Dress',
      customer: { fullName: 'Denied Customer', email: 'denied@example.test' },
    });
    useClerk(denied);
    const forbidden = await request(createApp()).get(`/api/v1/reservations/${deniedReservation}`);
    expect(forbidden.status).toBe(403);
    expectSafeError(forbidden.body, 'FORBIDDEN');

    const allowed = await seedWorkspace('org_rsv011_route_allowed', 'user_rsv011_route_allowed', [
      'reservations.manage',
    ]);
    const allowedReservation = await seedReservation(allowed, {
      referenceCode: 'RSV-DETAIL-ROUTE',
      status: 'confirmed',
      pickupAt: '2026-12-12T02:00:00.000Z',
      dueAt: '2026-12-13T02:00:00.000Z',
      lineName: 'Detail Route Dress',
      customer: { fullName: 'Allowed Customer', email: 'allowed@example.test' },
    });
    useClerk(allowed);
    const success = await request(createApp()).get(`/api/v1/reservations/${allowedReservation}`);
    expect(success.status).toBe(200);
    expect(success.body).toMatchObject({
      success: true,
      data: {
        id: allowedReservation,
        reference_code: 'RSV-DETAIL-ROUTE',
        lines: [{ name_snapshot: 'Detail Route Dress' }],
      },
    });

    useClerk(allowed);
    const invalidId = await request(createApp()).get('/api/v1/reservations/not-a-reservation-id');
    expect(invalidId.status).toBe(422);
    expectSafeError(invalidId.body, 'VALIDATION_FAILED');

    const foreign = await seedWorkspace('org_rsv011_route_foreign', 'user_rsv011_route_foreign', [
      'reservations.manage',
    ]);
    const foreignReservation = await seedReservation(foreign, {
      referenceCode: 'RSV-ROUTE-FOREIGN',
      status: 'confirmed',
      pickupAt: '2026-12-14T02:00:00.000Z',
      dueAt: '2026-12-15T02:00:00.000Z',
      lineName: 'Foreign Detail Dress',
      customer: { fullName: 'Foreign Route Customer', email: 'foreign-route@example.test' },
    });
    useClerk(allowed);
    const concealed = await request(createApp()).get(`/api/v1/reservations/${foreignReservation}`);
    expect(concealed.status).toBe(404);
    expectSafeError(concealed.body, 'NOT_FOUND');
  });

  async function seedWorkspace(
    clerkOrgId: string,
    principalId: string,
    permissions: PermissionCode[],
  ): Promise<WorkspaceSeed> {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, 'frontdesk');

    return withTenantTransaction(tenant.id, principalId, async (client) => {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO branch (tenant_id, name, code, is_default, timezone, status)
         VALUES ($1, 'Main Branch', 'MAIN', true, 'Asia/Manila', 'active')
         RETURNING id`,
        [tenant.id],
      );
      const branchId = requireRow(branch.rows, 'branch').id;
      await client.query(
        `INSERT INTO branch_membership (tenant_id, branch_id, membership_id, permission_codes)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant.id, branchId, membershipId, JSON.stringify(permissions)],
      );

      const plan = await client.query<{ id: string }>(
        `SELECT id FROM plan WHERE code = 'starter' AND version = 1 AND active = true LIMIT 1`,
      );
      const planId = requireRow(plan.rows, 'starter plan').id;
      await client.query(
        `INSERT INTO subscription
           (tenant_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + interval '30 days')`,
        [tenant.id, planId],
      );

      const storefront = await client.query<{ id: string }>(
        `INSERT INTO storefront (tenant_id, branch_id, slug, status, branding, contact)
         VALUES ($1, $2, $3, 'draft', '{}'::jsonb, '{}'::jsonb)
         RETURNING id`,
        [tenant.id, branchId, `rsv010-${tenant.id.slice(0, 8)}`],
      );
      const storefrontId = requireRow(storefront.rows, 'storefront').id;
      const policy = await client.query<{ id: string }>(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules,
            cancellation_rules, delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 'Reservation list policy', now())
         RETURNING id`,
        [tenant.id, storefrontId],
      );
      const policySnapshotId = requireRow(policy.rows, 'policy snapshot').id;

      const paymentMethods = await client.query<{ id: string; rail: 'cash' | 'manual_qr' }>(
        `INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES
           ($1, 'Cash', 'cash', '{}'::jsonb, true, 1),
           ($1, 'GCash', 'manual_qr', '{}'::jsonb, true, 1)
         RETURNING id, rail`,
        [tenant.id],
      );
      const cashPaymentMethodId = paymentMethods.rows.find((row) => row.rail === 'cash')?.id;
      const qrPaymentMethodId = paymentMethods.rows.find((row) => row.rail === 'manual_qr')?.id;
      if (!cashPaymentMethodId || !qrPaymentMethodId) {
        throw new Error('Expected cash and manual QR payment methods.');
      }

      const productCode = `READ-${tenant.id.slice(0, 8)}`;
      const variantSku = `SKU-READ-${tenant.id.slice(0, 8)}`;
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, status)
         VALUES ($1, $2, 'Reservation Read Model Style', 'active')
         RETURNING id`,
        [tenant.id, productCode],
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
        [tenant.id, productId, variantSku],
      );

      return {
        tenantId: tenant.id,
        clerkOrgId: tenant.clerkOrgId,
        principalId,
        membershipId,
        branchId,
        storefrontId,
        policySnapshotId,
        cashPaymentMethodId,
        qrPaymentMethodId,
        productCode,
        variantSku,
        variantId: requireRow(variant.rows, 'variant').id,
      };
    });
  }

  async function seedReservation(seed: WorkspaceSeed, input: SeedReservationInput): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      let customerId: string | null = null;
      let customerSnapshot: Record<string, string | null> | null = null;
      if (input.customer) {
        const customer = await client.query<{ id: string }>(
          `INSERT INTO customer (tenant_id, full_name, email, phone)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [
            seed.tenantId,
            input.customer.fullName,
            input.customer.email ?? null,
            input.customer.phone ?? null,
          ],
        );
        customerId = requireRow(customer.rows, 'customer').id;
        customerSnapshot = {
          full_name: input.customer.fullName,
          phone: input.customer.phone ?? null,
          email: input.customer.email ?? null,
        };
      }

      const paymentMethodId =
        input.payment?.rail === 'manual_qr' ? seed.qrPaymentMethodId : seed.cashPaymentMethodId;
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservation
           (tenant_id, branch_id, customer_id, storefront_id, policy_snapshot_id,
            payment_method_id, reference_code, status, pickup_at, due_at, timezone_snapshot,
            customer_snapshot, delivery_snapshot, price_snapshot, currency, rental_total_minor,
            security_required_minor, due_now_minor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz,
                 'Asia/Manila', $11::jsonb, '{"fulfillment_method":"pickup"}'::jsonb,
                 '{"rental_total_minor":"10000","security_required_minor":"2000","due_now_minor":"12000","currency":"PHP"}'::jsonb,
                 'PHP', 10000, 2000, 12000)
         RETURNING id`,
        [
          seed.tenantId,
          seed.branchId,
          customerId,
          seed.storefrontId,
          seed.policySnapshotId,
          paymentMethodId,
          input.referenceCode,
          input.status,
          input.pickupAt,
          input.dueAt,
          customerSnapshot ? JSON.stringify(customerSnapshot) : null,
        ],
      );
      const reservationId = requireRow(reservation.rows, 'reservation').id;
      await client.query(
        `INSERT INTO reservation_line
           (tenant_id, reservation_id, variant_id, line_number, name_snapshot,
            measurements_snapshot, pricing_snapshot, rental_minor, deposit_minor, currency)
         VALUES ($1, $2, $3, 1, $4, '{}'::jsonb,
                 '{"rental_minor":"10000","deposit_minor":"2000","currency":"PHP"}'::jsonb,
                 10000, 2000, 'PHP')`,
        [seed.tenantId, reservationId, seed.variantId, input.lineName],
      );

      if (input.payment) {
        await client.query(
          `INSERT INTO payment
             (tenant_id, reservation_id, payment_method_id, amount_minor, currency,
              status, verified_at, business_key)
           VALUES ($1, $2, $3, $4, 'PHP', $5,
                   CASE WHEN $5 IN ('partially_paid', 'paid') THEN now() ELSE NULL END,
                   $6)`,
          [
            seed.tenantId,
            reservationId,
            paymentMethodId,
            input.payment.amountMinor,
            input.payment.status,
            `payment-${input.referenceCode}`,
          ],
        );
      }

      return reservationId;
    });
  }

  function reservationContext(seed: WorkspaceSeed) {
    return {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      membershipId: seed.membershipId,
      principalId: seed.principalId,
      permissionCodes: ['reservations.manage'] as PermissionCode[],
      effectiveTenantStatus: 'active' as const,
    };
  }

  function useClerk(seed: Pick<WorkspaceSeed, 'principalId' | 'clerkOrgId'>): void {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
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
    if (!row) throw new Error(`Expected ${label} insert to return one row`);
    return row;
  }
});
