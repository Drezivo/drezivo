import {
  reservationBalanceCollectRequest,
  reservationBalanceCollectResponse,
  reservationSummary,
  type ReservationBalanceCollectRequest,
  type ReservationBalanceCollectResponse,
  type ReservationSummary,
} from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import { withTenantTransaction } from '../../db/client.js';
import {
  IdempotencyKeyReusedError,
  InvalidReservationTransitionError,
  NotFoundError,
  PaymentPrerequisiteFailedError,
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
import { lockReservationBalancePayments, recordBalanceCollected } from './reservations.balance.repository.js';
import { appendReservationAuditEvent, appendReservationOutboxEvent } from './reservations.command.repository.js';
import {
  lockReservationForReview,
  readReservationMutationSummary,
  type ReservationMutationSummaryRow,
} from './reservations.review.repository.js';

const COLLECT_OPERATION = 'reservation.balance.collect.v1';
/** A balance can be collected any time before handover; pickup waits for it. */
const COLLECTABLE_STATES = new Set(['held', 'pending_confirmation', 'confirmed']);

export interface ReservationBalanceContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface ReservationBalanceCommandResponse {
  status: number;
  body: SuccessEnvelope<ReservationBalanceCollectResponse> | FailureEnvelope;
}

/**
 * Staff record that the renter paid an open balance (the amount an edit added after the first
 * payment). The payment becomes verified with its own verification decision; the reservation
 * itself does not change, so no version is required. Replays of the same key return the result.
 */
export async function collectReservationBalanceByStaff(
  context: ReservationBalanceContext,
  reservationId: string,
  paymentId: string,
  requestInput: ReservationBalanceCollectRequest,
): Promise<ReservationBalanceCommandResponse> {
  const parsed = reservationBalanceCollectRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Balance collection request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, payment_id: paymentId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: COLLECT_OPERATION,
      intentKey: context.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow(claim);
    if (replay) return replay;

    try {
      const reservation = await lockReservationForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      if (!reservation) throw new NotFoundError('Reservation could not be found.');
      if (!COLLECTABLE_STATES.has(reservation.status)) {
        throw new InvalidReservationTransitionError(`A balance cannot be collected on a reservation that is ${reservation.status.replace('_', ' ')}.`);
      }

      const balances = await lockReservationBalancePayments(client, { tenantId: context.tenantId, reservationId });
      const balance = balances.find((candidate) => candidate.payment_id === paymentId);
      if (!balance) throw new NotFoundError('This balance could not be found on the reservation.');
      if (balance.status !== 'pending') {
        throw new StateConflictError('This balance is no longer open. Refresh to see the latest payments.');
      }
      if (BigInt(request.verified_amount_minor) !== BigInt(balance.amount_minor)) {
        throw new PaymentPrerequisiteFailedError('The amount received must equal the balance due.');
      }

      const verifiedAt = await recordBalanceCollected(client, {
        tenantId: context.tenantId,
        paymentId,
        verifierMembershipId: context.membershipId,
        amountMinor: Number(balance.amount_minor),
        merchantReference: request.merchant_reference ?? null,
      });
      if (!verifiedAt) throw new StateConflictError('This balance changed while it was being recorded. Refresh and try again.');

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.balance_collected',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: { payment_id: paymentId, amount_minor: Number(balance.amount_minor) },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-balance-collected:${paymentId}`,
        eventType: 'reservation.balance_collected',
        payload: { reservationId, paymentId },
      });

      const data = reservationBalanceCollectResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
        payment_id: paymentId,
        verified_at: verifiedAt.toISOString(),
      });
      return finalize(client, context, payloadHash, { status: 200, body: { success: true, data, request_id: context.requestId } });
    } catch (error) {
      if (!isAppError(error)) throw error;
      const body: FailureEnvelope = { success: false, error: { code: error.code, message: error.message }, request_id: context.requestId };
      return finalize(client, context, payloadHash, { status: error.status, body });
    }
  });
}

async function finalize(
  client: PoolClient,
  context: ReservationBalanceContext,
  payloadHash: string,
  response: ReservationBalanceCommandResponse,
): Promise<ReservationBalanceCommandResponse> {
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: COLLECT_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: response.body.success ? 'succeeded' : 'failed',
    responseCode: response.status,
    safeResponse: response.body,
  });
  return response;
}

function replayOrThrow(claim: TenantIdempotencyClaim): ReservationBalanceCommandResponse | null {
  if (claim.kind === 'replayed') {
    return { status: claim.responseCode, body: claim.safeResponse as ReservationBalanceCommandResponse['body'] };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical balance collection is already being processed. Retry shortly.');
  }
  return null;
}

async function requireMutationSummary(
  client: PoolClient,
  context: ReservationBalanceContext,
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
