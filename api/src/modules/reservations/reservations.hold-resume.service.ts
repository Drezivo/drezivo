import { staffReservationCreateResponse, type StaffReservationCreateResponse } from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import { StateConflictError } from '../../shared/errors.js';
import { toPaymentInstructions } from './reservations.command.service.js';
import { readReservationReviewSummary, type ReservationReviewReadContext } from './reservations.review.service.js';

/**
 * GET /reservations/:id/hold — what the business app's reservation sheet needs to reopen a live
 * staff hold after a refresh or navigation (app pending-hold guard). Same shape as the create
 * response. Read-only; 409 once the hold is completed, cancelled, or expired, so the app stops
 * showing it.
 */
export async function readStaffReservationHold(
  context: ReservationReviewReadContext,
  reservationId: string,
): Promise<StaffReservationCreateResponse> {
  const reservation = await readReservationReviewSummary(context, reservationId);
  const live = reservation.status === 'held' && reservation.hold_expires_at !== null && Date.parse(reservation.hold_expires_at) > Date.now();
  if (!live) throw new StateConflictError('This reservation is no longer on hold.');

  const snapshot = await withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const method = await client.query<{ name: string; rail: 'cash' | 'manual_qr' | 'manual_transfer'; destination_snapshot: Record<string, unknown> }>(
      'SELECT name, rail, destination_snapshot FROM payment_method WHERE tenant_id = $1 AND id = $2',
      [context.tenantId, reservation.payment_method_id],
    );
    return method.rows[0] ?? null;
  });
  if (!snapshot) throw new StateConflictError('The payment method for this hold is no longer available.');
  return staffReservationCreateResponse.parse({ reservation, payment_instructions: toPaymentInstructions(snapshot) });
}
