import {
  reservationPickupRequest,
  reservationPickupResponse,
  reservationSummary,
  type ReservationPickupRequest,
  type ReservationPickupResponse,
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
  appendPickupCustodyEvent,
  lockLatestReservationReceipt,
  lockReservationAllocationsForReview,
  lockReservationForReview,
  lockReservationPaymentForReview,
  markPhysicalAssetPickedUp,
  pickupReservationHandover,
  promoteRecoveryManagedReadinessIfDue,
  readLatestReservationVerification,
  readReservationMutationSummary,
  type LockedReservationAllocationRow,
  type LockedReservationPaymentRow,
  type LockedReservationReceiptRow,
  type LockedReservationReviewRow,
  type ReservationMutationSummaryRow,
  type ReservationVerificationRow,
} from './reservations.review.repository.js';

const PICKUP_OPERATION = 'reservation.pickup.v1';
const PICKUP_SAVEPOINT = 'reservation_pickup_effects';

export interface ReservationPickupContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface ReservationPickupCommandResponse {
  status: number;
  body: SuccessEnvelope<ReservationPickupResponse> | FailureEnvelope;
}

export async function pickupReservationByStaff(
  context: ReservationPickupContext,
  reservationId: string,
  requestInput: ReservationPickupRequest,
): Promise<ReservationPickupCommandResponse> {
  const parsed = reservationPickupRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Reservation pickup request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: PICKUP_OPERATION,
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
      assertPickupState(reservation, request.version);

      const payment = reservation.due_now_minor > 0
        ? await lockReservationPaymentForReview(client, {
            tenantId: context.tenantId,
            reservationId,
          })
        : null;
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

      let allocation = requirePickupAllocation(context, allocations);
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
      assertPickupAssetReady(context, allocation);
      assertPickupPolicyPrerequisites(reservation);
      assertPickupPaymentPrerequisites(reservation, payment, receipt, verification);

      await client.query(`SAVEPOINT ${PICKUP_SAVEPOINT}`);
      savepointOpen = true;

      const newReservationVersion = await pickupReservationHandover(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
        version: request.version,
      });
      if (newReservationVersion === null) {
        throw new StateConflictError('Reservation pickup lost a concurrent state change.');
      }

      const newAssetVersion = await markPhysicalAssetPickedUp(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        assetId: allocation.asset_id,
        assetVersion: allocation.asset_version,
      });
      if (newAssetVersion === null) {
        throw new AssetUnreadyError('The garment is no longer ready and physically present for pickup.');
      }

      const custodyEventId = await appendPickupCustodyEvent(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        assetId: allocation.asset_id,
        reservationLineId: allocation.reservation_line_id,
        actorMembershipId: context.membershipId,
        businessKey: `reservation:${reservationId}:pickup`,
        conditionSnapshot: {
          condition_note: request.condition_note ?? null,
          readiness_at_handover: allocation.asset_readiness,
          custody_before: allocation.asset_custody_kind,
          asset_version_before: allocation.asset_version,
          asset_version_after: newAssetVersion,
        },
      });
      if (!custodyEventId) {
        throw new StateConflictError('Pickup custody was already recorded for this reservation.');
      }

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.picked_up',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: {
          version: newReservationVersion,
          asset_id: allocation.asset_id,
          custody_event_id: custodyEventId,
        },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-picked-up:${reservationId}:${newReservationVersion}`,
        eventType: 'reservation.picked_up',
        payload: {
          reservationId,
          reservationVersion: newReservationVersion,
          assetId: allocation.asset_id,
        },
      });

      const data = reservationPickupResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
      });
      await client.query(`RELEASE SAVEPOINT ${PICKUP_SAVEPOINT}`);
      savepointOpen = false;
      return finalizeSuccess(client, context, payloadHash, data);
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${PICKUP_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${PICKUP_SAVEPOINT}`);
      }
      return finalizeKnownFailure(client, context, payloadHash, error);
    }
  });
}

function assertPickupState(reservation: LockedReservationReviewRow, version: number): void {
  if (reservation.version !== version) {
    throw new StaleVersionError('Reservation version is stale. Refresh before retrying.');
  }
  if (reservation.status !== 'confirmed') {
    throw new InvalidReservationTransitionError(
      `Reservation cannot be picked up from ${reservation.status}.`,
    );
  }
}

function requirePickupAllocation(
  context: ReservationPickupContext,
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
      'Reservation does not have exactly one active confirmed garment allocation.',
    );
  }
  if (allocation.asset_branch_id !== context.branchId) {
    throw new AssetUnreadyError('The allocated garment is not physically assigned to this branch.');
  }
  return allocation;
}

function assertPickupAssetReady(
  context: ReservationPickupContext,
  allocation: LockedReservationAllocationRow,
): void {
  if (
    allocation.asset_branch_id !== context.branchId ||
    allocation.asset_lifecycle_status !== 'active' ||
    allocation.asset_readiness !== 'ready' ||
    allocation.asset_custody_kind !== 'at_branch'
  ) {
    throw new AssetUnreadyError('The garment is not ready and physically present for pickup.');
  }
}

function assertPickupPolicyPrerequisites(reservation: LockedReservationReviewRow): void {
  if (
    reservation.customer_snapshot === null ||
    reservation.terms_accepted_at === null ||
    reservation.confirmed_at === null
  ) {
    throw new StateConflictError('Confirmed reservation policy prerequisites are incomplete.');
  }
}

function assertPickupPaymentPrerequisites(
  reservation: LockedReservationReviewRow,
  payment: LockedReservationPaymentRow | null,
  receipt: LockedReservationReceiptRow | null,
  verification: ReservationVerificationRow | null,
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
    throw new PaymentPrerequisiteFailedError('Verified merchant collection is required before pickup.');
  }
  if (
    !verification ||
    verification.decision !== 'verified' ||
    verification.verified_amount_minor === null ||
    verification.verified_amount_minor < reservation.due_now_minor
  ) {
    throw new PaymentPrerequisiteFailedError('A verified merchant decision is required before pickup.');
  }
  if (payment.rail === 'cash') return;
  // Staff manual verification is the authoritative proof of collection for manual-payment rails.
  // Uploaded evidence is optional for staff-created reservations, but when it exists it must still
  // be accepted, immutable, and verified before physical handover.
  if (!receipt) return;
  if (receipt.evidence_status !== 'verified' || !isImmutableAcceptedReceipt(receipt)) {
    throw new PaymentPrerequisiteFailedError(
      'Uploaded payment evidence must be verified before pickup.',
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

async function requireMutationSummary(
  client: Parameters<typeof readReservationMutationSummary>[0],
  context: ReservationPickupContext,
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

function replayOrThrow(claim: TenantIdempotencyClaim): ReservationPickupCommandResponse | null {
  if (claim.kind === 'replayed') {
    return {
      status: claim.responseCode,
      body: claim.safeResponse as ReservationPickupCommandResponse['body'],
    };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical reservation pickup is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeSuccess(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: ReservationPickupContext,
  payloadHash: string,
  data: ReservationPickupResponse,
): Promise<ReservationPickupCommandResponse> {
  const body: SuccessEnvelope<ReservationPickupResponse> = {
    success: true,
    data,
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: PICKUP_OPERATION,
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
  context: ReservationPickupContext,
  payloadHash: string,
  error: unknown,
): Promise<ReservationPickupCommandResponse> {
  if (!isAppError(error)) throw error;
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: PICKUP_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}
