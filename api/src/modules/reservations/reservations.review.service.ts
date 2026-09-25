import {
  reservationConfirmRequest,
  reservationConfirmResponse,
  reservationPaymentReceiptAttachRequest,
  reservationPaymentReceiptAttachResponse,
  reservationPaymentVerifyRequest,
  reservationPaymentVerifyResponse,
  reservationRejectRequest,
  reservationRejectResponse,
  reservationSubmitRequest,
  reservationSubmitResponse,
  reservationSummary,
  type ReservationConfirmRequest,
  type ReservationConfirmResponse,
  type ReservationPaymentReceiptAttachRequest,
  type ReservationPaymentReceiptAttachResponse,
  type ReservationPaymentVerifyRequest,
  type ReservationPaymentVerifyResponse,
  type ReservationRejectRequest,
  type ReservationRejectResponse,
  type ReservationSubmitRequest,
  type ReservationSummary,
  type ReservationSubmitResponse,
  type StaffReservationCustomerInput,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  HoldExpiredError,
  IdempotencyKeyReusedError,
  InvalidReservationTransitionError,
  NotFoundError,
  PaymentPrerequisiteFailedError,
  StaleVersionError,
  StateConflictError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
  type TenantIdempotencyClaim,
} from '../../shared/tenant-idempotency.js';
import {
  appendReservationAuditEvent,
  appendReservationOutboxEvent,
  createReservationCustomer,
  readReservationCustomerForCreate,
  type ReservationCustomerSnapshotRow,
} from './reservations.command.repository.js';
import {
  attachAcceptedReservationReceipt,
  bindReservationCustomerForSubmit,
  confirmReservationReview,
  expireReservationReview,
  lockLatestReservationReceipt,
  lockReservationAllocationsForReview,
  lockReservationForReview,
  lockReservationPaymentForReview,
  insertReservationPaymentVerification,
  markReceiptUnderReview,
  markReservationReceiptVerified,
  markReservationAllocationsConfirmed,
  readLatestReservationVerification,
  readReservationMutationSummary,
  rejectReservationReview,
  releaseReservationAllocations,
  submitReservationForReview,
  verifyReservationPaymentCollection,
  type LockedReservationPaymentRow,
  type LockedReservationReceiptRow,
  type LockedReservationReviewRow,
  type ReservationMutationSummaryRow,
} from './reservations.review.repository.js';

const SUBMIT_OPERATION = 'reservation.submit.v1';
const ATTACH_PAYMENT_RECEIPT_OPERATION = 'reservation.payment_receipt.attach.v1';
const VERIFY_PAYMENT_OPERATION = 'reservation.payment.verify.v1';
const CONFIRM_OPERATION = 'reservation.confirm.v1';
const REJECT_OPERATION = 'reservation.reject.v1';
const REVIEW_EFFECTS_SAVEPOINT = 'reservation_review_effects';
const EXPIRY_EFFECTS_SAVEPOINT = 'reservation_review_expiry_effects';

export interface ReservationReviewReadContext {
  tenantId: string;
  branchId: string;
  principalId: string;
}

export interface ReservationReviewContext extends ReservationReviewReadContext {
  membershipId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface ReservationReviewCommandResponse<T> {
  status: number;
  body: SuccessEnvelope<T> | FailureEnvelope;
}

export async function readReservationReviewSummary(
  context: ReservationReviewReadContext,
  reservationId: string,
): Promise<ReservationSummary> {
  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const row = await readReservationMutationSummary(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      reservationId,
    });
    if (!row) throw new NotFoundError('Reservation could not be found.');
    return toReservationSummary(row);
  });
}

export async function submitReservationForConfirmation(
  context: ReservationReviewContext,
  reservationId: string,
  requestInput: ReservationSubmitRequest,
): Promise<ReservationReviewCommandResponse<ReservationSubmitResponse>> {
  const parsed = reservationSubmitRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation submission request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimReviewIdempotency(client, context, SUBMIT_OPERATION, payloadHash);
    const replay = replayOrThrow<ReservationSubmitResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const reservation = await requireLockedReservation(client, context, reservationId);
      assertActionableState(reservation, request.version, 'held');

      const payment = await lockReservationPaymentForReview(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      const receipt = payment
        ? await lockLatestReservationReceipt(client, {
            tenantId: context.tenantId,
            paymentId: payment.payment_id,
          })
        : null;
      const allocations = await lockReservationAllocationsForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      assertCurrentBlockingAllocation(allocations);

      if (deadlineElapsed(reservation)) {
        await expireLockedReview(client, context, reservation, reservationId);
        throw new HoldExpiredError('This reservation hold expired before submission completed.');
      }

      const customerIntent = request.customer;
      if (reservation.customer_snapshot === null && !customerIntent) {
        throw new StateConflictError('Customer information is required before completing this hold.');
      }
      if (reservation.customer_snapshot !== null) {
        assertCompleteCustomerSnapshot(reservation.customer_snapshot);
        if (customerIntent) {
          throw new StateConflictError('This reservation already has a customer snapshot.');
        }
      }
      assertSubmissionEvidence(reservation, payment, receipt);

      await client.query(`SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;
      if (reservation.customer_snapshot === null) {
        if (!customerIntent) {
          throw new StateConflictError('Customer information is required before completing this hold.');
        }
        const customer = await resolveSubmissionCustomer(client, context.tenantId, customerIntent);
        const customerSnapshot = {
          full_name: customer.full_name,
          phone: customer.phone,
          email: customer.email,
        };
        assertCompleteCustomerSnapshot(customerSnapshot);
        const bound = await bindReservationCustomerForSubmit(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          reservationId,
          version: request.version,
          customerId: customer.id,
          customerSnapshot,
        });
        if (!bound) {
          throw new StateConflictError('Reservation customer changed during submission.');
        }
      }
      if (receipt?.evidence_status === 'uploaded') {
        await markReceiptUnderReview(client, {
          tenantId: context.tenantId,
          receiptId: receipt.receipt_id,
        });
      }
      const newVersion = await submitReservationForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
        version: request.version,
      });
      if (newVersion === null) {
        throw new StateConflictError('Reservation submission lost a concurrent state change.');
      }

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.submitted_for_confirmation',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: { version: newVersion },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-pending-confirmation:${reservationId}:${newVersion}`,
        eventType: 'reservation.pending_confirmation',
        payload: { reservationId, reservationVersion: newVersion },
      });

      const data = reservationSubmitResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
      });
      await client.query(`RELEASE SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
      savepointOpen = false;
      return finalizeSuccess(client, context, SUBMIT_OPERATION, payloadHash, data);
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
      }
      return finalizeKnownFailure(client, context, SUBMIT_OPERATION, payloadHash, error);
    }
  });
}

export async function attachReservationPaymentReceipt(
  context: ReservationReviewContext,
  reservationId: string,
  requestInput: ReservationPaymentReceiptAttachRequest,
): Promise<ReservationReviewCommandResponse<ReservationPaymentReceiptAttachResponse>> {
  const parsed = reservationPaymentReceiptAttachRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation payment receipt request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimReviewIdempotency(
      client,
      context,
      ATTACH_PAYMENT_RECEIPT_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<ReservationPaymentReceiptAttachResponse>(claim);
    if (replay) return replay;

    try {
      const reservation = await requireLockedReservation(client, context, reservationId);
      if (reservation.status !== 'held' && reservation.status !== 'pending_confirmation') {
        throw new InvalidReservationTransitionError(
          `Payment evidence cannot be attached while reservation is ${reservation.status}.`,
        );
      }
      if (deadlineElapsed(reservation)) {
        throw new HoldExpiredError('This reservation deadline has expired.');
      }

      const payment = await lockReservationPaymentForReview(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      if (!payment) throw new PaymentPrerequisiteFailedError('Reservation payment intent is missing.');
      if (payment.rail === 'cash') {
        throw new StateConflictError('Cash payments do not require uploaded payment evidence.');
      }
      if (payment.status === 'paid' || payment.verified_at !== null) {
        throw new StateConflictError('This reservation payment is already verified.');
      }

      const receipt = await attachAcceptedReservationReceipt(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
        fileId: request.file_id,
      });
      if (!receipt) {
        throw new StateConflictError('Payment receipt must be an accepted immutable payment-receipt file.');
      }

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'payment.receipt_attached',
        entityType: 'payment',
        entityId: payment.payment_id,
        redactedSummary: { reservation_id: reservationId, receipt_id: receipt.receipt_id },
        requestId: context.requestId,
      });

      const data = reservationPaymentReceiptAttachResponse.parse({
        receipt_id: receipt.receipt_id,
        payment_id: receipt.payment_id,
        evidence_status: 'uploaded',
      });
      return finalizeSuccess(
        client,
        context,
        ATTACH_PAYMENT_RECEIPT_OPERATION,
        payloadHash,
        data,
      );
    } catch (error) {
      return finalizeKnownFailure(
        client,
        context,
        ATTACH_PAYMENT_RECEIPT_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

export async function verifyReservationPaymentByStaff(
  context: ReservationReviewContext,
  reservationId: string,
  requestInput: ReservationPaymentVerifyRequest,
  options: {
    requireRail?: 'cash' | 'manual_qr' | 'manual_transfer';
    cashTenderedMinor?: string;
  } = {},
): Promise<ReservationReviewCommandResponse<ReservationPaymentVerifyResponse>> {
  const parsed = reservationPaymentVerifyRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation payment verification request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({
    reservation_id: reservationId,
    ...request,
    ...(options.cashTenderedMinor !== undefined
      ? { cash_tendered_minor: options.cashTenderedMinor }
      : {}),
  });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimReviewIdempotency(client, context, VERIFY_PAYMENT_OPERATION, payloadHash);
    const replay = replayOrThrow<ReservationPaymentVerifyResponse>(claim);
    if (replay) return replay;

    try {
      const reservation = await requireLockedReservation(client, context, reservationId);
      assertActionableState(reservation, request.version, 'pending_confirmation');
      if (deadlineElapsed(reservation)) {
        await expireLockedReview(client, context, reservation, reservationId);
        throw new HoldExpiredError('The merchant review deadline has expired.');
      }

      const payment = await lockReservationPaymentForReview(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      if (!payment) throw new PaymentPrerequisiteFailedError('Reservation payment intent is missing.');
      if (options.requireRail && payment.rail !== options.requireRail) {
        throw new PaymentPrerequisiteFailedError(
          `This payment action requires the ${options.requireRail} payment rail.`,
        );
      }
      if (payment.status === 'failed' || payment.status === 'refunded') {
        throw new PaymentPrerequisiteFailedError('Reservation payment is not eligible for verification.');
      }
      if (
        BigInt(request.verified_amount_minor) !== BigInt(payment.amount_minor) ||
        BigInt(request.verified_amount_minor) < BigInt(reservation.due_now_minor)
      ) {
        throw new PaymentPrerequisiteFailedError('Verified amount must exactly match the recorded amount due.');
      }

      const receipt = await lockLatestReservationReceipt(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
      });
      if (payment.rail !== 'cash') {
        if (!receipt || !isImmutableAcceptedReceipt(receipt)) {
          throw new PaymentPrerequisiteFailedError('Accepted payment evidence is required before verification.');
        }
        if (receipt.evidence_status !== 'uploaded' && receipt.evidence_status !== 'under_review') {
          throw new PaymentPrerequisiteFailedError('Payment evidence is not eligible for verification.');
        }
      }

      const existingVerification = await readLatestReservationVerification(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
      });
      if (
        payment.status === 'paid' &&
        payment.verified_at &&
        existingVerification?.decision === 'verified' &&
        existingVerification.verified_amount_minor === payment.amount_minor
      ) {
        const data = reservationPaymentVerifyResponse.parse({
          reservation: await requireMutationSummary(client, context, reservationId),
          payment_id: payment.payment_id,
          payment_status: 'paid',
          verified_amount_minor: String(payment.amount_minor),
          verified_at: payment.verified_at.toISOString(),
        });
        return finalizeSuccess(client, context, VERIFY_PAYMENT_OPERATION, payloadHash, data);
      }
      if (payment.status === 'paid' || payment.verified_at !== null || existingVerification) {
        throw new StateConflictError('Payment verification state changed. Refresh before retrying.');
      }

      const verifiedAt = await verifyReservationPaymentCollection(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
        merchantReference: request.merchant_reference ?? null,
      });
      if (!verifiedAt) {
        throw new StateConflictError('Payment verification lost a concurrent state change.');
      }
      const cashTenderedMinor =
        payment.rail === 'cash' && options.cashTenderedMinor !== undefined
          ? Number(BigInt(options.cashTenderedMinor))
          : null;
      const changeDueMinor =
        cashTenderedMinor === null ? null : cashTenderedMinor - payment.amount_minor;
      const verificationId = await insertReservationPaymentVerification(client, {
        tenantId: context.tenantId,
        paymentId: payment.payment_id,
        membershipId: context.membershipId,
        verifiedAmountMinor: payment.amount_minor,
        cashTenderedMinor,
        changeDueMinor,
        evidenceNote:
          payment.rail === 'cash'
            ? 'Cash collection recorded by staff.'
            : 'Payment evidence verified by staff against merchant collection.',
      });
      if (!verificationId) {
        throw new StateConflictError('Payment was already verified by another action. Refresh before retrying.');
      }
      if (payment.rail !== 'cash' && receipt) {
        await markReservationReceiptVerified(client, {
          tenantId: context.tenantId,
          receiptId: receipt.receipt_id,
        });
      }

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'payment.verified',
        entityType: 'payment',
        entityId: payment.payment_id,
        redactedSummary: {
          reservation_id: reservationId,
          payment_rail: payment.rail,
          verified_amount_minor: payment.amount_minor,
          verification_id: verificationId,
        },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `payment-verified:${payment.payment_id}`,
        eventType: 'payment.verified',
        payload: { reservationId, paymentId: payment.payment_id },
      });

      const data = reservationPaymentVerifyResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
        payment_id: payment.payment_id,
        payment_status: 'paid',
        verified_amount_minor: String(payment.amount_minor),
        verified_at: verifiedAt.toISOString(),
      });
      return finalizeSuccess(client, context, VERIFY_PAYMENT_OPERATION, payloadHash, data);
    } catch (error) {
      return finalizeKnownFailure(client, context, VERIFY_PAYMENT_OPERATION, payloadHash, error);
    }
  });
}

export async function confirmReservationByMerchant(
  context: ReservationReviewContext,
  reservationId: string,
  requestInput: ReservationConfirmRequest,
): Promise<ReservationReviewCommandResponse<ReservationConfirmResponse>> {
  const parsed = reservationConfirmRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation confirmation request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimReviewIdempotency(client, context, CONFIRM_OPERATION, payloadHash);
    const replay = replayOrThrow<ReservationConfirmResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const reservation = await requireLockedReservation(client, context, reservationId);
      assertActionableState(reservation, request.version, 'pending_confirmation');

      const payment = await lockReservationPaymentForReview(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      const receipt = payment
        ? await lockLatestReservationReceipt(client, {
            tenantId: context.tenantId,
            paymentId: payment.payment_id,
          })
        : null;
      const verification = payment
        ? await readLatestReservationVerification(client, {
            tenantId: context.tenantId,
            paymentId: payment.payment_id,
          })
        : null;
      const allocations = await lockReservationAllocationsForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      assertCurrentBlockingAllocation(allocations);

      if (deadlineElapsed(reservation)) {
        await expireLockedReview(client, context, reservation, reservationId);
        throw new HoldExpiredError('The merchant review deadline has expired.');
      }
      assertVerifiedMerchantCollection(reservation, payment, receipt, verification);

      await client.query(`SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;
      const updatedAllocations = await markReservationAllocationsConfirmed(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      if (updatedAllocations !== allocations.length) {
        throw new StateConflictError('Reservation allocation changed during confirmation.');
      }
      const newVersion = await confirmReservationReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
        version: request.version,
      });
      if (newVersion === null) {
        throw new StateConflictError('Reservation confirmation lost a concurrent state change.');
      }

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.confirmed',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: {
          version: newVersion,
          payment_id: payment?.payment_id ?? null,
          verification_id: verification?.verification_id ?? null,
        },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-confirmed:${reservationId}:${newVersion}`,
        eventType: 'reservation.confirmed',
        payload: { reservationId, reservationVersion: newVersion },
      });

      const data = reservationConfirmResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
      });
      await client.query(`RELEASE SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
      savepointOpen = false;
      return finalizeSuccess(client, context, CONFIRM_OPERATION, payloadHash, data);
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
      }
      return finalizeKnownFailure(client, context, CONFIRM_OPERATION, payloadHash, error);
    }
  });
}

export async function rejectReservationByMerchant(
  context: ReservationReviewContext,
  reservationId: string,
  requestInput: ReservationRejectRequest,
): Promise<ReservationReviewCommandResponse<ReservationRejectResponse>> {
  const parsed = reservationRejectRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation rejection request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimReviewIdempotency(client, context, REJECT_OPERATION, payloadHash);
    const replay = replayOrThrow<ReservationRejectResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const reservation = await requireLockedReservation(client, context, reservationId);
      assertActionableState(reservation, request.version, 'pending_confirmation');

      const payment = await lockReservationPaymentForReview(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      if (payment) {
        await lockLatestReservationReceipt(client, {
          tenantId: context.tenantId,
          paymentId: payment.payment_id,
        });
      }
      const allocations = await lockReservationAllocationsForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      assertCurrentBlockingAllocation(allocations);

      if (deadlineElapsed(reservation)) {
        await expireLockedReview(client, context, reservation, reservationId);
        throw new HoldExpiredError('The merchant review deadline has expired.');
      }

      await client.query(`SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;
      const newVersion = await rejectReservationReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
        version: request.version,
      });
      if (newVersion === null) {
        throw new StateConflictError('Reservation rejection lost a concurrent state change.');
      }
      const released = await releaseReservationAllocations(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      if (released !== allocations.length) {
        throw new StateConflictError('Reservation allocation changed during rejection.');
      }

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.rejected',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: { version: newVersion, merchant_reason: request.reason },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-rejected:${reservationId}:${newVersion}`,
        eventType: 'reservation.rejected',
        payload: { reservationId, reservationVersion: newVersion },
      });

      const data = reservationRejectResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
      });
      await client.query(`RELEASE SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
      savepointOpen = false;
      return finalizeSuccess(client, context, REJECT_OPERATION, payloadHash, data);
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${REVIEW_EFFECTS_SAVEPOINT}`);
      }
      return finalizeKnownFailure(client, context, REJECT_OPERATION, payloadHash, error);
    }
  });
}

async function requireLockedReservation(
  client: Parameters<typeof lockReservationForReview>[0],
  context: ReservationReviewContext,
  reservationId: string,
): Promise<LockedReservationReviewRow> {
  const row = await lockReservationForReview(client, {
    tenantId: context.tenantId,
    branchId: context.branchId,
    reservationId,
  });
  if (!row) throw new NotFoundError('Reservation could not be found.');
  return row;
}

function assertActionableState(
  reservation: LockedReservationReviewRow,
  requestedVersion: number,
  expectedStatus: 'held' | 'pending_confirmation',
): void {
  if (reservation.status === 'expired') {
    throw new HoldExpiredError('This reservation deadline has expired.');
  }
  if (reservation.version !== requestedVersion) {
    throw new StaleVersionError('Reservation version is stale. Refresh before retrying.');
  }
  if (reservation.status !== expectedStatus) {
    throw new InvalidReservationTransitionError(
      `Reservation cannot transition from ${reservation.status} in this operation.`,
    );
  }
}

function deadlineElapsed(reservation: LockedReservationReviewRow): boolean {
  return (
    reservation.hold_expires_at === null ||
    reservation.hold_expires_at.getTime() <= reservation.database_now.getTime()
  );
}

async function resolveSubmissionCustomer(
  client: Parameters<typeof readReservationCustomerForCreate>[0],
  tenantId: string,
  intent: StaffReservationCustomerInput,
): Promise<ReservationCustomerSnapshotRow> {
  if (intent.source === 'existing') {
    const existing = await readReservationCustomerForCreate(client, {
      tenantId,
      customerId: intent.customer_id,
    });
    if (!existing) throw new NotFoundError('Customer could not be found.');
    return existing;
  }

  return createReservationCustomer(client, {
    tenantId,
    fullName: intent.customer.full_name,
    phone: intent.customer.phone ?? null,
    email: intent.customer.email?.trim().toLowerCase() ?? null,
    notes: intent.customer.notes ?? null,
  });
}

function assertCompleteCustomerSnapshot(snapshot: Record<string, unknown> | null): void {
  const fullName = snapshot?.full_name;
  const phone = snapshot?.phone;
  const email = snapshot?.email;
  if (
    typeof fullName !== 'string' ||
    fullName.trim().length === 0 ||
    !(
      (typeof phone === 'string' && phone.trim().length > 0) ||
      (typeof email === 'string' && email.trim().length > 0)
    )
  ) {
    throw new StateConflictError('Reservation contact snapshot is incomplete for submission.');
  }
}

function assertSubmissionEvidence(
  reservation: LockedReservationReviewRow,
  payment: LockedReservationPaymentRow | null,
  receipt: LockedReservationReceiptRow | null,
): void {
  if (reservation.due_now_minor === 0) return;
  if (!payment) {
    throw new PaymentPrerequisiteFailedError('Reservation payment intent is missing.');
  }
  if (payment.status === 'failed' || payment.status === 'refunded') {
    throw new PaymentPrerequisiteFailedError('Reservation payment intent is not eligible for review.');
  }
  if (payment.currency !== reservation.currency || payment.amount_minor < reservation.due_now_minor) {
    throw new PaymentPrerequisiteFailedError('Reservation payment intent does not cover the amount due now.');
  }
  if (payment.rail === 'cash') return;
  if (!receipt) {
    throw new PaymentPrerequisiteFailedError('Payment evidence must be uploaded before submission.');
  }
  if (!isImmutableAcceptedReceipt(receipt)) {
    throw new PaymentPrerequisiteFailedError('Payment evidence is not an accepted immutable receipt.');
  }
  if (receipt.evidence_status !== 'uploaded' && receipt.evidence_status !== 'under_review') {
    throw new PaymentPrerequisiteFailedError('Payment evidence is not eligible for merchant review.');
  }
  if (
    reservation.hold_expires_at === null ||
    receipt.submitted_at.getTime() >= reservation.hold_expires_at.getTime()
  ) {
    throw new HoldExpiredError('Payment evidence was not submitted before the original hold deadline.');
  }
}

function assertVerifiedMerchantCollection(
  reservation: LockedReservationReviewRow,
  payment: LockedReservationPaymentRow | null,
  receipt: LockedReservationReceiptRow | null,
  verification: Awaited<ReturnType<typeof readLatestReservationVerification>>,
): void {
  if (reservation.due_now_minor === 0) return;
  if (!payment) {
    throw new PaymentPrerequisiteFailedError('Reservation payment intent is missing.');
  }
  if (
    payment.status !== 'paid' ||
    payment.verified_at === null ||
    payment.currency !== reservation.currency ||
    payment.amount_minor < reservation.due_now_minor
  ) {
    throw new PaymentPrerequisiteFailedError('Verified merchant collection is required before confirmation.');
  }
  if (
    !verification ||
    verification.decision !== 'verified' ||
    verification.verified_amount_minor === null ||
    verification.verified_amount_minor < reservation.due_now_minor
  ) {
    throw new PaymentPrerequisiteFailedError('A verified merchant decision is required before confirmation.');
  }
  if (payment.rail === 'cash') return;
  if (!receipt || receipt.evidence_status !== 'verified' || !isImmutableAcceptedReceipt(receipt)) {
    throw new PaymentPrerequisiteFailedError(
      'Uploaded evidence alone is insufficient; verified merchant evidence is required.',
    );
  }
}

function isImmutableAcceptedReceipt(receipt: LockedReservationReceiptRow): boolean {
  return (
    receipt.file_purpose === 'payment_receipt' &&
    receipt.file_lifecycle_status === 'accepted' &&
    receipt.file_is_private &&
    receipt.file_frozen_at !== null &&
    (receipt.file_version_id !== null || receipt.file_sha256 !== null)
  );
}

function assertCurrentBlockingAllocation(
  allocations: Awaited<ReturnType<typeof lockReservationAllocationsForReview>>,
): void {
  if (
    allocations.length !== 1 ||
    allocations[0]?.kind !== 'reservation_hold' ||
    allocations[0].is_blocking !== true
  ) {
    throw new StateConflictError('Reservation does not have exactly one current blocking hold allocation.');
  }
}

async function expireLockedReview(
  client: Parameters<typeof expireReservationReview>[0],
  context: ReservationReviewContext,
  reservation: LockedReservationReviewRow,
  reservationId: string,
): Promise<void> {
  await client.query(`SAVEPOINT ${EXPIRY_EFFECTS_SAVEPOINT}`);
  try {
    const newVersion = await expireReservationReview(client, {
      tenantId: context.tenantId,
      branchId: context.branchId,
      reservationId,
      version: reservation.version,
    });
    if (newVersion === null) {
      throw new StateConflictError('Reservation expiry lost a concurrent state change.');
    }
    const released = await releaseReservationAllocations(client, {
      tenantId: context.tenantId,
      reservationId,
    });
    if (released !== 1) {
      throw new StateConflictError('Reservation expiry could not release its current allocation.');
    }
    await appendReservationAuditEvent(client, {
      tenantId: context.tenantId,
      actorKind: 'system',
      actorKey: 'system:reservation-expiry',
      action: 'reservation.expired',
      entityType: 'reservation',
      entityId: reservationId,
      redactedSummary: { reason: 'review_deadline_elapsed', version: newVersion },
      requestId: context.requestId,
    });
    await appendReservationOutboxEvent(client, {
      tenantId: context.tenantId,
      dedupeKey: `reservation-expired:${reservationId}:${newVersion}`,
      eventType: 'reservation.hold_expired',
      payload: { reservationId, reservationVersion: newVersion },
    });
    await client.query(`RELEASE SAVEPOINT ${EXPIRY_EFFECTS_SAVEPOINT}`);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${EXPIRY_EFFECTS_SAVEPOINT}`);
    await client.query(`RELEASE SAVEPOINT ${EXPIRY_EFFECTS_SAVEPOINT}`);
    throw error;
  }
}

async function requireMutationSummary(
  client: Parameters<typeof readReservationMutationSummary>[0],
  context: ReservationReviewReadContext,
  reservationId: string,
): Promise<ReservationSummary> {
  const row = await readReservationMutationSummary(client, {
    tenantId: context.tenantId,
    branchId: context.branchId,
    reservationId,
  });
  if (!row) throw new StateConflictError('Reservation response projection is unavailable.');
  return toReservationSummary(row);
}

function toReservationSummary(row: ReservationMutationSummaryRow): ReservationSummary {
  return reservationSummary.parse({
    id: row.reservation_id,
    reference_code: row.reference_code,
    status: row.status,
    branch_id: row.branch_id,
    storefront_id: row.storefront_id,
    variant_id: row.variant_id,
    payment_method_id: row.payment_method_id,
    fulfillment_method: row.fulfillment_method,
    pickup_at: row.pickup_at.toISOString(),
    due_at: row.due_at.toISOString(),
    timezone_snapshot: row.timezone_snapshot,
    ...(row.event_date ? { event_date: row.event_date } : {}),
    price_snapshot: {
      rental_total_minor: String(row.rental_total_minor),
      security_required_minor: String(row.security_required_minor),
      due_now_minor: String(row.due_now_minor),
      currency: row.currency,
    },
    hold_expires_at: row.hold_expires_at?.toISOString() ?? null,
    version: row.version,
    created_at: row.created_at.toISOString(),
  });
}

async function claimReviewIdempotency(
  client: Parameters<typeof claimTenantIdempotency>[0],
  context: ReservationReviewContext,
  operation: string,
  payloadHash: string,
): Promise<TenantIdempotencyClaim> {
  return claimTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
  });
}

function replayOrThrow<T>(claim: TenantIdempotencyClaim): ReservationReviewCommandResponse<T> | null {
  if (claim.kind === 'replayed') {
    return {
      status: claim.responseCode,
      body: claim.safeResponse as ReservationReviewCommandResponse<T>['body'],
    };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical reservation action is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeSuccess<T>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: ReservationReviewContext,
  operation: string,
  payloadHash: string,
  data: T,
): Promise<ReservationReviewCommandResponse<T>> {
  const body: SuccessEnvelope<T> = { success: true, data, request_id: context.requestId };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'succeeded',
    responseCode: 200,
    safeResponse: body,
  });
  return { status: 200, body };
}

async function finalizeKnownFailure<T>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: ReservationReviewContext,
  operation: string,
  payloadHash: string,
  error: unknown,
): Promise<ReservationReviewCommandResponse<T>> {
  if (!isAppError(error)) throw error;
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}
