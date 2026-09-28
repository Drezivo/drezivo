import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CustomerId,
  FileObjectId,
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
  'assets.manage',
  'reservations.manage',
  'reservations.custody',
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

describe('RSV-030/031/032/041/050 reservation lifecycle commands', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const {
    attachReservationReceipt,
    cancelReservation,
    completeStaffReservation,
    confirmReservation,
    createStaffReservation,
    getReservationDetail,
    pickupReservation,
    rejectReservation,
    returnReservation,
    inspectReturnedReservation,
    completeRentalReservation,
    submitReservation,
    verifyReservationPayment,
  } = await import('../../src/modules/reservations/reservations.service.js');
  const { submitReservationForConfirmation } = await import(
    '../../src/modules/reservations/reservations.review.service.js'
  );
  const { expireDueHoldsForAllTenants } = await import('../../src/worker/handlers/hold-expirer.js');
  const { promoteElapsedRecoveryReadinessForAllTenants } = await import(
    '../../src/worker/handlers/recovery-readiness.js'
  );
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

  it('never shortens the original 15-minute garment hold when pickup is sooner than the review window', async () => {
    const seed = await seedWorkspace('org_rsv030_short_pickup', 'user_rsv030_short_pickup', 'cash');
    const held = await createHold(seed, 'short-pickup');

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `UPDATE reservation
            SET pickup_at = hold_acquired_at + interval '5 minutes'
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, held.id],
      ),
    );

    const submitted = await submitReservation(
      reviewContext(seed, 'req-short-pickup', 'idem-short-pickup'),
      held.id,
      { version: held.version, terms_accepted: true },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({
      success: true,
      data: { reservation: { id: held.id, status: 'pending_confirmation' } },
    });

    const state = await reservationReviewState(seed, held.id);
    expect(
      state.reservation.hold_expires_at.getTime() - state.reservation.hold_acquired_at.getTime(),
    ).toBe(15 * 60 * 1000);
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

    const wrongPayment = await submitReservationForConfirmation(
      reviewContext(seed, 'req-scope-wrong', 'idem-scope-wrong'),
      held.id,
      { version: 1, terms_accepted: true },
    );
    expectFailure(wrongPayment, 'PAYMENT_PREREQUISITE_FAILED');
    expect((await reservationReviewState(seed, held.id)).reservation.status).toBe('held');

    await attachAcceptedReceipt(seed, held, 16);
    const lateEvidence = await submitReservationForConfirmation(
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
      address: '123 Review Street, Quezon City',
    });
  });

  it('requires an inline address to repair a held pre-change snapshot, then persists it atomically', async () => {
    const seed = await seedWorkspace('org_rsv_address_legacy', 'user_rsv_address_legacy', 'cash');
    const held = await createHold(seed, 'address-legacy');
    const customer = await reservationCustomerState(seed, held.id);
    expect(customer.customer_id).not.toBeNull();

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `UPDATE reservation
            SET customer_snapshot = customer_snapshot - 'address'
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, held.id],
      );
      await client.query(
        `UPDATE customer
            SET address = NULL
          WHERE tenant_id = $1 AND id = $2::uuid`,
        [seed.tenantId, customer.customer_id],
      );
    });

    const missing = await submitReservationForConfirmation(
      reviewContext(seed, 'req-address-legacy-missing', 'idem-address-legacy-missing'),
      held.id,
      { version: held.version, terms_accepted: true },
    );
    expectFailure(missing, 'VALIDATION_FAILED');

    const submitted = await submitReservationForConfirmation(
      reviewContext(seed, 'req-address-legacy', 'idem-address-legacy'),
      held.id,
      {
        version: held.version,
        terms_accepted: true,
        customer: {
          source: 'existing',
          customer_id: customer.customer_id as CustomerId,
          address: '456 Legacy Address Avenue, Quezon City',
        },
      },
    );
    expect(submitted.status).toBe(200);

    const repaired = await reservationCustomerState(seed, held.id);
    expect(repaired.customer_snapshot).toMatchObject({
      address: '456 Legacy Address Avenue, Quezon City',
    });
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const profile = await client.query<{ address: string | null }>(
        `SELECT address FROM customer WHERE tenant_id = $1 AND id = $2::uuid`,
        [seed.tenantId, customer.customer_id],
      );
      expect(requireRow(profile.rows, 'legacy customer').address).toBe(
        '456 Legacy Address Avenue, Quezon City',
      );
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

  it('keeps the strict/default manual-payment submission path receipt-required', async () => {
    const seed = await seedWorkspace('org_rsv032_qr_strict', 'user_rsv032_qr_strict', 'manual_qr');
    const held = await createWalkInHold(seed, 'qr-strict');

    const result = await submitReservationForConfirmation(
      reviewContext(seed, 'req-rsv032-qr-strict', 'idem-rsv032-qr-strict'),
      held.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Strict QR Customer'),
      },
    );

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      success: false,
      error: { code: 'PAYMENT_PREREQUISITE_FAILED' },
    });
    const state = await reservationReviewState(seed, held.id);
    expect(state.reservation.status).toBe('held');
    expect(state.receipt).toBeNull();
  });

  it('lets staff submit, manually verify, and confirm manual QR without uploading a receipt', async () => {
    const seed = await seedWorkspace('org_rsv032_qr_manual', 'user_rsv032_qr_manual', 'manual_qr');
    const held = await createWalkInHold(seed, 'qr-manual');

    const submitted = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-qr-manual-submit', 'idem-rsv032-qr-manual-submit'),
      held.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Manual QR Customer'),
      },
    );
    expect(submitted.body).toMatchObject({
      success: true,
      data: {
        completion_state: 'pending_confirmation',
        next_action: 'payment_verification',
        reservation: { status: 'pending_confirmation', version: 2 },
      },
    });

    const amountMinor = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const payment = await client.query<{ amount_minor: number }>(
        `SELECT amount_minor FROM payment WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, held.paymentId],
      );
      return String(requireRow(payment.rows, 'manual QR payment').amount_minor);
    });
    const verified = await verifyReservationPayment(
      reviewContext(seed, 'req-rsv032-qr-manual-verify', 'idem-rsv032-qr-manual-verify'),
      held.id,
      {
        version: 2,
        verified_amount_minor: amountMinor,
        merchant_reference: 'GCASH-IN-PERSON',
      },
    );
    expect(verified.body).toMatchObject({
      success: true,
      data: { payment_status: 'paid', verified_amount_minor: amountMinor },
    });

    const confirmed = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-qr-manual-confirm', 'idem-rsv032-qr-manual-confirm'),
      held.id,
      { version: 2, terms_accepted: true },
    );
    expect(confirmed.body).toMatchObject({
      success: true,
      data: { completion_state: 'confirmed', next_action: 'none' },
    });
    const state = await reservationReviewState(seed, held.id);
    expect(state.reservation.status).toBe('confirmed');
    expect(state.payment.status).toBe('paid');
    expect(state.receipt).toBeNull();
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

  it('records cash collection and confirms a walk-in reservation in one staff completion action', async () => {
    const seed = await seedWorkspace('org_rsv032_cash_direct', 'user_rsv032_cash_direct', 'cash');
    const held = await createWalkInHold(seed, 'cash-direct');
    const amountMinor = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const payment = await client.query<{ amount_minor: number }>(
        `SELECT amount_minor FROM payment WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, held.paymentId],
      );
      return String(requireRow(payment.rows, 'cash direct payment').amount_minor);
    });

    const tenderedMinor = String(BigInt(amountMinor) + 20_000n);
    const result = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-cash-direct', 'idem-rsv032-cash-direct'),
      held.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Cash Walk-in Customer'),
        cash_collection: { amount_tendered_minor: tenderedMinor },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      data: {
        completion_state: 'confirmed',
        next_action: 'none',
        reservation: { status: 'confirmed', version: 3 },
      },
    });
    const financial = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const payment = await client.query<{ status: string; verified_at: Date | null }>(
        `SELECT status, verified_at FROM payment WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, held.paymentId],
      );
      const verification = await client.query<{
        decision: string;
        verified_amount_minor: number | null;
        cash_tendered_minor: number | null;
        change_due_minor: number | null;
      }>(
        `SELECT decision, verified_amount_minor, cash_tendered_minor, change_due_minor
           FROM payment_verification
          WHERE tenant_id = $1 AND payment_id = $2
          ORDER BY decided_at DESC, id DESC LIMIT 1`,
        [seed.tenantId, held.paymentId],
      );
      return {
        payment: requireRow(payment.rows, 'cash verified payment'),
        verification: requireRow(verification.rows, 'cash payment verification'),
      };
    });
    expect(financial.payment.status).toBe('paid');
    expect(financial.payment.verified_at).not.toBeNull();
    expect(financial.verification).toMatchObject({
      decision: 'verified',
      verified_amount_minor: Number(amountMinor),
      cash_tendered_minor: Number(tenderedMinor),
      change_due_minor: 20_000,
    });
  });

  it('attaches and verifies manual QR evidence before confirming the reservation', async () => {
    const seed = await seedWorkspace('org_rsv032_qr_verify', 'user_rsv032_qr_verify', 'manual_qr');
    const held = await createWalkInHold(seed, 'qr-verify');
    const fileId = await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      insertAcceptedReceiptFile(client, seed.tenantId, `manual-${held.id}`),
    );
    const attached = await attachReservationReceipt(
      reviewContext(seed, 'req-rsv032-qr-attach', 'idem-rsv032-qr-attach'),
      held.id,
      { file_id: fileId as FileObjectId },
    );
    expect(attached.body).toMatchObject({
      success: true,
      data: { payment_id: held.paymentId, evidence_status: 'uploaded' },
    });

    const submitted = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-qr-submit', 'idem-rsv032-qr-submit'),
      held.id,
      {
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Verified QR Customer'),
      },
    );
    expect(submitted.body).toMatchObject({
      success: true,
      data: { completion_state: 'pending_confirmation', next_action: 'payment_verification' },
    });

    const amountMinor = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const payment = await client.query<{ amount_minor: number }>(
        `SELECT amount_minor FROM payment WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, held.paymentId],
      );
      return String(requireRow(payment.rows, 'manual QR payment').amount_minor);
    });
    const verified = await verifyReservationPayment(
      reviewContext(seed, 'req-rsv032-qr-verify', 'idem-rsv032-qr-verify'),
      held.id,
      {
        version: 2,
        verified_amount_minor: amountMinor,
        merchant_reference: 'GCASH-TEST-REF',
      },
    );
    expect(verified.body).toMatchObject({
      success: true,
      data: { payment_status: 'paid', verified_amount_minor: amountMinor },
    });

    const confirmed = await completeStaffReservation(
      reviewContext(seed, 'req-rsv032-qr-confirm', 'idem-rsv032-qr-confirm'),
      held.id,
      { version: 2, terms_accepted: true },
    );
    expect(confirmed.body).toMatchObject({
      success: true,
      data: { completion_state: 'confirmed', next_action: 'none' },
    });
    const state = await reservationReviewState(seed, held.id);
    expect(state.reservation.status).toBe('confirmed');
    expect(state.payment.status).toBe('paid');
    expect(state.receipt?.evidence_status).toBe('verified');
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
      .set('Idempotency-Key', 'route-rsv032-foreign') // gitleaks:allow
      .send({
        version: 1,
        terms_accepted: true,
        customer: walkInCustomer('Foreign Route Customer'),
      });
    expect(concealed.status).toBe(404);

    useClerk(seed);
    const injected = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/complete-booking`)
      .set('Idempotency-Key', 'route-rsv032-injected') // gitleaks:allow
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

  it('cancels held, pending-confirmation, and confirmed staff reservations while preserving payment history', async () => {
    const heldSeed = await seedWorkspace('org_rsv041_held', 'user_rsv041_held', 'cash');
    const held = await createHold(heldSeed, 'cancel-held');
    const heldResult = await cancelReservation(
      reviewContext(heldSeed, 'req-cancel-held', 'idem-cancel-held'),
      held.id,
      { version: 1, reason: 'Walk-in customer changed their mind.' },
    );
    expect(heldResult.status).toBe(200);
    expect(heldResult.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'cancelled', version: 2 } },
    });
    const heldState = await reservationReviewState(heldSeed, held.id);
    expect(heldState.allocation.is_blocking).toBe(false);
    expect(heldState.payment.status).toBe('pending');

    const pendingSeed = await seedWorkspace('org_rsv041_pending', 'user_rsv041_pending', 'cash');
    const pending = await createHold(pendingSeed, 'cancel-pending');
    await submitReservation(
      reviewContext(pendingSeed, 'req-cancel-pending-submit', 'idem-cancel-pending-submit'),
      pending.id,
      { version: 1, terms_accepted: true },
    );
    const pendingResult = await cancelReservation(
      reviewContext(pendingSeed, 'req-cancel-pending', 'idem-cancel-pending'),
      pending.id,
      { version: 2 },
    );
    expect(pendingResult.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'cancelled', version: 3 } },
    });
    expect((await reservationReviewState(pendingSeed, pending.id)).allocation.is_blocking).toBe(false);

    const confirmedSeed = await seedWorkspace('org_rsv041_confirmed', 'user_rsv041_confirmed', 'cash');
    const confirmed = await createHold(confirmedSeed, 'cancel-confirmed');
    await submitReservation(
      reviewContext(confirmedSeed, 'req-cancel-confirmed-submit', 'idem-cancel-confirmed-submit'),
      confirmed.id,
      { version: 1, terms_accepted: true },
    );
    await verifyMerchantCollection(confirmedSeed, confirmed, false);
    await confirmReservation(
      reviewContext(confirmedSeed, 'req-cancel-confirmed-confirm', 'idem-cancel-confirmed-confirm'),
      confirmed.id,
      { version: 2 },
    );
    const confirmedResult = await cancelReservation(
      reviewContext(confirmedSeed, 'req-cancel-confirmed', 'idem-cancel-confirmed'),
      confirmed.id,
      { version: 3, reason: 'Customer requested cancellation through the store.' },
    );
    expect(confirmedResult.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'cancelled', version: 4 } },
    });
    const confirmedState = await reservationReviewState(confirmedSeed, confirmed.id);
    expect(confirmedState.allocation.is_blocking).toBe(false);
    expect(confirmedState.payment.status).toBe('paid');
    expect(await cancellationAudit(confirmedSeed, confirmed.id)).toMatchObject({
      previous_status: 'confirmed',
      payment_status: 'paid',
      financial_followup_required: true,
    });
  });

  it('keeps staff cancellation idempotent, rejects post-pickup cancellation, and lets expiry win at the deadline', async () => {
    const duplicateSeed = await seedWorkspace('org_rsv041_duplicate', 'user_rsv041_duplicate', 'cash');
    const duplicate = await createHold(duplicateSeed, 'cancel-duplicate');
    const concurrent = await Promise.all([
      cancelReservation(
        reviewContext(duplicateSeed, 'req-cancel-dup-a', 'idem-cancel-duplicate'),
        duplicate.id,
        { version: 1, reason: 'Changed mind.' },
      ),
      cancelReservation(
        reviewContext(duplicateSeed, 'req-cancel-dup-b', 'idem-cancel-duplicate'),
        duplicate.id,
        { version: 1, reason: 'Changed mind.' },
      ),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0]?.status).toBe(200);
    expect(await actionEffectCounts(duplicateSeed, duplicate.id, 'reservation.cancelled')).toEqual({
      audit: 1,
      outbox: 1,
    });

    const pickupSeed = await seedWorkspace('org_rsv041_pickup', 'user_rsv041_pickup', 'cash');
    const pickup = await createHold(pickupSeed, 'cancel-pickup');
    await withTenantTransaction(pickupSeed.tenantId, pickupSeed.principalId, (client) =>
      client.query(
        `UPDATE reservation SET status = 'picked_up', version = 4
          WHERE tenant_id = $1 AND id = $2`,
        [pickupSeed.tenantId, pickup.id],
      ),
    );
    const pickedUpResult = await cancelReservation(
      reviewContext(pickupSeed, 'req-cancel-picked-up', 'idem-cancel-picked-up'),
      pickup.id,
      { version: 4 },
    );
    expectFailure(pickedUpResult, 'INVALID_RESERVATION_TRANSITION');
    expect((await reservationReviewState(pickupSeed, pickup.id)).allocation.is_blocking).toBe(true);

    const expirySeed = await seedWorkspace('org_rsv041_expiry', 'user_rsv041_expiry', 'cash');
    const expiring = await createHold(expirySeed, 'cancel-expiry');
    await withTenantTransaction(expirySeed.tenantId, expirySeed.principalId, (client) =>
      client.query(
        `UPDATE reservation SET hold_expires_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2`,
        [expirySeed.tenantId, expiring.id],
      ),
    );
    const expired = await cancelReservation(
      reviewContext(expirySeed, 'req-cancel-expired', 'idem-cancel-expired'),
      expiring.id,
      { version: 1 },
    );
    expectFailure(expired, 'HOLD_EXPIRED');
    const expiredState = await reservationReviewState(expirySeed, expiring.id);
    expect(expiredState.reservation.status).toBe('expired');
    expect(expiredState.allocation.is_blocking).toBe(false);
  });

  it('exposes staff-only cancellation with strict auth, permission, body, idempotency, and tenant concealment', async () => {
    const seed = await seedWorkspace('org_rsv041_route', 'user_rsv041_route', 'cash');
    const held = await createHold(seed, 'cancel-route');

    const publicCancellation = await request(createApp())
      .post(`/api/v1/public/stores/test-store/reservations/${held.id}/cancel`)
      .send({ version: 1 });
    expect(publicCancellation.status).toBe(404);

    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const unauthenticated = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/cancel`)
      .set('Idempotency-Key', 'route-cancel-unauth')
      .send({ version: 1 });
    expect(unauthenticated.status).toBe(401);

    useClerk(seed);
    const missingKey = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/cancel`)
      .send({ version: 1 });
    expect(missingKey.status).toBe(422);

    useClerk(seed);
    const injected = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/cancel`)
      .set('Idempotency-Key', 'route-cancel-injected')
      .send({ version: 1, refund_amount_minor: 50000 });
    expect(injected.status).toBe(422);

    useClerk(seed);
    const cancelled = await request(createApp())
      .post(`/api/v1/reservations/${held.id}/cancel`)
      .set('Idempotency-Key', 'route-cancel-success')
      .send({ version: 1, reason: 'Customer contacted the shop to cancel.' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'cancelled' } },
    });

    const foreign = await seedWorkspace('org_rsv041_foreign', 'user_rsv041_foreign', 'cash');
    const foreignHeld = await createHold(foreign, 'cancel-foreign');
    useClerk(seed);
    const concealed = await request(createApp())
      .post(`/api/v1/reservations/${foreignHeld.id}/cancel`)
      .set('Idempotency-Key', 'route-cancel-foreign')
      .send({ version: 1 });
    expect(concealed.status).toBe(404);
  });

  it('picks up a confirmed reservation once, moves physical custody to the customer, and preserves the confirmed allocation', async () => {
    const seed = await seedWorkspace('org_rsv050_pickup', 'user_rsv050_pickup', 'cash');
    const confirmed = await createConfirmedReservation(seed, 'pickup-success');

    const first = await pickupReservation(
      reviewContext(seed, 'req-pickup-first', 'idem-pickup-success'),
      confirmed.id,
      { version: confirmed.version, condition_note: 'Clean and complete at handover.' },
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      success: true,
      data: { reservation: { id: confirmed.id, status: 'picked_up', version: 4 } },
    });

    const state = await pickupState(seed, confirmed.id);
    expect(state.reservation_status).toBe('picked_up');
    expect(state.asset).toMatchObject({
      lifecycle_status: 'active',
      readiness: 'ready',
      custody_kind: 'with_customer',
    });
    expect(state.allocation).toMatchObject({
      kind: 'reservation_confirmed',
      is_blocking: true,
      released_at: null,
    });
    expect(state.custodyEvents).toHaveLength(1);
    expect(state.custodyEvents[0]).toMatchObject({
      event_kind: 'pickup',
      condition_note: 'Clean and complete at handover.',
      actor_membership_id: seed.membershipId,
    });
    const detail = await getReservationDetail(reviewContext(seed, 'unused-detail', 'unused-detail'), confirmed.id);
    expect(detail.status).toBe('picked_up');
    expect(detail.custody_timeline).toEqual([
      expect.objectContaining({
        event_kind: 'pickup',
        asset_id: seed.assetId,
        condition_note: 'Clean and complete at handover.',
      }),
    ]);

    const replay = await pickupReservation(
      reviewContext(seed, 'req-pickup-replay', 'idem-pickup-success'),
      confirmed.id,
      { version: confirmed.version, condition_note: 'Clean and complete at handover.' },
    );
    expect(replay).toEqual(first);
    expect(await actionEffectCounts(seed, confirmed.id, 'reservation.picked_up')).toEqual({
      audit: 1,
      outbox: 1,
    });
  });

  it('allows pickup after staff manually verifies a manual payment without uploaded receipt evidence', async () => {
    const seed = await seedWorkspace('org_rsv050_manual_pickup', 'user_rsv050_manual_pickup', 'manual_qr');
    const held = await createHold(seed, 'pickup-manual-no-receipt');
    const submitted = await submitReservation(
      reviewContext(seed, 'req-pickup-manual-submit', 'idem-pickup-manual-submit'),
      held.id,
      { version: 1, terms_accepted: true },
    );
    if (submitted.status !== 200 || submitted.body.success !== true) {
      throw new Error('Expected manual-payment reservation submission to succeed.');
    }

    await verifyMerchantCollection(seed, held, false);
    const confirmed = await confirmReservation(
      reviewContext(seed, 'req-pickup-manual-confirm', 'idem-pickup-manual-confirm'),
      held.id,
      { version: submitted.body.data.reservation.version },
    );
    if (confirmed.status !== 200 || confirmed.body.success !== true) {
      throw new Error('Expected manually verified reservation confirmation to succeed.');
    }

    const pickedUp = await pickupReservation(
      reviewContext(seed, 'req-pickup-manual', 'idem-pickup-manual'),
      held.id,
      { version: confirmed.body.data.reservation.version },
    );

    expect(pickedUp.status).toBe(200);
    expect(pickedUp.body).toMatchObject({
      success: true,
      data: { reservation: { id: held.id, status: 'picked_up' } },
    });
    const state = await pickupState(seed, held.id);
    expect(state.reservation_status).toBe('picked_up');
    expect(state.asset.custody_kind).toBe('with_customer');
  });

  it('blocks pickup when the garment is unready or payment truth no longer satisfies handover prerequisites', async () => {
    const unreadySeed = await seedWorkspace('org_rsv050_unready', 'user_rsv050_unready', 'cash');
    const unready = await createConfirmedReservation(unreadySeed, 'pickup-unready');
    await withTenantTransaction(unreadySeed.tenantId, unreadySeed.principalId, (client) =>
      client.query(
        `UPDATE physical_asset
            SET readiness = 'needs_cleaning', version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [unreadySeed.tenantId, unreadySeed.assetId],
      ),
    );
    const unreadyResult = await pickupReservation(
      reviewContext(unreadySeed, 'req-pickup-unready', 'idem-pickup-unready'),
      unready.id,
      { version: unready.version },
    );
    expectFailure(unreadyResult, 'ASSET_UNREADY');
    const unreadyState = await pickupState(unreadySeed, unready.id);
    expect(unreadyState.reservation_status).toBe('confirmed');
    expect(unreadyState.asset.custody_kind).toBe('at_branch');
    expect(unreadyState.custodyEvents).toHaveLength(0);

    const absentSeed = await seedWorkspace('org_rsv050_absent', 'user_rsv050_absent', 'cash');
    const absent = await createConfirmedReservation(absentSeed, 'pickup-absent');
    await withTenantTransaction(absentSeed.tenantId, absentSeed.principalId, (client) =>
      client.query(
        `UPDATE physical_asset
            SET custody_kind = 'in_transit', version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [absentSeed.tenantId, absentSeed.assetId],
      ),
    );
    const absentResult = await pickupReservation(
      reviewContext(absentSeed, 'req-pickup-absent', 'idem-pickup-absent'),
      absent.id,
      { version: absent.version },
    );
    expectFailure(absentResult, 'ASSET_UNREADY');
    const absentState = await pickupState(absentSeed, absent.id);
    expect(absentState.reservation_status).toBe('confirmed');
    expect(absentState.asset.custody_kind).toBe('in_transit');
    expect(absentState.custodyEvents).toHaveLength(0);

    const paymentSeed = await seedWorkspace('org_rsv050_payment', 'user_rsv050_payment', 'cash');
    const payment = await createConfirmedReservation(paymentSeed, 'pickup-payment');
    await withTenantTransaction(paymentSeed.tenantId, paymentSeed.principalId, (client) =>
      client.query(
        `UPDATE payment SET status = 'refunded'
          WHERE tenant_id = $1 AND id = $2`,
        [paymentSeed.tenantId, payment.paymentId],
      ),
    );
    const paymentResult = await pickupReservation(
      reviewContext(paymentSeed, 'req-pickup-payment', 'idem-pickup-payment'),
      payment.id,
      { version: payment.version },
    );
    expectFailure(paymentResult, 'PAYMENT_PREREQUISITE_FAILED');
    const paymentState = await pickupState(paymentSeed, payment.id);
    expect(paymentState.reservation_status).toBe('confirmed');
    expect(paymentState.asset.custody_kind).toBe('at_branch');
    expect(paymentState.custodyEvents).toHaveLength(0);
  });

  it('serializes pickup double-fire to one custody event and one lifecycle effect', async () => {
    const seed = await seedWorkspace('org_rsv050_race', 'user_rsv050_race', 'cash');
    const confirmed = await createConfirmedReservation(seed, 'pickup-race');

    const concurrent = await Promise.all([
      pickupReservation(
        reviewContext(seed, 'req-pickup-race-a', 'idem-pickup-race'),
        confirmed.id,
        { version: confirmed.version, condition_note: 'Handover condition recorded.' },
      ),
      pickupReservation(
        reviewContext(seed, 'req-pickup-race-b', 'idem-pickup-race'),
        confirmed.id,
        { version: confirmed.version, condition_note: 'Handover condition recorded.' },
      ),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0]?.status).toBe(200);
    expect((await pickupState(seed, confirmed.id)).custodyEvents).toHaveLength(1);
    expect(await actionEffectCounts(seed, confirmed.id, 'reservation.picked_up')).toEqual({
      audit: 1,
      outbox: 1,
    });
  });

  it('exposes pickup only to authenticated staff with reservation custody permission and a strict idempotent body', async () => {
    const seed = await seedWorkspace('org_rsv050_route', 'user_rsv050_route', 'cash');
    const confirmed = await createConfirmedReservation(seed, 'pickup-route');

    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const unauthenticated = await request(createApp())
      .post(`/api/v1/reservations/${confirmed.id}/pickup`)
      .set('Idempotency-Key', 'route-pickup-unauth')
      .send({ version: confirmed.version });
    expect(unauthenticated.status).toBe(401);

    useClerk(seed);
    const missingKey = await request(createApp())
      .post(`/api/v1/reservations/${confirmed.id}/pickup`)
      .send({ version: confirmed.version });
    expect(missingKey.status).toBe(422);

    useClerk(seed);
    const injected = await request(createApp())
      .post(`/api/v1/reservations/${confirmed.id}/pickup`)
      .set('Idempotency-Key', 'route-pickup-injected')
      .send({ version: confirmed.version, asset_id: seed.assetId });
    expect(injected.status).toBe(422);

    const noCustody = await seedWorkspace(
      'org_rsv050_no_custody',
      'user_rsv050_no_custody',
      'cash',
      ['reservations.manage', 'payments.manage', 'payments.view', 'evidence.verify', 'evidence.view'],
    );
    const noCustodyConfirmed = await createConfirmedReservation(noCustody, 'pickup-no-custody');
    useClerk(noCustody);
    const forbidden = await request(createApp())
      .post(`/api/v1/reservations/${noCustodyConfirmed.id}/pickup`)
      .set('Idempotency-Key', 'route-pickup-forbidden')
      .send({ version: noCustodyConfirmed.version });
    expect(forbidden.status).toBe(403);

    const foreign = await seedWorkspace('org_rsv050_foreign', 'user_rsv050_foreign', 'cash');
    const foreignConfirmed = await createConfirmedReservation(foreign, 'pickup-foreign');
    useClerk(seed);
    const concealed = await request(createApp())
      .post(`/api/v1/reservations/${foreignConfirmed.id}/pickup`)
      .set('Idempotency-Key', 'route-pickup-foreign')
      .send({ version: foreignConfirmed.version });
    expect(concealed.status).toBe(404);

    useClerk(seed);
    const pickedUp = await request(createApp())
      .post(`/api/v1/reservations/${confirmed.id}/pickup`)
      .set('Idempotency-Key', 'route-pickup-success')
      .send({ version: confirmed.version, condition_note: 'Released to customer.' });
    expect(pickedUp.status).toBe(200);
    expect(pickedUp.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'picked_up', version: 4 } },
    });
  });

  it('returns a picked-up reservation once, starts Recovery-managed cleaning, and keeps the booking block', async () => {
    const seed = await seedWorkspace('org_rsv051_return', 'user_rsv051_return', 'cash');
    const pickedUp = await createPickedUpReservation(seed, 'return-success');

    const first = await returnReservation(
      reviewContext(seed, 'req-return-first', 'idem-return-success'),
      pickedUp.id,
      { version: pickedUp.version, condition_note: 'Returned with a small stain near the hem.' },
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      success: true,
      data: { reservation: { id: pickedUp.id, status: 'returned', version: 5 } },
    });

    const state = await pickupState(seed, pickedUp.id);
    expect(state.reservation_status).toBe('returned');
    expect(state.asset).toMatchObject({
      custody_kind: 'at_branch',
      readiness: 'needs_cleaning',
      recovery_managed_readiness: true,
    });
    expect(state.allocation).toMatchObject({
      kind: 'reservation_confirmed',
      is_blocking: true,
      released_at: null,
    });
    expect(state.custodyEvents).toEqual([
      expect.objectContaining({ event_kind: 'pickup' }),
      expect.objectContaining({
        event_kind: 'return',
        condition_note: 'Returned with a small stain near the hem.',
        actor_membership_id: seed.membershipId,
      }),
    ]);

    const detail = await getReservationDetail(reviewContext(seed, 'return-detail', 'return-detail'), pickedUp.id);
    expect(detail.status).toBe('returned');
    expect(detail.custody_timeline).toEqual([
      expect.objectContaining({ event_kind: 'pickup', asset_id: seed.assetId }),
      expect.objectContaining({
        event_kind: 'return',
        asset_id: seed.assetId,
        condition_note: 'Returned with a small stain near the hem.',
      }),
    ]);

    const replay = await returnReservation(
      reviewContext(seed, 'req-return-replay', 'idem-return-success'),
      pickedUp.id,
      { version: pickedUp.version, condition_note: 'Returned with a small stain near the hem.' },
    );
    expect(replay).toEqual(first);
    expect(await actionEffectCounts(seed, pickedUp.id, 'reservation.returned')).toEqual({
      audit: 1,
      outbox: 1,
    });
  });

  it('records physical return even when finance changed after pickup and preserves a more specific non-ready garment state', async () => {
    const seed = await seedWorkspace('org_rsv051_truth', 'user_rsv051_truth', 'cash');
    const pickedUp = await createPickedUpReservation(seed, 'return-truth');
    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `UPDATE payment SET status = 'refunded'
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, pickedUp.paymentId],
      );
      await client.query(
        `UPDATE physical_asset
            SET readiness = 'needs_repair', version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.assetId],
      );
    });

    const returned = await returnReservation(
      reviewContext(seed, 'req-return-finance-changed', 'idem-return-finance-changed'),
      pickedUp.id,
      { version: pickedUp.version, condition_note: 'Customer reported zipper damage.' },
    );
    expect(returned.status).toBe(200);
    expect(returned.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'returned' } },
    });
    const state = await pickupState(seed, pickedUp.id);
    expect(state.asset).toMatchObject({ custody_kind: 'at_branch', readiness: 'needs_repair' });
    expect(state.custodyEvents).toHaveLength(2);
  });

  it('records a late return and links the return custody fact to an already-threatened future reservation', async () => {
    const seed = await seedWorkspace('org_rsv051_late', 'user_rsv051_late', 'cash');
    const pickedUp = await createPickedUpReservation(seed, 'return-late-current');
    const future = await createHoldForInterval(
      seed,
      'return-late-future',
      '2026-10-20T02:00:00.000Z',
      '2026-10-23T02:00:00.000Z',
    );

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `UPDATE reservation
            SET pickup_at = statement_timestamp() - interval '3 days',
                due_at = statement_timestamp() - interval '2 hours'
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, pickedUp.id],
      );
      await client.query(
        `UPDATE asset_allocation aa
            SET period = tstzrange(statement_timestamp() - interval '3 days',
                                   statement_timestamp() - interval '1 hour', '[)')
           FROM reservation_line rl
          WHERE aa.tenant_id = $1
            AND rl.tenant_id = aa.tenant_id
            AND rl.id = aa.reservation_line_id
            AND rl.reservation_id = $2`,
        [seed.tenantId, pickedUp.id],
      );
      await client.query(
        `UPDATE asset_allocation aa
            SET period = tstzrange(statement_timestamp() - interval '30 minutes',
                                   statement_timestamp() + interval '2 days', '[)')
           FROM reservation_line rl
          WHERE aa.tenant_id = $1
            AND rl.tenant_id = aa.tenant_id
            AND rl.id = aa.reservation_line_id
            AND rl.reservation_id = $2`,
        [seed.tenantId, future.id],
      );
    });

    const returned = await returnReservation(
      reviewContext(seed, 'req-return-late', 'idem-return-late'),
      pickedUp.id,
      { version: pickedUp.version, condition_note: 'Returned after the next prep window had started.' },
    );
    expect(returned.status).toBe(200);
    expect(returned.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'returned' } },
    });

    const disruption = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{
        status: string;
        reservation_id: string;
        cause_event_kind: string | null;
      }>(
        `SELECT d.status,
                rl.reservation_id,
                ce.event_kind AS cause_event_kind
           FROM disruption d
           JOIN reservation_line rl
             ON rl.tenant_id = d.tenant_id
            AND rl.id = d.reservation_line_id
           LEFT JOIN custody_event ce
             ON ce.tenant_id = d.tenant_id
            AND ce.id = d.cause_custody_event_id
          WHERE d.tenant_id = $1 AND d.asset_id = $2
          ORDER BY d.created_at DESC
          LIMIT 1`,
        [seed.tenantId, seed.assetId],
      );
      return requireRow(result.rows, 'late return disruption');
    });
    expect(disruption).toEqual({
      status: 'open',
      reservation_id: future.id,
      cause_event_kind: 'return',
    });
  });

  it('serializes Return double-fire to one return custody event and one lifecycle effect', async () => {
    const seed = await seedWorkspace('org_rsv051_race', 'user_rsv051_race', 'cash');
    const pickedUp = await createPickedUpReservation(seed, 'return-race');

    const concurrent = await Promise.all([
      returnReservation(
        reviewContext(seed, 'req-return-race-a', 'idem-return-race'),
        pickedUp.id,
        { version: pickedUp.version, condition_note: 'Returned at counter.' },
      ),
      returnReservation(
        reviewContext(seed, 'req-return-race-b', 'idem-return-race'),
        pickedUp.id,
        { version: pickedUp.version, condition_note: 'Returned at counter.' },
      ),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0]?.status).toBe(200);
    const state = await pickupState(seed, pickedUp.id);
    expect(state.custodyEvents.filter((event) => event.event_kind === 'return')).toHaveLength(1);
    expect(await actionEffectCounts(seed, pickedUp.id, 'reservation.returned')).toEqual({
      audit: 1,
      outbox: 1,
    });
  });

  it('exposes Return only to authenticated staff with custody permission and a strict idempotent body', async () => {
    const seed = await seedWorkspace('org_rsv051_route', 'user_rsv051_route', 'cash');
    const pickedUp = await createPickedUpReservation(seed, 'return-route');

    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const unauthenticated = await request(createApp())
      .post(`/api/v1/reservations/${pickedUp.id}/return`)
      .set('Idempotency-Key', 'route-return-unauth')
      .send({ version: pickedUp.version });
    expect(unauthenticated.status).toBe(401);

    useClerk(seed);
    const missingKey = await request(createApp())
      .post(`/api/v1/reservations/${pickedUp.id}/return`)
      .send({ version: pickedUp.version });
    expect(missingKey.status).toBe(422);

    useClerk(seed);
    const injected = await request(createApp())
      .post(`/api/v1/reservations/${pickedUp.id}/return`)
      .set('Idempotency-Key', 'route-return-injected')
      .send({ version: pickedUp.version, readiness: 'ready' });
    expect(injected.status).toBe(422);

    const noCustody = await seedWorkspace('org_rsv051_no_custody', 'user_rsv051_no_custody', 'cash');
    const noCustodyPickedUp = await createPickedUpReservation(noCustody, 'return-no-custody');
    await withTenantTransaction(noCustody.tenantId, noCustody.principalId, (client) =>
      client.query(
        `UPDATE branch_membership
            SET permission_codes = $4::jsonb
          WHERE tenant_id = $1 AND branch_id = $2 AND membership_id = $3`,
        [
          noCustody.tenantId,
          noCustody.branchId,
          noCustody.membershipId,
          JSON.stringify(noCustody.permissions.filter((permission) => permission !== 'reservations.custody')),
        ],
      ),
    );
    useClerk(noCustody);
    const forbidden = await request(createApp())
      .post(`/api/v1/reservations/${noCustodyPickedUp.id}/return`)
      .set('Idempotency-Key', 'route-return-forbidden')
      .send({ version: noCustodyPickedUp.version });
    expect(forbidden.status).toBe(403);

    const foreign = await seedWorkspace('org_rsv051_foreign', 'user_rsv051_foreign', 'cash');
    const foreignPickedUp = await createPickedUpReservation(foreign, 'return-foreign');
    useClerk(seed);
    const concealed = await request(createApp())
      .post(`/api/v1/reservations/${foreignPickedUp.id}/return`)
      .set('Idempotency-Key', 'route-return-foreign')
      .send({ version: foreignPickedUp.version });
    expect(concealed.status).toBe(404);

    useClerk(seed);
    const returned = await request(createApp())
      .post(`/api/v1/reservations/${pickedUp.id}/return`)
      .set('Idempotency-Key', 'route-return-success')
      .send({ version: pickedUp.version, condition_note: 'Return received by staff.' });
    expect(returned.status).toBe(200);
    expect(returned.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'returned', version: 5 } },
    });
  });

  it('records post-return inspection separately and completes only after the garment is ready', async () => {
    const seed = await seedWorkspace('org_rsv052_inspect', 'user_rsv052_inspect', 'cash');
    const returned = await createReturnedReservation(seed, 'completion-inspect');

    const cleaning = await inspectReturnedReservation(
      reviewContext(seed, 'req-inspect-cleaning', 'idem-inspect-cleaning'),
      returned.id,
      { version: returned.version, readiness: 'needs_cleaning', condition_note: 'Normal cleaning required.' },
    );
    expect(cleaning.status).toBe(200);
    expect(cleaning.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'returned', version: returned.version }, asset_readiness: 'needs_cleaning' },
    });
    expect((await pickupState(seed, returned.id)).allocation).toMatchObject({
      is_blocking: true,
      released_at: null,
    });

    const blocked = await completeRentalReservation(
      reviewContext(seed, 'req-complete-unready', 'idem-complete-unready'),
      returned.id,
      { version: returned.version },
    );
    expectFailure(blocked, 'ASSET_UNREADY');

    const ready = await inspectReturnedReservation(
      reviewContext(seed, 'req-inspect-ready', 'idem-inspect-ready'),
      returned.id,
      { version: returned.version, readiness: 'ready', condition_note: 'Cleaning complete; garment inspected.' },
    );
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ success: true, data: { asset_readiness: 'ready' } });
    const readyState = await pickupState(seed, returned.id);
    expect(readyState.asset).toMatchObject({
      readiness: 'ready',
      recovery_managed_readiness: false,
    });
    const recoveryTailReleased = await withTenantTransaction(
      seed.tenantId,
      seed.principalId,
      async (client) => {
        const result = await client.query<{ released: boolean }>(
          `SELECT upper(aa.period) <= GREATEST(r.due_at, statement_timestamp()) AS released
             FROM asset_allocation aa
             JOIN reservation_line rl
               ON rl.tenant_id = aa.tenant_id AND rl.id = aa.reservation_line_id
             JOIN reservation r
               ON r.tenant_id = rl.tenant_id AND r.id = rl.reservation_id
            WHERE aa.tenant_id = $1 AND r.id = $2::uuid
            LIMIT 1`,
          [seed.tenantId, returned.id],
        );
        return requireRow(result.rows, 'ready recovery tail').released;
      },
    );
    expect(recoveryTailReleased).toBe(true);

    const completed = await completeRentalReservation(
      reviewContext(seed, 'req-complete-success', 'idem-complete-success'),
      returned.id,
      { version: returned.version },
    );
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'completed', version: returned.version + 1 } },
    });
    const state = await pickupState(seed, returned.id);
    expect(state.asset).toMatchObject({ custody_kind: 'at_branch', readiness: 'ready' });
    expect(state.allocation).toMatchObject({ is_blocking: false });
    expect(state.allocation.released_at).not.toBeNull();
    expect(await actionEffectCounts(seed, returned.id, 'reservation.completed')).toEqual({
      audit: 1,
      outbox: 1,
    });
  });

  it('treats elapsed normal Recovery cleaning as ready even if the cleanup worker has not reconciled yet', async () => {
    const seed = await seedWorkspace('org_rsv052_recovery_due', 'user_rsv052_recovery_due', 'cash');
    const returned = await createReturnedReservation(seed, 'completion-recovery-due');

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `UPDATE reservation
            SET pickup_at = statement_timestamp() - interval '3 days',
                due_at = statement_timestamp() - interval '2 days'
          WHERE tenant_id = $1 AND id = $2::uuid`,
        [seed.tenantId, returned.id],
      );
      await client.query(
        `UPDATE asset_allocation aa
            SET period = tstzrange(
              statement_timestamp() - interval '3 days',
              statement_timestamp() - interval '1 minute',
              '[)'
            )
           FROM reservation_line rl
          WHERE aa.tenant_id = $1
            AND rl.tenant_id = aa.tenant_id
            AND rl.id = aa.reservation_line_id
            AND rl.reservation_id = $2::uuid`,
        [seed.tenantId, returned.id],
      );
    });

    const before = await pickupState(seed, returned.id);
    expect(before.asset).toMatchObject({
      readiness: 'needs_cleaning',
      recovery_managed_readiness: true,
    });

    const completed = await completeRentalReservation(
      reviewContext(seed, 'req-complete-recovery-due', 'idem-complete-recovery-due'),
      returned.id,
      { version: returned.version },
    );
    expect(completed.status).toBe(200);

    const after = await pickupState(seed, returned.id);
    expect(after.asset).toMatchObject({
      readiness: 'ready',
      recovery_managed_readiness: false,
    });
    expect(after.reservation_status).toBe('completed');
  });

  it('reconciles elapsed Recovery cleaning through the worker without touching persistent readiness states', async () => {
    const seed = await seedWorkspace('org_rsv052_recovery_worker', 'user_rsv052_recovery_worker', 'cash');
    const returned = await createReturnedReservation(seed, 'completion-recovery-worker');

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `UPDATE reservation
            SET pickup_at = statement_timestamp() - interval '3 days',
                due_at = statement_timestamp() - interval '2 days'
          WHERE tenant_id = $1 AND id = $2::uuid`,
        [seed.tenantId, returned.id],
      );
      await client.query(
        `UPDATE asset_allocation aa
            SET period = tstzrange(
              statement_timestamp() - interval '3 days',
              statement_timestamp() - interval '1 minute',
              '[)'
            )
           FROM reservation_line rl
          WHERE aa.tenant_id = $1
            AND rl.tenant_id = aa.tenant_id
            AND rl.id = aa.reservation_line_id
            AND rl.reservation_id = $2::uuid`,
        [seed.tenantId, returned.id],
      );
    });

    expect(await promoteElapsedRecoveryReadinessForAllTenants()).toBe(1);
    const state = await pickupState(seed, returned.id);
    expect(state.asset).toMatchObject({
      readiness: 'ready',
      recovery_managed_readiness: false,
    });
    expect(state.reservation_status).toBe('returned');
  });

  it('keeps canonical maintenance work authoritative and will not mark an asset ready while work remains open', async () => {
    const seed = await seedWorkspace('org_rsv052_maintenance', 'user_rsv052_maintenance', 'cash');
    const returned = await createReturnedReservation(seed, 'completion-maintenance');
    const maintenanceId = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO maintenance_work_order
           (tenant_id, branch_id, asset_id, kind, status, reason, opened_at)
         VALUES ($1, $2, $3, 'cleaning', 'open', 'Post-return deep cleaning', statement_timestamp())
         RETURNING id`,
        [seed.tenantId, seed.branchId, seed.assetId],
      );
      return requireRow(result.rows, 'maintenance work order').id;
    });

    const readyWhileOpen = await inspectReturnedReservation(
      reviewContext(seed, 'req-inspect-maint-open', 'idem-inspect-maint-open'),
      returned.id,
      { version: returned.version, readiness: 'ready' },
    );
    expectFailure(readyWhileOpen, 'STATE_CONFLICT');

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `UPDATE maintenance_work_order
            SET status = 'closed', closed_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, maintenanceId],
      ),
    );
    const ready = await inspectReturnedReservation(
      reviewContext(seed, 'req-inspect-maint-closed', 'idem-inspect-maint-closed'),
      returned.id,
      { version: returned.version, readiness: 'ready' },
    );
    expect(ready.status).toBe(200);
  });

  it('blocks completion on unresolved posted charges, deposit holding, and pending refund without rewriting finance history', async () => {
    const seed = await seedWorkspace('org_rsv052_settlement', 'user_rsv052_settlement', 'cash');
    const returned = await createReturnedReservation(seed, 'completion-settlement');
    await inspectReturnedReservation(
      reviewContext(seed, 'req-inspect-settlement-ready', 'idem-inspect-settlement-ready'),
      returned.id,
      { version: returned.version, readiness: 'ready' },
    );

    const finance = await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const charge = await client.query<{ id: string }>(
        `INSERT INTO charge (tenant_id, reservation_id, kind, amount_minor, currency, business_key)
         VALUES ($1, $2, 'damage_fee', 10000, 'PHP', $3) RETURNING id`,
        [seed.tenantId, returned.id, `charge:${returned.id}:damage`],
      );
      const refund = await client.query<{ id: string }>(
        `INSERT INTO refund
           (tenant_id, payment_id, amount_minor, currency, purpose, status, requested_by, business_key)
         VALUES ($1, $2, 50000, 'PHP', 'security_deposit', 'requested', $3, $4)
         RETURNING id`,
        [seed.tenantId, returned.paymentId, seed.membershipId, `refund:${returned.id}:security`],
      );
      await client.query(
        `INSERT INTO deposit_entry
           (tenant_id, reservation_id, payment_id, kind, amount_minor, currency, business_key)
         VALUES ($1, $2, $3, 'receive', 50000, 'PHP', $4)`,
        [seed.tenantId, returned.id, returned.paymentId, `deposit:${returned.id}:receive`],
      );
      return {
        chargeId: requireRow(charge.rows, 'damage charge').id,
        refundId: requireRow(refund.rows, 'security refund').id,
      };
    });

    const chargeBlocked = await completeRentalReservation(
      reviewContext(seed, 'req-complete-charge', 'idem-complete-charge'),
      returned.id,
      { version: returned.version },
    );
    expectFailure(chargeBlocked, 'PAYMENT_PREREQUISITE_FAILED');

    await withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      await client.query(
        `INSERT INTO payment_allocation
           (tenant_id, payment_id, charge_id, amount_minor, direction, business_key)
         VALUES ($1, $2, $3, 10000, 'apply', $4)`,
        [seed.tenantId, returned.paymentId, finance.chargeId, `allocation:${returned.id}:damage`],
      );
      await client.query(
        `INSERT INTO deposit_entry
           (tenant_id, reservation_id, payment_id, refund_id, kind, amount_minor, currency, business_key)
         VALUES ($1, $2, $3, $4, 'release', 50000, 'PHP', $5)`,
        [seed.tenantId, returned.id, returned.paymentId, finance.refundId, `deposit:${returned.id}:release`],
      );
    });

    const refundBlocked = await completeRentalReservation(
      reviewContext(seed, 'req-complete-refund-pending', 'idem-complete-refund-pending'),
      returned.id,
      { version: returned.version },
    );
    expectFailure(refundBlocked, 'PAYMENT_PREREQUISITE_FAILED');

    await withTenantTransaction(seed.tenantId, seed.principalId, (client) =>
      client.query(
        `UPDATE refund
            SET status = 'completed', completed_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, finance.refundId],
      ),
    );
    const completed = await completeRentalReservation(
      reviewContext(seed, 'req-complete-settled', 'idem-complete-settled'),
      returned.id,
      { version: returned.version },
    );
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ success: true, data: { reservation: { status: 'completed' } } });
  });

  it('allows Complete Rental as an existing-rental settlement action for a cancelled workspace', async () => {
    const seed = await seedWorkspace('org_rsv052_cancelled_settlement', 'user_rsv052_cancelled_settlement', 'cash');
    const returned = await createReturnedReservation(seed, 'completion-cancelled-settlement');
    await inspectReturnedReservation(
      reviewContext(seed, 'req-inspect-cancelled-settlement', 'idem-inspect-cancelled-settlement'),
      returned.id,
      { version: returned.version, readiness: 'ready' },
    );

    const completed = await completeRentalReservation(
      {
        ...reviewContext(seed, 'req-complete-cancelled-settlement', 'idem-complete-cancelled-settlement'),
        effectiveTenantStatus: 'cancelled',
      },
      returned.id,
      { version: returned.version },
    );
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      success: true,
      data: { reservation: { status: 'completed' } },
    });
  });

  it('serializes Complete Rental double-fire to one completion and allocation release', async () => {
    const seed = await seedWorkspace('org_rsv052_race', 'user_rsv052_race', 'cash');
    const returned = await createReturnedReservation(seed, 'completion-race');
    await inspectReturnedReservation(
      reviewContext(seed, 'req-inspect-race', 'idem-inspect-race'),
      returned.id,
      { version: returned.version, readiness: 'ready' },
    );

    const concurrent = await Promise.all([
      completeRentalReservation(
        reviewContext(seed, 'req-complete-race-a', 'idem-complete-race'),
        returned.id,
        { version: returned.version },
      ),
      completeRentalReservation(
        reviewContext(seed, 'req-complete-race-b', 'idem-complete-race'),
        returned.id,
        { version: returned.version },
      ),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0]?.status).toBe(200);
    expect(await actionEffectCounts(seed, returned.id, 'reservation.completed')).toEqual({ audit: 1, outbox: 1 });
    expect((await pickupState(seed, returned.id)).allocation.is_blocking).toBe(false);
  });

  it('exposes protected inspection and Complete Rental routes with strict bodies and custody/asset permissions', async () => {
    const seed = await seedWorkspace('org_rsv052_route', 'user_rsv052_route', 'cash');
    const returned = await createReturnedReservation(seed, 'completion-route');

    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const unauthenticated = await request(createApp())
      .post(`/api/v1/reservations/${returned.id}/inspection`)
      .set('Idempotency-Key', 'route-inspection-unauth')
      .send({ version: returned.version, readiness: 'ready' });
    expect(unauthenticated.status).toBe(401);

    useClerk(seed);
    const injected = await request(createApp())
      .post(`/api/v1/reservations/${returned.id}/inspection`)
      .set('Idempotency-Key', 'route-inspection-injected')
      .send({ version: returned.version, readiness: 'ready', asset_id: seed.assetId });
    expect(injected.status).toBe(422);

    const noAssets = await seedWorkspace('org_rsv052_no_assets', 'user_rsv052_no_assets', 'cash');
    const noAssetsReturned = await createReturnedReservation(noAssets, 'completion-no-assets');
    await withTenantTransaction(noAssets.tenantId, noAssets.principalId, (client) =>
      client.query(
        `UPDATE branch_membership SET permission_codes = $4::jsonb
          WHERE tenant_id = $1 AND branch_id = $2 AND membership_id = $3`,
        [
          noAssets.tenantId,
          noAssets.branchId,
          noAssets.membershipId,
          JSON.stringify(noAssets.permissions.filter((permission) => permission !== 'assets.manage')),
        ],
      ),
    );
    useClerk(noAssets);
    const forbiddenInspection = await request(createApp())
      .post(`/api/v1/reservations/${noAssetsReturned.id}/inspection`)
      .set('Idempotency-Key', 'route-inspection-forbidden')
      .send({ version: noAssetsReturned.version, readiness: 'ready' });
    expect(forbiddenInspection.status).toBe(403);

    useClerk(seed);
    const inspected = await request(createApp())
      .post(`/api/v1/reservations/${returned.id}/inspection`)
      .set('Idempotency-Key', 'route-inspection-success')
      .send({ version: returned.version, readiness: 'ready', condition_note: 'Inspection passed.' });
    expect(inspected.status).toBe(200);

    const completed = await request(createApp())
      .post(`/api/v1/reservations/${returned.id}/complete-rental`)
      .set('Idempotency-Key', 'route-complete-success')
      .send({ version: returned.version });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ success: true, data: { reservation: { status: 'completed' } } });
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

  async function createPickedUpReservation(
    seed: ReviewSeed,
    suffix: string,
  ): Promise<HeldReservation> {
    const confirmed = await createConfirmedReservation(seed, suffix);
    const pickedUp = await pickupReservation(
      reviewContext(seed, `req-${suffix}-pickup`, `idem-${suffix}-pickup`),
      confirmed.id,
      { version: confirmed.version, condition_note: 'Condition recorded at pickup.' },
    );
    if (pickedUp.status !== 200 || pickedUp.body.success !== true) {
      throw new Error('Expected reservation pickup to succeed.');
    }
    return { ...confirmed, version: pickedUp.body.data.reservation.version };
  }

  async function createReturnedReservation(
    seed: ReviewSeed,
    suffix: string,
  ): Promise<HeldReservation> {
    const pickedUp = await createPickedUpReservation(seed, suffix);
    const returned = await returnReservation(
      reviewContext(seed, `req-${suffix}-return`, `idem-${suffix}-return`),
      pickedUp.id,
      { version: pickedUp.version, condition_note: 'Returned for post-rental inspection.' },
    );
    if (returned.status !== 200 || returned.body.success !== true) {
      throw new Error('Expected reservation return to succeed.');
    }
    return { ...pickedUp, version: returned.body.data.reservation.version };
  }

  async function createConfirmedReservation(
    seed: ReviewSeed,
    suffix: string,
  ): Promise<HeldReservation> {
    const held = await createHold(seed, suffix);
    if (seed.rail !== 'cash') {
      await attachAcceptedReceipt(seed, held, -1);
    }
    const submitted = await submitReservation(
      reviewContext(seed, `req-${suffix}-submit`, `idem-${suffix}-submit`),
      held.id,
      { version: 1, terms_accepted: true },
    );
    if (submitted.status !== 200) throw new Error('Expected reservation submission to succeed.');
    await verifyMerchantCollection(seed, held, seed.rail !== 'cash');
    const confirmed = await confirmReservation(
      reviewContext(seed, `req-${suffix}-confirm`, `idem-${suffix}-confirm`),
      held.id,
      { version: 2 },
    );
    if (confirmed.status !== 200 || confirmed.body.success !== true) {
      throw new Error('Expected reservation confirmation to succeed.');
    }
    return { ...held, version: confirmed.body.data.reservation.version };
  }

  async function createHoldForInterval(
    seed: ReviewSeed,
    suffix: string,
    start: string,
    end: string,
  ): Promise<HeldReservation> {
    const result = await createStaffReservation(
      reviewContext(seed, `req-create-${suffix}`, `idem-create-${suffix}`),
      {
        ...createRequest(seed),
        requested_interval: { start, end },
        event_date: undefined,
      },
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
      return requireRow(payment.rows, 'interval payment').id;
    });
    return { id: reservation.id, version: reservation.version, paymentId };
  }

  function walkInCustomer(fullName: string) {
    return {
      source: 'new' as const,
      customer: {
        full_name: fullName,
        phone: '09170000032',
        address: '123 Review Street, Quezon City',
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
          address: '123 Review Street, Quezon City',
        },
      },
      variant_id: seed.variantId as ProductVariantId,
      requested_interval: {
        start: '2026-10-10T02:00:00.000Z',
        end: '2026-10-13T02:00:00.000Z',
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

  async function pickupState(seed: ReviewSeed, reservationId: string) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const reservation = await client.query<{ status: string }>(
        `SELECT status FROM reservation WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, reservationId],
      );
      const asset = await client.query<{
        lifecycle_status: string;
        readiness: string;
        recovery_managed_readiness: boolean;
        custody_kind: string;
        version: number;
      }>(
        `SELECT lifecycle_status, readiness, recovery_managed_readiness, custody_kind, version
           FROM physical_asset
          WHERE tenant_id = $1 AND id = $2`,
        [seed.tenantId, seed.assetId],
      );
      const allocation = await client.query<{
        kind: string;
        is_blocking: boolean;
        released_at: Date | null;
        blocked_end: Date;
      }>(
        `SELECT aa.kind, aa.is_blocking, aa.released_at, upper(aa.period) AS blocked_end
           FROM asset_allocation aa
           JOIN reservation_line rl
             ON rl.tenant_id = aa.tenant_id
            AND rl.id = aa.reservation_line_id
          WHERE aa.tenant_id = $1 AND rl.reservation_id = $2
          ORDER BY aa.created_at, aa.id
          LIMIT 1`,
        [seed.tenantId, reservationId],
      );
      const custodyEvents = await client.query<{
        event_kind: string;
        actor_membership_id: string;
        condition_note: string | null;
      }>(
        `SELECT event_kind, actor_membership_id,
                nullif(btrim(condition_snapshot ->> 'condition_note'), '') AS condition_note
           FROM custody_event
          WHERE tenant_id = $1 AND reservation_line_id IN (
            SELECT id FROM reservation_line WHERE tenant_id = $1 AND reservation_id = $2
          )
          ORDER BY occurred_at, id`,
        [seed.tenantId, reservationId],
      );
      return {
        reservation_status: requireRow(reservation.rows, 'pickup reservation state').status,
        asset: requireRow(asset.rows, 'pickup asset state'),
        allocation: requireRow(allocation.rows, 'pickup allocation state'),
        custodyEvents: custodyEvents.rows,
      };
    });
  }

  async function cancellationAudit(seed: ReviewSeed, reservationId: string) {
    return withTenantTransaction(seed.tenantId, seed.principalId, async (client) => {
      const result = await client.query<{
        previous_status: string | null;
        payment_status: string | null;
        financial_followup_required: boolean | null;
      }>(
        `SELECT
           redacted_summary ->> 'previous_status' AS previous_status,
           redacted_summary ->> 'payment_status' AS payment_status,
           (redacted_summary ->> 'financial_followup_required')::boolean AS financial_followup_required
         FROM audit_event
         WHERE tenant_id = $1 AND entity_id = $2 AND action = 'reservation.cancelled'
         ORDER BY occurred_at DESC
         LIMIT 1`,
        [seed.tenantId, reservationId],
      );
      return requireRow(result.rows, 'cancellation audit');
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
