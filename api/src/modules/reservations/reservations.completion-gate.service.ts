import {
  reservationCompleteRequest,
  reservationCompleteResponse,
  reservationInspectionRequest,
  reservationInspectionResponse,
  reservationSummary,
  type ReservationCompleteRequest,
  type ReservationCompleteResponse,
  type ReservationInspectionRequest,
  type ReservationInspectionResponse,
  type ReservationSummary,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  AssetUnavailableError,
  AssetUnreadyError,
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
} from './reservations.command.repository.js';
import {
  completeReturnedReservation,
  inspectReturnedPhysicalAsset,
  lockOpenAssetMaintenance,
  lockReservationAllocationsForReview,
  lockReservationForReview,
  lockReservationPaymentForReview,
  readReservationMutationSummary,
  readReservationSettlementState,
  releaseReservationAllocations,
  type LockedReservationAllocationRow,
  type LockedReservationReviewRow,
  type ReservationMutationSummaryRow,
} from './reservations.review.repository.js';

const INSPECTION_OPERATION = 'reservation.inspect_return.v1';
const COMPLETE_OPERATION = 'reservation.complete.v1';
const INSPECTION_SAVEPOINT = 'reservation_inspection_effects';
const COMPLETE_SAVEPOINT = 'reservation_complete_effects';

export interface ReservationCompletionGateContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface ReservationInspectionCommandResponse {
  status: number;
  body: SuccessEnvelope<ReservationInspectionResponse> | FailureEnvelope;
}

export interface ReservationCompleteCommandResponse {
  status: number;
  body: SuccessEnvelope<ReservationCompleteResponse> | FailureEnvelope;
}

export async function inspectReturnedReservationByStaff(
  context: ReservationCompletionGateContext,
  reservationId: string,
  requestInput: ReservationInspectionRequest,
): Promise<ReservationInspectionCommandResponse> {
  const parsed = reservationInspectionRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation inspection request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: INSPECTION_OPERATION,
      intentKey: context.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<ReservationInspectionCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const reservation = await lockReservationForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      if (!reservation) throw new NotFoundError('Reservation could not be found.');
      assertReturnedState(reservation, request.version, 'inspected');

      const allocations = await lockReservationAllocationsForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      const allocation = requireReturnedAllocation(context, allocations);
      const openMaintenance = await lockOpenAssetMaintenance(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        assetId: allocation.asset_id,
      });
      if (request.readiness === 'ready' && openMaintenance.length > 0) {
        throw new StateConflictError(
          'The garment still has open cleaning or maintenance work and cannot be marked ready.',
        );
      }

      await client.query(`SAVEPOINT ${INSPECTION_SAVEPOINT}`);
      savepointOpen = true;
      const updated = await inspectReturnedPhysicalAsset(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        assetId: allocation.asset_id,
        assetVersion: allocation.asset_version,
        readiness: request.readiness,
        ...(request.condition_note ? { conditionNote: request.condition_note } : {}),
      });
      if (!updated) {
        throw new StateConflictError('The garment changed before the inspection could be recorded.');
      }

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.return_inspected',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: {
          reservation_version: reservation.version,
          asset_id: allocation.asset_id,
          readiness_before: allocation.asset_readiness,
          readiness_after: updated.readiness,
          asset_version_before: allocation.asset_version,
          asset_version_after: updated.version,
          open_maintenance_count: openMaintenance.length,
          condition_note_recorded: Boolean(request.condition_note),
        },
        requestId: context.requestId,
      });

      const data = reservationInspectionResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
        asset_readiness: updated.readiness,
      });
      await client.query(`RELEASE SAVEPOINT ${INSPECTION_SAVEPOINT}`);
      savepointOpen = false;
      return finalizeSuccess(client, context, INSPECTION_OPERATION, payloadHash, data);
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${INSPECTION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${INSPECTION_SAVEPOINT}`);
      }
      return finalizeKnownFailure(client, context, INSPECTION_OPERATION, payloadHash, error);
    }
  });
}

export async function completeReturnedReservationByStaff(
  context: ReservationCompletionGateContext,
  reservationId: string,
  requestInput: ReservationCompleteRequest,
): Promise<ReservationCompleteCommandResponse> {
  const parsed = reservationCompleteRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation completion request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: COMPLETE_OPERATION,
      intentKey: context.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<ReservationCompleteCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const reservation = await lockReservationForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      if (!reservation) throw new NotFoundError('Reservation could not be found.');
      assertReturnedState(reservation, request.version, 'completed');

      const payment = reservation.due_now_minor > 0
        ? await lockReservationPaymentForReview(client, {
            tenantId: context.tenantId,
            reservationId,
          })
        : null;
      const allocations = await lockReservationAllocationsForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      const allocation = requireReturnedAllocation(context, allocations);
      if (
        allocation.asset_lifecycle_status !== 'active' ||
        allocation.asset_readiness !== 'ready'
      ) {
        throw new AssetUnreadyError(
          'The returned garment must pass inspection and be ready before the rental can complete.',
        );
      }
      const openMaintenance = await lockOpenAssetMaintenance(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        assetId: allocation.asset_id,
      });
      if (openMaintenance.length > 0) {
        throw new AssetUnreadyError(
          'The garment still has open cleaning or maintenance work and cannot complete yet.',
        );
      }

      const settlement = await readReservationSettlementState(client, {
        tenantId: context.tenantId,
        reservationId,
        paymentId: payment?.payment_id ?? null,
      });
      assertSettlementComplete(reservation, payment?.status ?? null, settlement);

      await client.query(`SAVEPOINT ${COMPLETE_SAVEPOINT}`);
      savepointOpen = true;
      const newVersion = await completeReturnedReservation(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
        version: request.version,
      });
      if (newVersion === null) {
        throw new StateConflictError('Reservation completion lost a concurrent state change.');
      }
      const released = await releaseReservationAllocations(client, {
        tenantId: context.tenantId,
        reservationId,
      });
      if (released !== 1) {
        throw new AssetUnavailableError(
          'Reservation completion could not safely release its blocking garment allocation.',
        );
      }

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.completed',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: {
          version: newVersion,
          asset_id: allocation.asset_id,
          allocation_id: allocation.allocation_id,
          payment_status: payment?.status ?? null,
          outstanding_charge_minor: settlement.outstanding_charge_minor,
          deposit_holding_minor: settlement.deposit_holding_minor,
          pending_refund_count: settlement.pending_refund_count,
        },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-completed:${reservationId}:${newVersion}`,
        eventType: 'reservation.completed',
        payload: {
          reservationId,
          reservationVersion: newVersion,
          assetId: allocation.asset_id,
        },
      });

      const data = reservationCompleteResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
      });
      await client.query(`RELEASE SAVEPOINT ${COMPLETE_SAVEPOINT}`);
      savepointOpen = false;
      return finalizeSuccess(client, context, COMPLETE_OPERATION, payloadHash, data);
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${COMPLETE_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${COMPLETE_SAVEPOINT}`);
      }
      return finalizeKnownFailure(client, context, COMPLETE_OPERATION, payloadHash, error);
    }
  });
}

function assertReturnedState(
  reservation: LockedReservationReviewRow,
  version: number,
  action: 'inspected' | 'completed',
): void {
  if (reservation.version !== version) {
    throw new StaleVersionError('Reservation version is stale. Refresh before retrying.');
  }
  if (reservation.status !== 'returned') {
    throw new InvalidReservationTransitionError(
      `Reservation cannot be ${action} from ${reservation.status}.`,
    );
  }
}

function requireReturnedAllocation(
  context: ReservationCompletionGateContext,
  allocations: LockedReservationAllocationRow[],
): LockedReservationAllocationRow {
  const allocation = allocations[0];
  if (
    allocations.length !== 1 ||
    !allocation ||
    allocation.kind !== 'reservation_confirmed' ||
    allocation.is_blocking !== true
  ) {
    throw new AssetUnavailableError(
      'Returned reservation does not have exactly one active confirmed garment allocation.',
    );
  }
  if (
    allocation.asset_branch_id !== context.branchId ||
    allocation.asset_custody_kind !== 'at_branch'
  ) {
    throw new StateConflictError('The returned garment is not physically recorded at this branch.');
  }
  return allocation;
}

function assertSettlementComplete(
  reservation: LockedReservationReviewRow,
  paymentStatus: string | null,
  settlement: {
    pending_refund_count: number;
    outstanding_charge_minor: number;
    deposit_holding_minor: number;
  },
): void {
  if (
    reservation.due_now_minor > 0 &&
    paymentStatus !== 'paid' &&
    paymentStatus !== 'refunded'
  ) {
    throw new PaymentPrerequisiteFailedError(
      'The reservation still has unresolved collection state and cannot complete.',
    );
  }
  if (settlement.outstanding_charge_minor > 0) {
    throw new PaymentPrerequisiteFailedError(
      'Posted rental, delivery, late, or damage charges are not fully settled.',
    );
  }
  if (settlement.deposit_holding_minor > 0) {
    throw new PaymentPrerequisiteFailedError(
      'Security deposit holding must be released or applied before completion.',
    );
  }
  if (settlement.pending_refund_count > 0) {
    throw new PaymentPrerequisiteFailedError(
      'A refund instruction is still pending or processing.',
    );
  }
}

async function requireMutationSummary(
  client: Parameters<typeof readReservationMutationSummary>[0],
  context: ReservationCompletionGateContext,
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

function replayOrThrow<T extends ReservationInspectionCommandResponse | ReservationCompleteCommandResponse>(
  claim: TenantIdempotencyClaim,
): T | null {
  if (claim.kind === 'replayed') {
    return {
      status: claim.responseCode,
      body: claim.safeResponse,
    } as T;
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical reservation operation is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeSuccess<T>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: ReservationCompletionGateContext,
  operation: string,
  payloadHash: string,
  data: T,
): Promise<{ status: number; body: SuccessEnvelope<T> }> {
  const body: SuccessEnvelope<T> = {
    success: true,
    data,
    request_id: context.requestId,
  };
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

async function finalizeKnownFailure<T extends ReservationInspectionCommandResponse | ReservationCompleteCommandResponse>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: ReservationCompletionGateContext,
  operation: string,
  payloadHash: string,
  error: unknown,
): Promise<T> {
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
  return { status: error.status, body } as T;
}
