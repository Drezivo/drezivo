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

const REVIEW_PERMISSIONS: PermissionCode[] = [
  'reservations.manage',
  'payments.manage',
  'payments.view',
  'evidence.verify',
  'evidence.view',
];

interface ReviewSeed {
  tenantId: string;
  clerkOrgId: string;
  principalId: string;
  membershipId: string;
  branchId: string;
  storefrontId: string;
  paymentMethodId: string;
  variantId: string;
  assetId: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
  permissions: PermissionCode[];
}

interface HeldReservation {
  id: string;
  version: number;
  paymentId: string;
}

describe('RSV-030/031/032 reservation review and staff completion', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const {
    completeStaffReservation,
    confirmReservation,
    createStaffReservation,
    rejectReservation,
    submitReservation,
  } = await import('../../src/modules/reservations/reservations.service.js');
  const { expireDueHoldsForAllTenants } = await import('../../src/worker/handlers/hold-expirer.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => resetTestDatabase(adminUrl));
  afterAll(async () => closePool());

  it('submits immutable QR evidence before the original hold deadline, extends only to the bounded review deadline, and replays safely', async () => {
    const seed = await seedWorkspace('org_rsv030_submit', 'user_rsv030_submit', 'manual_qr');
    const held = await createHold(seed, 'submit');
    const receiptId = await attachAcceptedReceipt(seed, held, -1);

    const first = await submitReservation(
      reviewContext(seed, 'req-submit-a', 'idem-submit'),
      held.id,
      { version: held.version, terms_accepted: true },
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      success: true,
      data: { reservation: { id: held.id, status: 'pending_confirmation', version: 2 } },
    });

    const state = await reservationReviewState(seed, held.id);
    expect(state.reservation.status).toBe('pending_confirmation');
    expect(state.reservation.terms_accepted_at).not.toBeNull();
    expect(state.reservation.submitted_at).not.toBeNull();
    expect(
      state.reservation.hold_expires_at.getTime() - state.reservation.hold_acquired_at.getTime(),
    ).toBe(24 * 60 * 60 * 1000);
    expect(state.receipt?.id).toBe(receiptId);
    expect(state.receipt?.evidence_status).toBe('under_review');
    expect(state.allocation).toMatchObject({ kind: 'reservation_hold', is_blocking: true });
    expect(state.payment.status).toBe('pending');

    const replay = await submitReservation(
      reviewContext(seed, 'req-submit-b', 'idem-submit'),
      held.id,
      { version: held.version, terms_accepted: true },
    );
    expect(replay).toEqual(first);

    const effects = await actionEffectCounts(seed, held.id, 'reservation.submitted_for_confirmation');
    expect(effects).toEqual({ audit: 1, outbox: 1 });
  });

  it('fails closed when receipt evidence belongs to another payment and when evidence misses the original hold deadline', async () => {
    const seed = await seedWorkspace('org_rsv030_scope', 'user_rsv030_scope', 'manual_qr');
    const held = await createHold(seed, 'scope');

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const unrelatedPayment = await client.query<{ id: string }>(
        `INSERT INTO payment
           (tenant_id, payment_method_id, amount_minor, currency, status, business_key)
         VALUES ($1, $2, 225000, 'PHP', 'pending', 'unrelated-payment')
         RETURNING id`,
        [seed.tenantId, seed.paymentMethodId],
      );
      const unrelatedPaymentId = requireRow(unrelatedPayment.rows, 'unrelated payment').id;
      const fileId = await insertAcceptedReceiptFile(client, seed.tenantId, 'unrelated');
      await client.query(
        `INSERT INTO payment_receipt (tenant_id, payment_id, file_id, evidence_status, submitted_at)
         VALUES ($1, $2, $3, 'uploaded', statement_timestamp())`,
        [seed.tenantId, unrelatedPaymentId, fileId],
      );
    });

    const wrongPayment = await submitReservation(
      reviewContext(seed, 'req-scope-wrong', 'idem-scope-wrong'),
      held.id,
      { version: 1, terms_accepted: true },
    );
    expectFailure(wrongPayment, 'PAYMENT_PREREQUISITE_FAILED');
    expect((await reservationReviewState(seed, held.id)).reservation.status).toBe('held');

    await attachAcceptedReceipt(seed, held, 16);
    const lateEvidence = await submitReservation(
      reviewContext(seed, 'req-scope-late', 'idem-scope-late'),
      held.id,
      { version: 1, terms_accepted: true },
    );
    expectFailure(lateEvidence, 'HOLD_EXPIRED');
    expect((await reservationReviewState(seed, held.id)).reservation.status).toBe('held');
  });

  it('expires exactly at the database-time hold boundary and releases capacity instead of submitting', async () => {
    const seed = await seedWorkspace('org_rsv030_expiry', 'user_rsv030_expiry', 'cash');
    const held = await createHold(seed, 'expiry');
    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `UPDATE reservation
            SET hold_expires_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, held.id],
      ),
    );

    const result = await submitReservation(
      reviewContext(seed, 'req-expiry', 'idem-expiry'),
      held.id,
      { version: 1, terms_accepted: true },
    );
    expectFailure(result, 'HOLD_EXPIRED');

    const state = await reservationReviewState(seed, held.id);
    expect(state.reservation.status).toBe('expired');
    expect(state.reservation.version).toBe(2);
    expect(state.allocation.is_blocking).toBe(false);
    expect(state.allocation.released_at).not.toBeNull();
  });

  it('refuses confirmation from an uploaded screenshot alone, then confirms only after Finance records verified funds and evidence without changing the allocation period', async () => {
    const seed = await seedWorkspace('org_rsv031_confirm', 'user_rsv031_confirm', 'manual_qr');
    const held = await createHold(seed, 'confirm');
    await attachAcceptedReceipt(seed, held, -1);
    const submitted = await submitReservation(
      reviewContext(seed, 'req-confirm-submit', 'idem-confirm-submit'),
      held.id,
      { version: 1, terms_accepted: true },
    );
    expect(submitted.status).toBe(200);

    const before = await reservationReviewState(seed, held.id);
    const screenshotOnly = await confirmReservation(
      reviewContext(seed, 'req-confirm-unverified', 'idem-confirm-unverified'),
      held.id,
      { version: 2 },
    );
    expectFailure(screenshotOnly, 'PAYMENT_PREREQUISITE_FAILED');
    const unchanged = await reservationReviewState(seed, held.id);
    expect(unchanged.reservation.status).toBe('pending_confirmation');
    expect(unchanged.allocation).toMatchObject({ kind: 'reservation_hold', is_blocking: true });

    await verifyMerchantCollection(seed, held, true);
    const confirmed = await confirmReservation(
      reviewContext(seed, 'req-confirm-verified', 'idem-confirm-verified'),
      held.id,
      { version: 2 },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      success: true,
      data: { reservation: { id: held.id, status: 'confirmed', version: 3 } },
    });

    const after = await reservationReviewState(seed, held.id);
    expect(after.allocation.kind).toBe('reservation_confirmed');
    expect(after.allocation.is_blocking).toBe(true);
    expect(after.allocation.blocked_start.toISOString()).toBe(before.allocation.blocked_start.toISOString());
    expect(after.allocation.blocked_end.toISOString()).toBe(before.allocation.blocked_end.toISOString());
    expect(after.allocation.released_at).toBeNull();

    const replay = await confirmReservation(
      reviewContext(seed, 'req-confirm-replay', 'idem-confirm-verified'),
      held.id,
      { version: 2 },
    );
    expect(replay).toEqual(confirmed);
    expect(await actionEffectCounts(seed, held.id, 'reservation.confirmed')).toEqual({ audit: 1, outbox: 1 });
  });

  it('confirms verified cash without requiring a receipt but still requires an immutable merchant verification decision', async () => {
    const seed = await seedWorkspace('org_rsv031_cash', 'user_rsv031_cash', 'cash');
    const held = await createHold(seed, 'cash');
    const submitted = await submitReservation(
      reviewContext(seed, 'req-cash-submit', 'idem-cash-submit'),
      held.id,
      { version: 1, terms_accepted: true },
    );
    expect(submitted.status).toBe(200);

    const beforeVerification = await confirmReservation(
      reviewContext(seed, 'req-cash-before', 'idem-cash-before'),
      held.id,
      { version: 2 },
    );
    expectFailure(beforeVerification, 'PAYMENT_PREREQUISITE_FAILED');

    await verifyMerchantCollection(seed, held, false);
    const confirmed = await confirmReservation(
      reviewContext(seed, 'req-cash-confirm', 'idem-cash-confirm'),
      held.id,
      { version: 2 },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'confirmed' } },
    });
  });

  it('supports a zero-due reservation without fabricating a payment intent or verification requirement', async () => {
    const seed = await seedWorkspace('org_rsv031_zero_due', 'user_rsv031_zero_due', 'cash');
    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `UPDATE product_variant
            SET rental_price_minor = 0,
                security_deposit_minor = 0,
                extra_day_price_minor = 0
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.variantId],
      ),
    );

    const requestBody: StaffReservationCreateRequest = {
      ...createRequest(seed),
      fulfillment_method: 'pickup',
    };
    const created = await createStaffReservation(
      reviewContext(seed, 'req-zero-create', 'idem-zero-create'),
      requestBody,
    );
    expect(created.status).toBe(201);
    if (created.body.success !== true) throw new Error('Expected zero-due reservation creation.');
    const reservation = created.body.data.reservation;
    expect(reservation.price_snapshot.due_now_minor).toBe('0');

    const paymentCount = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM payment
          WHERE tenant_id = $1 AND reservation_id = $2`,
        [seed.tenantId, reservation.id],
      );
      return result.rows[0]?.count ?? -1;
    });
    expect(paymentCount).toBe(0);

    const submitted = await submitReservation(
      reviewContext(seed, 'req-zero-submit', 'idem-zero-submit'),
      reservation.id,
      { version: 1, terms_accepted: true },
    );
    expect(submitted.status).toBe(200);

    const confirmed = await confirmReservation(
      reviewContext(seed, 'req-zero-confirm', 'idem-zero-confirm'),
      reservation.id,
      { version: 2 },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'confirmed', version: 3 } },
    });
  });

  it('completes a customer-less walk-in hold through submit then confirm in one owner-facing action when Finance is already verified', async () => {
    const seed = await seedWorkspace('org_rsv032_owner_fast', 'user_rsv032_owner_fast', 'cash');
    const held = await createWalkInHold(seed, 'owner-fast');
    await verifyMerchantCollection(seed, held, false);

    const completed = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-owner-fast', 'idem-rsv032-owner-fast'),
      held.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Owner Fast Customer'),
      },
    );

    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      success: true,
      data: {
        completion_state: 'confirmed',
        next_action: 'none',
        reservation: { id: held.id, status: 'confirmed', version: 3 },
      },
    });
    const state = await reservationReviewState(seed, held.id);
    expect(state.reservation.status).toBe('confirmed');
    expect(state.allocation).toMatchObject({ kind: 'reservation_confirmed', is_blocking: true });
    expect(await actionEffectCounts(seed, held.id, 'reservation.submitted_for_confirmation')).toEqual({
      audit: 1,
      outbox: 1,
    });
    expect(await actionEffectCounts(seed, held.id, 'reservation.confirmed')).toEqual({ audit: 1, outbox: 1 });
    const customerState = await reservationCustomerState(seed, held.id);
    expect(typeof customerState.customer_id).toBe('string');
    expect(customerState.customer_snapshot).toEqual({
      full_name: 'Owner Fast Customer',
      phone: '09170000032',
      email: null,
    });
  });

  it('stops truthfully at pending confirmation for Front Desk and for an owner whose payment still needs verification', async () => {
    const frontdesk = await seedWorkspace(
      'org_rsv032_frontdesk',
      'user_rsv032_frontdesk',
      'cash',
      ['reservations.manage', 'payments.view', 'evidence.view'],
    );
    const frontdeskHeld = await createWalkInHold(frontdesk, 'frontdesk');
    const frontdeskResult = await completeStaffReservation(
      reviewContext(frontdesk, 'req-rsv032-frontdesk', 'idem-rsv032-frontdesk'),
      frontdeskHeld.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Front Desk Customer'),
      },
    );
    expect(frontdeskResult.status).toBe(200);
    expect(frontdeskResult.body).toMatchObject({
      success: true,
      data: {
        completion_state: 'pending_confirmation',
        next_action: 'merchant_review',
        reservation: { status: 'pending_confirmation', version: 2 },
      },
    });
    expect(await actionEffectCounts(frontdesk, frontdeskHeld.id, 'reservation.confirmed')).toEqual({
      audit: 0,
      outbox: 0,
    });

    const frontdeskReplay = await completeStaffReservation(
      reviewContext(frontdesk, 'req-rsv032-frontdesk-replay', 'idem-rsv032-frontdesk'),
      frontdeskHeld.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Front Desk Customer'),
      },
    );
    expect(frontdeskReplay.body).toMatchObject({
      success: true,
      data: { completion_state: 'pending_confirmation', reservation: { version: 2 } },
    });
    await expect(
      completeStaffReservation(
        reviewContext(frontdesk, 'req-rsv032-frontdesk-reused', 'idem-rsv032-frontdesk'),
        frontdeskHeld.id,
        {
          version: 1,
          terms_accepted: true,
          customer: walkInCustomer('Different Customer'),
        },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await actionEffectCounts(frontdesk, frontdeskHeld.id, 'reservation.submitted_for_confirmation')).toEqual({
      audit: 1,
      outbox: 1,
    });

    const owner = await seedWorkspace('org_rsv032_payment', 'user_rsv032_payment', 'cash');
    const ownerHeld = await createWalkInHold(owner, 'payment');
    const ownerResult = await completeStaffReservation(
      reviewContext(owner, 'req-rsv032-payment', 'idem-rsv032-payment'),
      ownerHeld.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Payment Pending Customer'),
      },
    );
    expect(ownerResult.status).toBe(200);
    expect(ownerResult.body).toMatchObject({
      success: true,
      data: {
        completion_state: 'pending_confirmation',
        next_action: 'payment_verification',
        reservation: { status: 'pending_confirmation', version: 2 },
      },
    });
    expect(await actionEffectCounts(owner, ownerHeld.id, 'reservation.confirmed')).toEqual({
      audit: 0,
      outbox: 0,
    });
  });

  it('never auto-confirms a manual QR screenshot through the staff completion action', async () => {
    const seed = await seedWorkspace('org_rsv032_qr', 'user_rsv032_qr', 'manual_qr');
    const held = await createWalkInHold(seed, 'qr');
    await attachAcceptedReceipt(seed, held, -1);

    const result = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-qr', 'idem-rsv032-qr'),
      held.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('QR Screenshot Customer'),
      },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      data: {
        completion_state: 'pending_confirmation',
        next_action: 'payment_verification',
        reservation: { status: 'pending_confirmation', version: 2 },
      },
    });
    const state = await reservationReviewState(seed, held.id);
    expect(state.receipt?.evidence_status).toBe('under_review');
    expect(state.reservation.status).toBe('pending_confirmation');
    expect(await actionEffectCounts(seed, held.id, 'reservation.confirmed')).toEqual({ audit: 0, outbox: 0 });
  });

  it('resumes from authoritative pending confirmation without re-submitting after payment verification', async () => {
    const seed = await seedWorkspace('org_rsv032_resume', 'user_rsv032_resume', 'cash');
    const held = await createWalkInHold(seed, 'resume');
    const first = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-resume-a', 'idem-rsv032-resume-a'),
      held.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Resume Customer'),
      },
    );
    expect(first.body).toMatchObject({
      success: true,
      data: { completion_state: 'pending_confirmation', next_action: 'payment_verification' },
    });

    await verifyMerchantCollection(seed, held, false);
    const resumed = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-resume-b', 'idem-rsv032-resume-b'),
      held.id,
      { version: 2, terms_accepted: true },
    );
    expect(resumed.body).toMatchObject({
      success: true,
      data: { completion_state: 'confirmed', next_action: 'none', reservation: { version: 3 } },
    });
    expect(await actionEffectCounts(seed, held.id, 'reservation.submitted_for_confirmation')).toEqual({
      audit: 1,
      outbox: 1,
    });
    expect(await actionEffectCounts(seed, held.id, 'reservation.confirmed')).toEqual({ audit: 1, outbox: 1 });
  });

  it('expires during staff completion using database time and releases the held garment', async () => {
    const seed = await seedWorkspace('org_rsv032_expiry', 'user_rsv032_expiry', 'cash');
    const held = await createWalkInHold(seed, 'completion-expiry');
    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `UPDATE reservation SET hold_expires_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, held.id],
      ),
    );

    const result = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-expiry', 'idem-rsv032-expiry'),
      held.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Expired Walk-in'),
      },
    );
    expectFailure(result, 'HOLD_EXPIRED');
    const state = await reservationReviewState(seed, held.id);
    expect(state.reservation.status).toBe('expired');
    expect(state.allocation.is_blocking).toBe(false);
    expect((await reservationCustomerState(seed, held.id)).customer_id).toBeNull();
  });

  it('double-fires the owner completion intent without duplicating submit or confirm effects', async () => {
    const seed = await seedWorkspace('org_rsv032_double', 'user_rsv032_double', 'cash');
    const held = await createWalkInHold(seed, 'double');
    await verifyMerchantCollection(seed, held, false);
    const completion = {
      version: 1,
      terms_accepted: true as const,
      customer: walkInCustomer('Double Fire Customer'),
    };

    const [first, second] = await Promise.all([
      completeStaffReservation(
        reviewContext(seed, 'req-rsv032-double-a', 'idem-rsv032-double'),
        held.id,
        completion,
      ),
      completeStaffReservation(
        reviewContext(seed, 'req-rsv032-double-b', 'idem-rsv032-double'),
        held.id,
        completion,
      ),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toMatchObject({ success: true, data: { completion_state: 'confirmed' } });
    expect(second.body).toMatchObject({ success: true, data: { completion_state: 'confirmed' } });
    expect(await actionEffectCounts(seed, held.id, 'reservation.submitted_for_confirmation')).toEqual({
      audit: 1,
      outbox: 1,
    });
    expect(await actionEffectCounts(seed, held.id, 'reservation.confirmed')).toEqual({ audit: 1, outbox: 1 });
  });

  it('rejects a pending reservation once, releases its allocation, and keeps the auditable merchant reason', async () => {
    const seed = await seedWorkspace('org_rsv031_reject', 'user_rsv031_reject', 'cash');
    const held = await createHold(seed, 'reject');
    await submitReservation(
      reviewContext(seed, 'req-reject-submit', 'idem-reject-submit'),
      held.id,
      { version: 1, terms_accepted: true },
    );

    const first = await rejectReservation(
      reviewContext(seed, 'req-reject-a', 'idem-reject'),
      held.id,
      { version: 2, reason: 'Merchant could not verify the collection.' },
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'rejected', version: 3 } },
    });

    const state = await reservationReviewState(seed, held.id);
    expect(state.allocation.is_blocking).toBe(false);
    expect(state.allocation.released_at).not.toBeNull();
    expect(state.auditReason).toBe('Merchant could not verify the collection.');

    const replay = await rejectReservation(
      reviewContext(seed, 'req-reject-b', 'idem-reject'),
      held.id,
      { version: 2, reason: 'Merchant could not verify the collection.' },
    );
    expect(replay).toEqual(first);
    expect(await actionEffectCounts(seed, held.id, 'reservation.rejected')).toEqual({ audit: 1, outbox: 1 });
  });

  it('serializes concurrent confirmation double-fire and confirmation-vs-expiry to one durable outcome', async () => {
    const seed = await seedWorkspace('org_rsv031_races', 'user_rsv031_races', 'cash');
    const held = await createHold(seed, 'races');
    await submitReservation(
      reviewContext(seed, 'req-race-submit', 'idem-race-submit'),
      held.id,
      { version: 1, terms_accepted: true },
    );
    await verifyMerchantCollection(seed, held, false);

    const concurrent = await Promise.all([
      confirmReservation(reviewContext(seed, 'req-double-a', 'idem-double-confirm'), held.id, { version: 2 }),
      confirmReservation(reviewContext(seed, 'req-double-b', 'idem-double-confirm'), held.id, { version: 2 }),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0]?.status).toBe(200);
    expect(await actionEffectCounts(seed, held.id, 'reservation.confirmed')).toEqual({ audit: 1, outbox: 1 });

    const expirySeed = await seedWorkspace('org_rsv031_expiry_race', 'user_rsv031_expiry_race', 'cash');
    const expiryHeld = await createHold(expirySeed, 'expiry-race');
    await submitReservation(
      reviewContext(expirySeed, 'req-expiry-submit', 'idem-expiry-submit'),
      expiryHeld.id,
      { version: 1, terms_accepted: true },
    );
    await verifyMerchantCollection(expirySeed, expiryHeld, false);
    await withTenantTransaction(expirySeed.tenantId, expirySeed.principalId, (client) =>
      client.query(
        `UPDATE reservation SET hold_expires_at = statement_timestamp() - interval '1 second'
          WHERE tenant_id = $1 AND id = $2`,
        [expirySeed.tenantId, expiryHeld.id],
      ),
    );

    const [confirmation] = await Promise.all([
      confirmReservation(
        reviewContext(expirySeed, 'req-expiry-confirm', 'idem-expiry-confirm'),
        expiryHeld.id,
        { version: 2 },
      ),
      expireDueHoldsForAllTenants(),
    ]);
    expectFailure(confirmation, 'HOLD_EXPIRED');
    const expired = await reservationReviewState(expirySeed, expiryHeld.id);
    expect(expired.reservation.status).toBe('expired');
    expect(expired.allocation.is_blocking).toBe(false);
    expect(await actionEffectCounts(expirySeed, expiryHeld.id, 'reservation.expired')).toEqual({
      audit: 1,
      outbox: 1,
    });
  });

  it('exposes the staff complete-booking route without requiring Front Desk to hold merchant verification permission', async () => {
    const seed = await seedWorkspace(
      'org_rsv032_route',
      'user_rsv032_route',
      'cash',
      ['reservations.manage', 'payments.view', 'evidence.view'],
    );
    const held = await createWalkInHold(seed, 'route');

    clerk.getAuth.mockReturnValueOnce({ userId: null, orgId: null });
    const unauthenticated = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/complete-booking`)
      .set('Idempotency-Key', 'route-rsv032-unauth')
      .send({
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Route Customer'),
      });
    expect(unauthenticated.status).toBe(401);

    const foreign = await seedWorkspace(
      'org_rsv032_route_foreign',
      'user_rsv032_route_foreign',
      'cash',
      ['reservations.manage', 'payments.view', 'evidence.view'],
    );
    const foreignHeld = await createWalkInHold(foreign, 'route-foreign');
    useClerk(seed);
    const concealed = await request(createApp())
      .post(`/api/v1/reservations/${foreignHeld.id}/complete-booking`)
      .set('Idempotency-Key', 'route-rsv032-foreign')
      .send({
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Foreign Route Customer'),
      });
    expect(concealed.status).toBe(404);

    useClerk(seed);
    const injected = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/complete-booking`)
      .set('Idempotency-Key', 'route-rsv032-injected')
      .send({
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Route Customer'),
        status: 'confirmed',
      });
    expect(injected.status).toBe(422);

    useClerk(seed);
    const missingKey = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/complete-booking`)
      .send({
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Route Customer'),
      });
    expect(missingKey.status).toBe(422);

    useClerk(seed);
    const completed = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/complete-booking`)
      .set('Idempotency-Key', 'route-rsv032-complete')
      .send({
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Route Customer'),
      });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      success: true,
      data: {
        completion_state: 'pending_confirmation',
        next_action: 'merchant_review',
        reservation: { id: held.id, status: 'pending_confirmation', version: 2 },
      },
    });
  });

  it('exposes protected submit/confirm/reject routes with strict bodies, idempotency, concealed foreign IDs, and merchant-review permissions', async () => {
    const seed = await seedWorkspace('org_rsv03_routes', 'user_rsv03_routes', 'cash');
    const held = await createHold(seed, 'routes');

    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const unauthenticated = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/submit`)
      .set('Idempotency-Key', 'route-unauth')
      .send({ version: 1, terms_accepted: true });
    expect(unauthenticated.status).toBe(401);

    useClerk(seed);
    const missingKey = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/submit`)
      .send({ version: 1, terms_accepted: true });
    expect(missingKey.status).toBe(422);

    useClerk(seed);
    const injected = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/submit`)
      .set('Idempotency-Key', 'route-injected')
      .send({ version: 1, terms_accepted: true, status: 'confirmed' });
    expect(injected.status).toBe(422);

    useClerk(seed);
    const submitted = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/submit`)
      .set('Idempotency-Key', 'route-submit')
      .send({ version: 1, terms_accepted: true });
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({ success: true, data: { reservation: { status: 'pending_confirmation' } } });

    await verifyMerchantCollection(seed, held, false);
    useClerk(seed);
    const confirmed = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/confirm`)
      .set('Idempotency-Key', 'route-confirm')
      .send({ version: 2 });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'confirmed', version: 3 } },
    });

    useClerk(seed);
    const confirmReplay = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/confirm`)
      .set('Idempotency-Key', 'route-confirm')
      .send({ version: 2 });
    expect(confirmReplay.status).toBe(200);
    expect(confirmReplay.body).toEqual(confirmed.body);

    useClerk(seed);
    const confirmKeyReuse = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/confirm`)
      .set('Idempotency-Key', 'route-confirm')
      .send({ version: 3 });
    expect(confirmKeyReuse.status).toBe(409);
    expect((confirmKeyReuse.body as { error?: { code?: string } }).error?.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const rejectSeed = await seedWorkspace('org_rsv03_route_reject', 'user_rsv03_route_reject', 'cash');
    const rejectHeld = await createHold(rejectSeed, 'route-reject');
    await submitReservation(
      reviewContext(rejectSeed, 'req-route-reject-submit', 'idem-route-reject-submit'),
      rejectHeld.id,
      { version: 1, terms_accepted: true },
    );
    useClerk(rejectSeed);
    const rejected = await request(createApp())
      .post(`/api/v1/reservations/${rejectHeld.id}/reject`)
      .set('Idempotency-Key', 'route-reject')
      .send({ version: 2, reason: 'Merchant rejected this reservation.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'rejected', version: 3 } },
    });

    const frontdesk = await seedWorkspace(
      'org_rsv03_frontdesk',
      'user_rsv03_frontdesk',
      'cash',
      ['reservations.manage', 'payments.view', 'evidence.view'],
    );
    const frontdeskHeld = await createHold(frontdesk, 'frontdesk');
    await submitReservation(
      reviewContext(frontdesk, 'req-frontdesk-submit', 'idem-frontdesk-submit'),
      frontdeskHeld.id,
      { version: 1, terms_accepted: true },
    );
    useClerk(frontdesk);
    const forbiddenConfirm = await request(createApp())
      .post(`/api/v1/reservations/${frontdeskHeld.id}/confirm`)
      .set('Idempotency-Key', 'route-forbidden-confirm')
      .send({ version: 2 });
    expect(forbiddenConfirm.status).toBe(403);

    const foreign = await seedWorkspace('org_rsv03_foreign', 'user_rsv03_foreign', 'cash');
    useClerk(seed);
    const concealed = await request(createApp())
      .post(`/api/v1/reservations/${(await createHold(foreign, 'foreign')).id}/reject`)
      .set('Idempotency-Key', 'route-foreign')
      .send({ version: 1, reason: 'No disclosure.' });
    expect(concealed.status).toBe(404);
  });

  async function seedWorkspace(
    clerkOrgId: string,
    principalId: string,
    rail: ReviewSeed['rail'],
    permissions: PermissionCode[] = REVIEW_PERMISSIONS,
  ): Promise<ReviewSeed> {
    const tenant = await createTestTenant({ clerkOrgId });
    const membershipId = await createTestMembership(tenant.id, principalId, permissions.includes('payments.manage') ? 'owner' : 'frontdesk');
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
        `SELECT id FROM plan WHERE code = 'starter' AND version = 1 AND active = true LIMIT 1`,
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
        [tenant.id, branchId, `rsv03-${tenant.id.slice(0, 8)}`],
      );
      const storefrontId = requireRow(storefront.rows, 'storefront').id;
      await client.query(
        `INSERT INTO policy_snapshot
           (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
            delivery_rules, privacy_notice, effective_at)
         VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                 '{"enabled":true,"fee_minor":"25000"}'::jsonb,
                 'Reservation review privacy notice', statement_timestamp() - interval '1 minute')`,
        [tenant.id, storefrontId],
      );
      const paymentMethod = await client.query<{ id: string }>(
        `INSERT INTO payment_method
           (tenant_id, name, rail, destination_snapshot, active, version)
         VALUES ($1, $2, $3, '{"instructions":"Merchant instructions"}'::jsonb, true, 1)
         RETURNING id`,
        [tenant.id, rail === 'cash' ? 'Cash' : 'Merchant QR', rail],
      );
      const paymentMethodId = requireRow(paymentMethod.rows, 'payment method').id;
      const product = await client.query<{ id: string }>(
        `INSERT INTO product (tenant_id, code, name, description, status)
         VALUES ($1, 'RSV03-GOWN', 'RSV-03 Review Gown', 'Review test garment', 'active') RETURNING id`,
        [tenant.id],
      );
      const productId = requireRow(product.rows, 'product').id;
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variant
           (tenant_id, product_id, sku, size_label, color_label, measurement_mode,
            measurement_unit, measurements, rental_price_minor, security_deposit_minor,
            currency, pricing_mode, included_duration_minutes, extra_day_price_minor,
            prep_minutes, turnaround_minutes, status)
         VALUES ($1, $2, 'RSV03-M', 'M', 'Emerald', 'custom', 'cm',
                 '{"bust":91.5,"waist":72}'::jsonb, 150000, 50000, 'PHP',
                 'fixed_duration', 4320, 40000, 60, 1440, 'active') RETURNING id`,
        [tenant.id, productId],
      );
      const variantId = requireRow(variant.rows, 'variant').id;
      const asset = await client.query<{ id: string }>(
        `INSERT INTO physical_asset
           (tenant_id, branch_id, variant_id, asset_code, lifecycle_status, readiness, custody_kind)
         VALUES ($1, $2, $3, 'RSV03-ASSET-1', 'active', 'ready', 'at_branch') RETURNING id`,
        [tenant.id, branchId, variantId],
      );
      return {
        tenantId: tenant.id,
        clerkOrgId: tenant.clerkOrgId,
        principalId,
        membershipId,
        branchId,
        storefrontId,
        paymentMethodId,
        variantId,
        assetId: requireRow(asset.rows, 'asset').id,
        rail,
        permissions,
      };
    });
  }

  async function createWalkInHold(seed: ReviewSeed, suffix: string): Promise<HeldReservation> {
    const requestBody = createRequest(seed);
    const result = await createStaffReservation(
      reviewContext(seed, `req-create-walkin-${suffix}`, `idem-create-walkin-${suffix}`),
      {
        variant_id: requestBody.variant_id,
        requested_interval: requestBody.requested_interval,
        ...(requestBody.event_date ? { event_date: requestBody.event_date } : {}),
        fulfillment_method: requestBody.fulfillment_method,
        payment_method_id: requestBody.payment_method_id,
      },
    );
    if (result.status !== 201 || result.body.success !== true) {
      throw new Error(`Expected customer-less held reservation creation, got ${result.status}.`);
    }
    const reservation = result.body.data.reservation;
    const paymentId = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const payment = await client.query<{ id: string }>(
        `SELECT id FROM payment WHERE tenant_id = $1 AND reservation_id = $2
          AND business_key = ('reservation:' || $2::text || ':initial-payment')`,
        [seed.tenantId, reservation.id],
      );
      return requireRow(payment.rows, 'initial walk-in payment').id;
    });
    return { id: reservation.id, version: reservation.version, paymentId };
  }

  async function createHold(seed: ReviewSeed, suffix: string): Promise<HeldReservation> {
    const result = await createStaffReservation(
      reviewContext(seed, `req-create-${suffix}`, `idem-create-${suffix}`),
      createRequest(seed),
    );
    if (result.status !== 201 || result.body.success !== true) {
      throw new Error(`Expected held reservation creation, got ${result.status}.`);
    }
    const reservation = result.body.data.reservation;
    const paymentId = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const payment = await client.query<{ id: string }>(
        `SELECT id FROM payment WHERE tenant_id = $1 AND reservation_id = $2
          AND business_key = ('reservation:' || $2::text || ':initial-payment')`,
        [seed.tenantId, reservation.id],
      );
      return requireRow(payment.rows, 'initial payment').id;
    });
    return { id: reservation.id, version: reservation.version, paymentId };
  }

  function walkInCustomer(fullName: string) {
    return {
      source: 'new' as const,
      customer: {
        full_name: fullName,
        phone: '09170000032',
      },
    };
  }

  function createRequest(seed: ReviewSeed): StaffReservationCreateRequest {
    return {
      customer: {
        source: 'new',
        customer: {
          full_name: 'Review Customer',
          phone: '09171234567',
          email: 'review@example.test',
        },
      },
      variant_id: seed.variantId as ProductVariantId,
      requested_interval: {
        start: '2026-10-10T02:00:00.000Z',
        end: '2026-10-12T04:00:00.000Z',
      },
      event_date: '2026-10-11',
      fulfillment_method: 'delivery',
      payment_method_id: seed.paymentMethodId as PaymentMethodId,
    };
  }

  function reviewContext(seed: ReviewSeed, requestId: string, idempotencyKey: string) {
    return {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      membershipId: seed.membershipId,
      principalId: seed.principalId,
      permissionCodes: seed.permissions,
      effectiveTenantStatus: 'active' as const,
      requestId,
      idempotencyKey,
    };
  }

  async function attachAcceptedReceipt(
    seed: ReviewSeed,
    held: HeldReservation,
    submittedOffsetMinutes: number,
  ): Promise<string> {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const fileId = await insertAcceptedReceiptFile(client, seed.tenantId, held.id);
      const receipt = await client.query<{ id: string }>(
        `INSERT INTO payment_receipt
           (tenant_id, payment_id, file_id, evidence_status, submitted_at)
         VALUES ($1, $2, $3, 'uploaded',
                 statement_timestamp() + ($4::integer * interval '1 minute'))
         RETURNING id`,
        [seed.tenantId, held.paymentId, fileId, submittedOffsetMinutes],
      );
      return requireRow(receipt.rows, 'receipt').id;
    });
  }

  async function insertAcceptedReceiptFile(
    client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
    tenantId: string,
    suffix: string,
  ): Promise<string> {
    const file = await client.query(
      `INSERT INTO file_object
         (tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
          lifecycle_status, is_private, upload_expires_at, frozen_at)
       VALUES ($1, 'payment_receipt', $2, 'version-1', $3, 'image/png', 128,
               'accepted', true, statement_timestamp() + interval '1 hour', statement_timestamp())
       RETURNING id`,
      [tenantId, `tests/rsv03/${suffix}`, 'a'.repeat(64)],
    );
    return requireRow(file.rows, 'receipt file').id;
  }

  async function verifyMerchantCollection(
    seed: ReviewSeed,
    held: HeldReservation,
    verifyReceipt: boolean,
  ): Promise<void> {
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const payment = await client.query<{ amount_minor: number }>(
        `UPDATE payment
            SET status = 'paid', verified_at = statement_timestamp(), merchant_reference = $3
          WHERE tenant_id = $1 AND id = $2
          RETURNING amount_minor`,
        [seed.tenantId, held.paymentId, `merchant-ref-${held.id}`],
      );
      const amount = requireRow(payment.rows, 'verified payment').amount_minor;
      await client.query(
        `INSERT INTO payment_verification
           (tenant_id, payment_id, verifier_membership_id, decision,
            verified_amount_minor, evidence_note, business_key)
         VALUES ($1, $2, $3, 'verified', $4, 'Verified against merchant collection.', $5)`,
        [seed.tenantId, held.paymentId, seed.membershipId, amount, `verify:${held.paymentId}`],
      );
      if (verifyReceipt) {
        await client.query(
          `UPDATE payment_receipt SET evidence_status = 'verified'
            WHERE tenant_id = $1 AND payment_id = $2 AND evidence_status = 'under_review'`,
          [seed.tenantId, held.paymentId],
        );
      }
    });
  }

  async function reservationCustomerState(seed: ReviewSeed, reservationId: string) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{
        customer_id: string | null;
        customer_snapshot: Record<string, unknown> | null;
      }>(
        `SELECT customer_id, customer_snapshot
           FROM reservation
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, reservationId],
      );
      return requireRow(result.rows, 'reservation customer state');
    });
  }

  async function reservationReviewState(seed: ReviewSeed, reservationId: string) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservation = await client.query<{
        status: string;
        version: number;
        hold_acquired_at: Date;
        hold_expires_at: Date;
        terms_accepted_at: Date | null;
        submitted_at: Date | null;
      }>(
        `SELECT status, version, hold_acquired_at, hold_expires_at, terms_accepted_at, submitted_at
           FROM reservation WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, reservationId],
      );
      const payment = await client.query<{ status: string }>(
        `SELECT status FROM payment WHERE tenant_id = $1 AND reservation_id = $2
          ORDER BY created_at, id LIMIT 1`,
        [seed.tenantId, reservationId],
      );
      const receipt = await client.query<{ id: string; evidence_status: string }>(
        `SELECT pr.id, pr.evidence_status
           FROM payment_receipt pr
           JOIN payment p ON p.tenant_id = pr.tenant_id AND p.id = pr.payment_id
          WHERE pr.tenant_id = $1 AND p.reservation_id = $2
          ORDER BY pr.submitted_at DESC, pr.id DESC LIMIT 1`,
        [seed.tenantId, reservationId],
      );
      const allocation = await client.query<{
        kind: string;
        is_blocking: boolean;
        released_at: Date | null;
        blocked_start: Date;
        blocked_end: Date;
      }>(
        `SELECT aa.kind, aa.is_blocking, aa.released_at,
                lower(aa.period) AS blocked_start, upper(aa.period) AS blocked_end
           FROM asset_allocation aa
           JOIN reservation_line rl ON rl.tenant_id = aa.tenant_id AND rl.id = aa.reservation_line_id
          WHERE aa.tenant_id = $1 AND rl.reservation_id = $2
          ORDER BY aa.created_at, aa.id LIMIT 1`,
        [seed.tenantId, reservationId],
      );
      const rejectionAudit = await client.query<{ merchant_reason: string | null }>(
        `SELECT redacted_summary ->> 'merchant_reason' AS merchant_reason
           FROM audit_event
          WHERE tenant_id = $1 AND entity_id = $2 AND action = 'reservation.rejected'
          ORDER BY occurred_at DESC LIMIT 1`,
        [seed.tenantId, reservationId],
      );
      return {
        reservation: requireRow(reservation.rows, 'reservation state'),
        payment: requireRow(payment.rows, 'payment state'),
        receipt: receipt.rows[0] ?? null,
        allocation: requireRow(allocation.rows, 'allocation state'),
        auditReason: rejectionAudit.rows[0]?.merchant_reason ?? null,
      };
    });
  }

  async function actionEffectCounts(seed: ReviewSeed, reservationId: string, action: string) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const audit = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_event
          WHERE tenant_id = $1 AND entity_id = $2 AND action = $3`,
        [seed.tenantId, reservationId, action],
      );
      const outbox = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM outbox_event
          WHERE tenant_id = $1 AND payload ->> 'reservationId' = $2
            AND event_type = $3`,
        [
          seed.tenantId,
          reservationId,
          action === 'reservation.submitted_for_confirmation'
            ? 'reservation.pending_confirmation'
            : action === 'reservation.expired'
              ? 'reservation.hold_expired'
              : action,
        ],
      );
      return { audit: audit.rows[0]?.count ?? 0, outbox: outbox.rows[0]?.count ?? 0 };
    });
  }

  function useClerk(seed: Pick<ReviewSeed, 'principalId' | 'clerkOrgId'>): void {
    clerk.getAuth.mockReturnValue({ userId: seed.principalId, orgId: seed.clerkOrgId });
  }

  function expectFailure(result: { status: number; body: unknown }, code: string): void {
    expect(result.status).toBe(409);
    const body = result.body as { success?: boolean; error?: { code?: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe(code);
  }

  function requireRow<T>(rows: T[], label: string): T {
    const row = rows[0];
    if (!row) throw new Error(`Expected ${label} to return one row.`);
    return row;
  }
});
