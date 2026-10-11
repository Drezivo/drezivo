import {
  reservationEditRequest,
  reservationEditResponse,
  reservationSummary,
  type ReservationEditRequestInput,
  type ReservationEditResponse,
  type ReservationSummary,
} from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import { withTenantTransaction } from '../../db/client.js';
import {
  IdempotencyKeyReusedError,
  InvalidReservationTransitionError,
  NotFoundError,
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
} from './reservations.command.repository.js';
import { applyReservationCustomerEdit } from './reservations.edit.repository.js';
import {
  lockReservationForReview,
  readReservationMutationSummary,
  type LockedReservationReviewRow,
  type ReservationMutationSummaryRow,
} from './reservations.review.repository.js';

const EDIT_OPERATION = 'reservation.edit.v2';
const EDIT_SAVEPOINT = 'reservation_edit_effects';

export interface ReservationEditContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface ReservationEditCommandResponse {
  status: number;
  body: SuccessEnvelope<ReservationEditResponse> | FailureEnvelope;
}

/** Correct the customer snapshot on a confirmed booking without changing its profile or terms. */
export async function editReservationByStaff(
  context: ReservationEditContext,
  reservationId: string,
  requestInput: ReservationEditRequestInput,
): Promise<ReservationEditCommandResponse> {
  const parsed = reservationEditRequest.safeParse(requestInput);
  if (!parsed.success)
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'Reservation edit request is invalid.',
    );
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: EDIT_OPERATION,
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
      assertEditableState(reservation, request.version);
      if (reservation.customer_snapshot === null) {
        throw new ValidationError('This reservation has no saved customer details to edit.');
      }

      await client.query(`SAVEPOINT ${EDIT_SAVEPOINT}`);
      savepointOpen = true;

      const newVersion = await applyReservationCustomerEdit(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
        version: request.version,
        customerSnapshot: {
          full_name: request.customer.full_name,
          phone: request.customer.phone,
          email: request.customer.email?.toLowerCase() ?? null,
          address: request.customer.address,
        },
      });
      if (newVersion === null)
        throw new StateConflictError(
          'Reservation edit lost a concurrent change. Refresh and try again.',
        );

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.edited',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: { version: newVersion, changed: ['customer'] },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-edited:${reservationId}:${newVersion}`,
        eventType: 'reservation.edited',
        payload: { reservationId, reservationVersion: newVersion, changed: ['customer'] },
      });

      const data = reservationEditResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
      });
      const response = await finalizeSuccess(client, context, payloadHash, data);
      await client.query(`RELEASE SAVEPOINT ${EDIT_SAVEPOINT}`);
      savepointOpen = false;
      return response;
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${EDIT_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${EDIT_SAVEPOINT}`);
      }
      return finalizeKnownFailure(client, context, payloadHash, error);
    }
  });
}

function assertEditableState(reservation: LockedReservationReviewRow, version: number): void {
  if (reservation.version !== version) {
    throw new StaleVersionError('Reservation version is stale. Refresh before retrying.');
  }
  if (reservation.status !== 'confirmed') {
    throw new InvalidReservationTransitionError(
      `Only confirmed reservations can be edited. This one is ${reservation.status.replace('_', ' ')}.`,
    );
  }
}

async function requireMutationSummary(
  client: PoolClient,
  context: ReservationEditContext,
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

function replayOrThrow(claim: TenantIdempotencyClaim): ReservationEditCommandResponse | null {
  if (claim.kind === 'replayed') {
    return {
      status: claim.responseCode,
      body: claim.safeResponse as ReservationEditCommandResponse['body'],
    };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError(
      'This Idempotency-Key was already used for another request.',
    );
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError(
      'An identical reservation edit is already being processed. Retry shortly.',
    );
  }
  return null;
}

async function finalizeSuccess(
  client: PoolClient,
  context: ReservationEditContext,
  payloadHash: string,
  data: ReservationEditResponse,
): Promise<ReservationEditCommandResponse> {
  const body: SuccessEnvelope<ReservationEditResponse> = {
    success: true,
    data,
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: EDIT_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'succeeded',
    responseCode: 200,
    safeResponse: body,
  });
  return { status: 200, body };
}

async function finalizeKnownFailure(
  client: PoolClient,
  context: ReservationEditContext,
  payloadHash: string,
  error: unknown,
): Promise<ReservationEditCommandResponse> {
  if (!isAppError(error)) throw error;
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: EDIT_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}
