import {
  reservationCancelRequest,
  reservationCancelResponse,
  reservationSummary,
  type ReservationCancelRequest,
  type ReservationCancelResponse,
  type ReservationSummary,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  HoldExpiredError,
  IdempotencyKeyReusedError,
  InvalidReservationTransitionError,
  NotFoundError,
  StaleVersionError,
  StateConflictError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import { resolveReservationCancellationCustomer } from './reservations.customer.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
  type TenantIdempotencyClaim,
} from '../../shared/tenant-idempotency.js';
import {
  appendReservationAuditEvent,
  appendReservationOutboxEvent,
} from './reservations.command.repository.js';
import {
  cancelReservationPreHandover,
  expireReservationReview,
  lockReservationAllocationsForReview,
  lockReservationForReview,
  lockReservationPaymentForReview,
  readReservationLineCountForReview,
  readReservationMutationSummary,
  releaseReservationAllocations,
  type LockedReservationReviewRow,
  type ReservationMutationSummaryRow,
} from './reservations.review.repository.js';

const CANCEL_OPERATION = 'reservation.cancel.v1';
const CANCELLATION_SAVEPOINT = 'reservation_cancellation_effects';
const EXPIRY_SAVEPOINT = 'reservation_cancellation_expiry';

export interface ReservationCancellationContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface ReservationCancellationCommandResponse {
  status: number;
  body: SuccessEnvelope<ReservationCancelResponse> | FailureEnvelope;
}

export async function cancelReservationByStaff(
  context: ReservationCancellationContext,
  reservationId: string,
  requestInput: ReservationCancelRequest,
): Promise<ReservationCancellationCommandResponse> {
  const parsed = reservationCancelRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation cancellation request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: CANCEL_OPERATION,
      intentKey: context.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const reservation = await lockReservationForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      if (!reservation) throw new NotFoundError('Reservation could not be found.');
      assertCancellationState(reservation, request.version);

      const payment = await lockReservationPaymentForReview(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      const allocations = await lockReservationAllocationsForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      const reservationLineCount = await readReservationLineCountForReview(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      assertCancellableAllocation(reservation, allocations, reservationLineCount);
      if (request.customer && reservation.status !== 'held') {
        throw new ValidationError('Customer details can only be saved while cancelling an unfinished hold.');
      }

      if (
        (reservation.status === 'held' || reservation.status === 'pending_confirmation') &&
        deadlineElapsed(reservation)
      ) {
        await expireInsteadOfCancel(
          client,
          context,
          reservation,
          reservationId,
          allocations.filter((allocation) => allocation.is_blocking).length,
        );
        throw new HoldExpiredError('This reservation expired before cancellation completed.');
      }

      await client.query(`SAVEPOINT ${CANCELLATION_SAVEPOINT}`);
      savepointOpen = true;
      const customer = request.customer
        ? await resolveReservationCancellationCustomer(client, context.tenantId, request.customer)
        : null;
      if (customer && reservation.customer_id && customer.id !== reservation.customer_id) {
        throw new StateConflictError('A different customer is already attached to this reservation.');
      }
      const newVersion = await cancelReservationPreHandover(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
        version: request.version,
        ...(customer
          ? {
              customerId: customer.id,
              customerSnapshot: {
                full_name: customer.full_name,
                phone: customer.phone,
                email: customer.email,
                address: customer.address,
              },
            }
          : {}),
      });
      if (newVersion === null) {
        throw new StateConflictError('Reservation cancellation lost a concurrent state change.');
      }
      const released = await releaseReservationAllocations(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      if (released !== allocations.filter((allocation) => allocation.is_blocking).length) {
        throw new StateConflictError('Reservation allocation changed during cancellation.');
      }

      const financialFollowupRequired =
        payment !== null &&
        (payment.status === 'partially_paid' || payment.status === 'paid' || payment.verified_at !== null);
      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.cancelled',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: {
          version: newVersion,
          previous_status: reservation.status,
          cancellation_reason: request.reason ?? null,
          customer_saved: customer !== null,
          payment_status: payment?.status ?? null,
          financial_followup_required: financialFollowupRequired,
        },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-cancelled:${reservationId}:${newVersion}`,
        eventType: 'reservation.cancelled',
        payload: {
          reservationId,
          reservationVersion: newVersion,
          financialFollowupRequired,
        },
      });

      const data = reservationCancelResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
      });
      await client.query(`RELEASE SAVEPOINT ${CANCELLATION_SAVEPOINT}`);
      savepointOpen = false;
      return finalizeSuccess(client, context, payloadHash, data);
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${CANCELLATION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${CANCELLATION_SAVEPOINT}`);
      }
      return finalizeKnownFailure(client, context, payloadHash, error);
    }
  });
}

function assertCancellationState(reservation: LockedReservationReviewRow, version: number): void {
  if (reservation.version !== version) {
    throw new StaleVersionError('Reservation version is stale. Refresh before retrying.');
  }
  if (!['held', 'pending_confirmation', 'confirmed'].includes(reservation.status)) {
    throw new InvalidReservationTransitionError(
      `Reservation cannot be cancelled from ${reservation.status}.`,
    );
  }
}

function assertCancellableAllocation(
  reservation: LockedReservationReviewRow,
  allocations: Awaited<ReturnType<typeof lockReservationAllocationsForReview>>,
  reservationLineCount: number,
): void {
  const expectedKind = reservation.status === 'confirmed' ? 'reservation_confirmed' : 'reservation_hold';
  const blocking = allocations.filter((allocation) => allocation.is_blocking);
  const blockingLines = new Set(blocking.map((allocation) => allocation.reservation_line_id));
  if (
    reservationLineCount < 1 ||
    blocking.length !== reservationLineCount ||
    blockingLines.size !== reservationLineCount ||
    blocking.some((allocation) => allocation.kind !== expectedKind)
  ) {
    throw new StateConflictError('Every reservation line must have exactly one cancellable blocking allocation.');
  }
}

function deadlineElapsed(reservation: LockedReservationReviewRow): boolean {
  return (
    reservation.hold_expires_at === null ||
    reservation.hold_expires_at.getTime() <= reservation.database_now.getTime()
  );
}

async function expireInsteadOfCancel(
  client: Parameters<typeof expireReservationReview>[0],
  context: ReservationCancellationContext,
  reservation: LockedReservationReviewRow,
  reservationId: string,
  blockingAllocationCount: number,
): Promise<void> {
  await client.query(`SAVEPOINT ${EXPIRY_SAVEPOINT}`);
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
    if (released !== blockingAllocationCount) {
      throw new StateConflictError('Reservation expiry could not release every allocation.');
    }
    await appendReservationAuditEvent(client, {
      tenantId: context.tenantId,
      actorKind: 'system',
      actorKey: 'system:reservation-expiry',
      action: 'reservation.expired',
      entityType: 'reservation',
      entityId: reservationId,
      redactedSummary: { reason: 'deadline_elapsed_before_cancellation', version: newVersion },
      requestId: context.requestId,
    });
    await appendReservationOutboxEvent(client, {
      tenantId: context.tenantId,
      dedupeKey: `reservation-expired:${reservationId}:${newVersion}`,
      eventType: 'reservation.hold_expired',
      payload: { reservationId, reservationVersion: newVersion },
    });
    await client.query(`RELEASE SAVEPOINT ${EXPIRY_SAVEPOINT}`);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${EXPIRY_SAVEPOINT}`);
    await client.query(`RELEASE SAVEPOINT ${EXPIRY_SAVEPOINT}`);
    throw error;
  }
}

async function requireMutationSummary(
  client: Parameters<typeof readReservationMutationSummary>[0],
  context: ReservationCancellationContext,
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

function replayOrThrow(claim: TenantIdempotencyClaim): ReservationCancellationCommandResponse | null {
  if (claim.kind === 'replayed') {
    return {
      status: claim.responseCode,
      body: claim.safeResponse as ReservationCancellationCommandResponse['body'],
    };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical reservation cancellation is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeSuccess(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: ReservationCancellationContext,
  payloadHash: string,
  data: ReservationCancelResponse,
): Promise<ReservationCancellationCommandResponse> {
  const body: SuccessEnvelope<ReservationCancelResponse> = {
    success: true,
    data,
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: CANCEL_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'succeeded',
    responseCode: 200,
    safeResponse: body,
  });
  return { status: 200, body };
}

async function finalizeKnownFailure(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: ReservationCancellationContext,
  payloadHash: string,
  error: unknown,
): Promise<ReservationCancellationCommandResponse> {
  if (!isAppError(error)) throw error;
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: CANCEL_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}
