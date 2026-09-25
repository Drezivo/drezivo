import { createHash } from 'node:crypto';

import {
  staffReservationCompleteRequest,
  staffReservationCompleteResponse,
  type PermissionCode,
  type ReservationSummary,
  type StaffReservationCompleteRequest,
  type StaffReservationCompleteResponse,
} from '@drezivo/contracts';

import {
  HoldExpiredError,
  InvalidReservationTransitionError,
  StaleVersionError,
  StateConflictError,
  ValidationError,
} from '../../shared/errors.js';
import type { SuccessEnvelope } from '../../shared/response.js';
import {
  confirmReservationByMerchant,
  readReservationReviewSummary,
  submitReservationForConfirmation,
  verifyReservationPaymentByStaff,
  type ReservationReviewCommandResponse,
  type ReservationReviewContext,
} from './reservations.review.service.js';

export interface StaffReservationCompletionContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  permissionCodes: PermissionCode[];
}

/**
 * Staff-facing orchestration for the walk-in "Complete Reservation" action. It never creates a
 * direct held -> confirmed transition: the existing idempotent submit and confirm commands remain
 * the only state-changing authorities, with deterministic child intent keys derived from the one
 * UI intent key so a crash/retry can resume after either boundary without duplicate effects.
 */
export async function completeStaffReservationCommand(
  context: StaffReservationCompletionContext,
  reservationId: string,
  requestInput: StaffReservationCompleteRequest,
): Promise<ReservationReviewCommandResponse<StaffReservationCompleteResponse>> {
  const parsed = staffReservationCompleteRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Staff reservation completion request is invalid.');
  const request = parsed.data;
  const submissionRequest = {
    version: request.version,
    terms_accepted: request.terms_accepted,
    ...(request.customer ? { customer: request.customer } : {}),
  };

  let current = await readReservationReviewSummary(context, reservationId);
  if (current.status === 'expired') {
    throw new HoldExpiredError('This reservation deadline has expired.');
  }
  if (current.status === 'confirmed') {
    return completionSuccess(context, current, 'none');
  }
  if (current.status !== 'held' && current.status !== 'pending_confirmation') {
    throw new InvalidReservationTransitionError(
      `Reservation cannot be completed from ${current.status}.`,
    );
  }
  if (
    request.cash_collection &&
    BigInt(request.cash_collection.amount_tendered_minor) < BigInt(current.price_snapshot.due_now_minor)
  ) {
    throw new ValidationError('Cash tendered cannot be less than the amount due.');
  }

  let pendingReservation: ReservationSummary;
  if (current.status === 'held') {
    const submitted = await submitReservationForConfirmation(
      childContext(context, 'submit'),
      reservationId,
      submissionRequest,
      { allowMissingPaymentEvidence: true },
    );
    if (!submitted.body.success) {
      return { status: submitted.status, body: submitted.body };
    }
    pendingReservation = submitted.body.data.reservation;
  } else {
    if (request.version > current.version || request.version < current.version - 1) {
      throw new StaleVersionError('Reservation version is stale. Refresh before retrying.');
    }
    if (request.version === current.version - 1) {
      const replayedSubmission = await submitReservationForConfirmation(
        childContext(context, 'submit'),
        reservationId,
        submissionRequest,
        { allowMissingPaymentEvidence: true },
      );
      if (!replayedSubmission.body.success) {
        return { status: replayedSubmission.status, body: replayedSubmission.body };
      }
      pendingReservation = replayedSubmission.body.data.reservation;
    } else {
      if (request.customer) {
        throw new StateConflictError(
          'Customer information is already snapshotted for this pending reservation.',
        );
      }
      pendingReservation = current;
    }
  }

  if (pendingReservation.status === 'confirmed') {
    return completionSuccess(context, pendingReservation, 'none');
  }
  if (pendingReservation.status !== 'pending_confirmation') {
    throw new StateConflictError('Reservation submission did not reach pending confirmation.');
  }

  if (request.cash_collection) {
    if (!context.permissionCodes.includes('payments.manage')) {
      return completionSuccess(context, pendingReservation, 'merchant_review');
    }
    const verified = await verifyReservationPaymentByStaff(
      childContext(context, 'verify'),
      reservationId,
      {
        version: pendingReservation.version,
        verified_amount_minor: pendingReservation.price_snapshot.due_now_minor,
      },
      {
        requireRail: 'cash',
        cashTenderedMinor: request.cash_collection.amount_tendered_minor,
      },
    );
    if (!verified.body.success) {
      return { status: verified.status, body: verified.body };
    }
  }

  if (!hasMerchantReviewAuthority(context.permissionCodes)) {
    return completionSuccess(context, pendingReservation, 'merchant_review');
  }

  const confirmed = await confirmReservationByMerchant(
    childContext(context, 'confirm'),
    reservationId,
    { version: pendingReservation.version },
  );
  if (confirmed.body.success) {
    return completionSuccess(context, confirmed.body.data.reservation, 'none');
  }

  if (confirmed.body.error.code === 'PAYMENT_PREREQUISITE_FAILED') {
    return completionSuccess(context, pendingReservation, 'payment_verification');
  }

  if (
    confirmed.body.error.code === 'STALE_VERSION' ||
    confirmed.body.error.code === 'INVALID_RESERVATION_TRANSITION'
  ) {
    current = await readReservationReviewSummary(context, reservationId);
    if (current.status === 'confirmed') {
      return completionSuccess(context, current, 'none');
    }
    if (current.status === 'expired') {
      throw new HoldExpiredError('This reservation deadline has expired.');
    }
  }

  return { status: confirmed.status, body: confirmed.body };
}

function hasMerchantReviewAuthority(permissions: PermissionCode[]): boolean {
  return permissions.includes('reservations.manage') && permissions.includes('payments.manage');
}

function childContext(
  context: StaffReservationCompletionContext,
  stage: 'submit' | 'verify' | 'confirm',
): ReservationReviewContext {
  const digest = createHash('sha256')
    .update(`${context.idempotencyKey}:${stage}`, 'utf8')
    .digest('base64url');
  return {
    tenantId: context.tenantId,
    branchId: context.branchId,
    membershipId: context.membershipId,
    principalId: context.principalId,
    requestId: context.requestId,
    idempotencyKey: `rsv_complete_${stage}_${digest}`,
  };
}

function completionSuccess(
  context: StaffReservationCompletionContext,
  reservation: ReservationSummary,
  nextAction: 'none' | 'merchant_review' | 'payment_verification',
): ReservationReviewCommandResponse<StaffReservationCompleteResponse> {
  if (reservation.status !== 'pending_confirmation' && reservation.status !== 'confirmed') {
    throw new StateConflictError('Reservation completion response has an invalid lifecycle state.');
  }
  const data = staffReservationCompleteResponse.parse({
    reservation,
    completion_state: reservation.status,
    next_action: nextAction,
  });
  const body: SuccessEnvelope<StaffReservationCompleteResponse> = {
    success: true,
    data,
    request_id: context.requestId,
  };
  return { status: 200, body };
}
