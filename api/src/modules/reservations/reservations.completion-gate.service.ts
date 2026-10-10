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
import { lockReservationBalancePayments } from './reservations.balance.repository.js';
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
  promoteRecoveryManagedReadinessIfDue,
  truncateReturnedReservationRecovery,
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
      // The readiness staff record applies to every garment returned on this booking.
      const returnedAllocations = requireReturnedAllocations(context, allocations);
      const inspected = request.reservation_line_id
        ? returnedAllocations.filter((allocation) => allocation.reservation_line_id === request.reservation_line_id)
        : returnedAllocations;
      if (inspected.length === 0) throw new NotFoundError('That item is not on this reservation.');
      const maintenance = new Map<string, number>();
      for (const allocation of inspected) {
        const open = await lockOpenAssetMaintenance(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          assetId: allocation.asset_id,
        });
        if (request.readiness === 'ready' && open.length > 0) {
          throw new StateConflictError(
            'A garment still has open cleaning or maintenance work and cannot be marked ready.',
          );
        }
        maintenance.set(allocation.asset_id, open.length);
      }

      await client.query(`SAVEPOINT ${INSPECTION_SAVEPOINT}`);
      savepointOpen = true;
      const results: Array<{ allocation: LockedReservationAllocationRow; readiness: string; version: number; released: boolean }> = [];
      for (const allocation of inspected) {
        const openMaintenanceCount = maintenance.get(allocation.asset_id) ?? 0;
        const updated = await inspectReturnedPhysicalAsset(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          assetId: allocation.asset_id,
          assetVersion: allocation.asset_version,
          readiness: request.readiness,
          recoveryManagedReadiness:
            request.readiness === 'needs_cleaning' &&
            allocation.asset_recovery_managed_readiness &&
            openMaintenanceCount === 0 &&
            allocation.blocked_end.getTime() > reservation.database_now.getTime(),
          ...(request.condition_note ? { conditionNote: request.condition_note } : {}),
        });
        if (!updated) {
          throw new StateConflictError('A garment changed before the inspection could be recorded.');
        }
        const releasedAt =
          request.readiness === 'ready'
            ? await truncateReturnedReservationRecovery(client, {
                tenantId: context.tenantId,
                branchId: context.branchId,
                reservationId,
                assetId: allocation.asset_id,
              })
            : null;
        results.push({ allocation, readiness: updated.readiness, version: updated.version, released: Boolean(releasedAt) });
      }
      // The audit and response keep their single-garment fields for the first piece.
      const [first] = results;
      if (!first) throw new StateConflictError('Reservation inspection found no garment.');

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.return_inspected',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: {
          reservation_version: reservation.version,
          asset_id: first.allocation.asset_id,
          readiness_before: first.allocation.asset_readiness,
          readiness_after: first.readiness,
          asset_version_before: first.allocation.asset_version,
          asset_version_after: first.version,
          open_maintenance_count: maintenance.get(first.allocation.asset_id) ?? 0,
          condition_note_recorded: Boolean(request.condition_note),
          recovery_released_by_readiness: first.released,
          ...(results.length > 1 ? { asset_ids: results.map((result) => result.allocation.asset_id) } : {}),
        },
        requestId: context.requestId,
      });

      const data = reservationInspectionResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
        asset_readiness: first.readiness,
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
      const completing: LockedReservationAllocationRow[] = [];
      for (let allocation of requireReturnedAllocations(context, allocations)) {
        if (
          allocation.asset_readiness === 'needs_cleaning' &&
          allocation.asset_recovery_managed_readiness
        ) {
          const promoted = await promoteRecoveryManagedReadinessIfDue(client, {
            tenantId: context.tenantId,
            branchId: context.branchId,
            assetId: allocation.asset_id,
            assetVersion: allocation.asset_version,
          });
          if (promoted) {
            allocation = {
              ...allocation,
              asset_readiness: promoted.readiness,
              asset_recovery_managed_readiness: false,
              asset_version: promoted.version,
            };
          }
        }
        if (
          allocation.asset_lifecycle_status !== 'active' ||
          allocation.asset_readiness !== 'ready'
        ) {
          throw new AssetUnreadyError(
            'Every returned garment must pass inspection and be ready before the rental can complete.',
          );
        }
        const openMaintenance = await lockOpenAssetMaintenance(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          assetId: allocation.asset_id,
        });
        if (openMaintenance.length > 0) {
          throw new AssetUnreadyError(
            'A garment still has open cleaning or maintenance work and cannot complete yet.',
          );
        }
        completing.push(allocation);
      }
      const [allocation] = completing;
      if (!allocation) throw new StateConflictError('Reservation completion found no garment.');

      const settlement = await readReservationSettlementState(client, {
        tenantId: context.tenantId,
        reservationId,
        paymentId: payment?.payment_id ?? null,
      });
      assertSettlementComplete(reservation, payment?.status ?? null, settlement);
      const balances = await lockReservationBalancePayments(client, { tenantId: context.tenantId, reservationId });
      if (balances.some((balance) => balance.status === 'pending')) {
        throw new PaymentPrerequisiteFailedError('A balance added by an edit is still open and must be collected before completion.');
      }

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
      if (released !== completing.length) {
        throw new AssetUnavailableError(
          'Reservation completion could not safely release its blocking garment allocations.',
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
          ...(completing.length > 1 ? { asset_ids: completing.map((item) => item.asset_id) } : {}),
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

function requireReturnedAllocations(
  context: ReservationCompletionGateContext,
  allocations: LockedReservationAllocationRow[],
): LockedReservationAllocationRow[] {
  if (
    allocations.length === 0 ||
    allocations.some((allocation) => allocation.kind !== 'reservation_confirmed' || allocation.is_blocking !== true)
  ) {
    throw new AssetUnavailableError('Returned reservation garments are not all active confirmed allocations.');
  }
  if (
    allocations.some(
      (allocation) => allocation.asset_branch_id !== context.branchId || allocation.asset_custody_kind !== 'at_branch',
    )
  ) {
    throw new StateConflictError('A returned garment is not physically recorded at this branch.');
  }
  return allocations;
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
