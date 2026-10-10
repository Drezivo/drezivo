import {
  reservationReturnRequest,
  reservationReturnResponse,
  reservationSummary,
  type ReservationReturnRequest,
  type ReservationReturnResponse,
  type ReservationSummary,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import { custodyBusinessKey } from './reservations.pickup.service.js';
import {
  AssetUnavailableError,
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
import {
  appendReturnCustodyEvent,
  createOrUpdateReturnDisruptions,
  lockReservationAllocationsForReview,
  lockReservationForReview,
  markPhysicalAssetReturned,
  readReservationMutationSummary,
  returnReservationCustody,
  type LockedReservationAllocationRow,
  type LockedReservationReviewRow,
  type ReservationMutationSummaryRow,
} from './reservations.review.repository.js';

const RETURN_OPERATION = 'reservation.return.v1';
const RETURN_SAVEPOINT = 'reservation_return_effects';

export interface ReservationReturnContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface ReservationReturnCommandResponse {
  status: number;
  body: SuccessEnvelope<ReservationReturnResponse> | FailureEnvelope;
}

export async function returnReservationByStaff(
  context: ReservationReturnContext,
  reservationId: string,
  requestInput: ReservationReturnRequest,
): Promise<ReservationReturnCommandResponse> {
  const parsed = reservationReturnRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation return request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: RETURN_OPERATION,
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
      assertReturnState(reservation, request.version);

      const allocations = await lockReservationAllocationsForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      const returning = requireReturnAllocations(context, allocations);

      await client.query(`SAVEPOINT ${RETURN_SAVEPOINT}`);
      savepointOpen = true;

      const newReservationVersion = await returnReservationCustody(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
        version: request.version,
      });
      if (newReservationVersion === null) {
        throw new StateConflictError('Reservation return lost a concurrent state change.');
      }

      // Every garment comes back together; each one gets its own custody fact and readiness.
      const returned: Array<{ assetId: string; custodyEventId: string; occurredAt: Date; readiness: string }> = [];
      let disruptionsAffected = 0;
      for (const allocation of returning) {
        const returnedAsset = await markPhysicalAssetReturned(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          assetId: allocation.asset_id,
          assetVersion: allocation.asset_version,
          recoveryManagedReadiness:
            reservation.database_now.getTime() <= reservation.due_at.getTime() &&
            allocation.blocked_end.getTime() > reservation.database_now.getTime() &&
            allocation.blocked_end.getTime() > reservation.due_at.getTime(),
          ...(request.condition_note ? { conditionNote: request.condition_note } : {}),
        });
        if (!returnedAsset) {
          throw new StateConflictError('A garment custody changed before return could be recorded.');
        }

        const custodyEvent = await appendReturnCustodyEvent(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          assetId: allocation.asset_id,
          reservationLineId: allocation.reservation_line_id,
          actorMembershipId: context.membershipId,
          businessKey: custodyBusinessKey(reservationId, 'return', allocation, returning.length),
          conditionSnapshot: {
            condition_note: request.condition_note ?? null,
            readiness_before: allocation.asset_readiness,
            readiness_after: returnedAsset.readiness,
            custody_before: allocation.asset_custody_kind,
            custody_after: 'at_branch',
            asset_version_before: allocation.asset_version,
            asset_version_after: returnedAsset.version,
          },
        });
        if (!custodyEvent) {
          throw new StateConflictError('Return custody was already recorded for this reservation.');
        }

        disruptionsAffected += await createOrUpdateReturnDisruptions(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          assetId: allocation.asset_id,
          currentReservationLineId: allocation.reservation_line_id,
          custodyEventId: custodyEvent.id,
          occurredAt: custodyEvent.occurred_at,
        });
        returned.push({
          assetId: allocation.asset_id,
          custodyEventId: custodyEvent.id,
          occurredAt: custodyEvent.occurred_at,
          readiness: returnedAsset.readiness,
        });
      }
      const [firstReturned] = returned;
      if (!firstReturned) throw new StateConflictError('Reservation return found no garment.');
      const lateReturn = firstReturned.occurredAt.getTime() > reservation.due_at.getTime();

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.returned',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: {
          version: newReservationVersion,
          asset_id: firstReturned.assetId,
          custody_event_id: firstReturned.custodyEventId,
          late_return: lateReturn,
          disruptions_affected: disruptionsAffected,
          readiness_after_return: firstReturned.readiness,
          ...(returned.length > 1
            ? {
                asset_ids: returned.map((item) => item.assetId),
                custody_event_ids: returned.map((item) => item.custodyEventId),
              }
            : {}),
        },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-returned:${reservationId}:${newReservationVersion}`,
        eventType: 'reservation.returned',
        payload: {
          reservationId,
          reservationVersion: newReservationVersion,
          assetId: firstReturned.assetId,
          ...(returned.length > 1 ? { assetIds: returned.map((item) => item.assetId) } : {}),
          lateReturn,
          disruptionsAffected,
        },
      });

      const data = reservationReturnResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
      });
      await client.query(`RELEASE SAVEPOINT ${RETURN_SAVEPOINT}`);
      savepointOpen = false;
      return finalizeSuccess(client, context, payloadHash, data);
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${RETURN_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${RETURN_SAVEPOINT}`);
      }
      return finalizeKnownFailure(client, context, payloadHash, error);
    }
  });
}

function assertReturnState(reservation: LockedReservationReviewRow, version: number): void {
  if (reservation.version !== version) {
    throw new StaleVersionError('Reservation version is stale. Refresh before retrying.');
  }
  if (reservation.status !== 'picked_up') {
    throw new InvalidReservationTransitionError(
      `Reservation cannot be returned from ${reservation.status}.`,
    );
  }
}

function requireReturnAllocations(
  context: ReservationReturnContext,
  allocations: LockedReservationAllocationRow[],
): LockedReservationAllocationRow[] {
  if (
    allocations.length === 0 ||
    allocations.some((allocation) => allocation.kind !== 'reservation_confirmed' || allocation.is_blocking !== true)
  ) {
    throw new AssetUnavailableError('Reservation garments are not all active confirmed allocations.');
  }
  if (
    allocations.some(
      (allocation) => allocation.asset_branch_id !== context.branchId || allocation.asset_custody_kind !== 'with_customer',
    )
  ) {
    throw new StateConflictError('A garment on this reservation is not currently recorded with the customer.');
  }
  return allocations;
}

async function requireMutationSummary(
  client: Parameters<typeof readReservationMutationSummary>[0],
  context: ReservationReturnContext,
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

function replayOrThrow(claim: TenantIdempotencyClaim): ReservationReturnCommandResponse | null {
  if (claim.kind === 'replayed') {
    return {
      status: claim.responseCode,
      body: claim.safeResponse as ReservationReturnCommandResponse['body'],
    };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical reservation return is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeSuccess(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: ReservationReturnContext,
  payloadHash: string,
  data: ReservationReturnResponse,
): Promise<ReservationReturnCommandResponse> {
  const body: SuccessEnvelope<ReservationReturnResponse> = {
    success: true,
    data,
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: RETURN_OPERATION,
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
  context: ReservationReturnContext,
  payloadHash: string,
  error: unknown,
): Promise<ReservationReturnCommandResponse> {
  if (!isAppError(error)) throw error;
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: RETURN_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}
