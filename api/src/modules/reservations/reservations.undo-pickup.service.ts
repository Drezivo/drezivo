import {
  reservationUndoPickupRequest,
  reservationUndoPickupResponse,
  type ReservationUndoPickupRequest,
  type ReservationUndoPickupResponse,
} from '@drezivo/contracts';
import { withTenantTransaction } from '../../db/client.js';
import {
  ForbiddenError,
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
} from '../../shared/tenant-idempotency.js';
import { lockReservationForReview } from './reservations.review.repository.js';
import {
  requireMutationSummary,
  type ReservationPickupContext,
} from './reservations.pickup.service.js';

const operation = 'reservation.undo_pickup.v1';
type Result = {
  status: number;
  body: SuccessEnvelope<ReservationUndoPickupResponse> | FailureEnvelope;
};

/** Correct an erroneous handover without recording a physical return. */
export async function undoPickupByStaff(
  context: ReservationPickupContext,
  reservationId: string,
  input: ReservationUndoPickupRequest,
): Promise<Result> {
  const parsed = reservationUndoPickupRequest.safeParse(input);
  if (!parsed.success) throw new ValidationError('Undo pickup request is invalid.');
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...parsed.data });
  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation,
      intentKey: context.idempotencyKey,
      payloadHash,
    });
    if (claim.kind === 'replayed')
      return { status: claim.responseCode, body: claim.safeResponse as Result['body'] };
    if (claim.kind === 'key_reused')
      throw new IdempotencyKeyReusedError(
        'This Idempotency-Key was already used for another request.',
      );
    if (claim.kind === 'in_progress')
      throw new StateConflictError('An identical correction is already being processed.');
    await client.query('SAVEPOINT undo_pickup_effects');
    try {
      const reservation = await lockReservationForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      if (!reservation) throw new NotFoundError('Reservation could not be found.');
      if (reservation.version !== parsed.data.version)
        throw new StaleVersionError('Reservation version is stale. Refresh before retrying.');
      if (reservation.status !== 'picked_up')
        throw new InvalidReservationTransitionError(
          'Only a picked-up reservation can be corrected.',
        );
      const result = await client.query<{ version: number | null }>(
        'SELECT reservation_private.undo_pickup($1::uuid, $2::uuid, $3::integer, $4::text) AS version',
        [reservationId, context.branchId, parsed.data.version, context.requestId],
      );
      if (result.rows[0]?.version == null)
        throw new StateConflictError('Reservation pickup changed before correction.');
      const data = reservationUndoPickupResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
      });
      await client.query('RELEASE SAVEPOINT undo_pickup_effects');
      const body: SuccessEnvelope<ReservationUndoPickupResponse> = {
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
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT undo_pickup_effects');
      await client.query('RELEASE SAVEPOINT undo_pickup_effects');
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const failure =
        code === 'P0001' || code === '23503'
          ? new StateConflictError(
              'Pickup cannot be undone because garment custody is inconsistent.',
            )
          : code === '42501'
            ? new ForbiddenError('Reservation custody permission is required.')
            : error;
      if (!isAppError(failure)) throw failure;
      const body: FailureEnvelope = {
        success: false,
        error: { code: failure.code, message: failure.message },
        request_id: context.requestId,
      };
      await finalizeTenantIdempotency(client, {
        tenantId: context.tenantId,
        principalKey: context.membershipId,
        operation,
        intentKey: context.idempotencyKey,
        payloadHash,
        status: 'failed',
        responseCode: failure.status,
        safeResponse: body,
      });
      return { status: failure.status, body };
    }
  });
}
