import {
  reservationListItem,
  reservationListResponse,
  reservationPaymentProjection,
  type PermissionCode,
  type ReservationListItem,
  type ReservationListQuery,
  type ReservationListResponse,
  type ReservationPaymentProjection,
  type TenantStatus,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  ForbiddenError,
  StateConflictError,
  TenantCancelledError,
} from '../../shared/errors.js';
import { listReservationsReadModel, type ReservationListReadRow } from './reservations.repository.js';

interface ReservationReadContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
}

export type ReservationHoldResult = { kind: 'not_implemented' };

/** Reservation holds remain disabled until the transactional hold service is approved. */
export function createPublicHold(): ReservationHoldResult {
  return { kind: 'not_implemented' };
}

/** Staff reservation list read used by the Reservations operations page. */
export async function getReservationList(
  input: ReservationReadContext,
  query: ReservationListQuery,
): Promise<ReservationListResponse> {
  assertReservationReadContext(input);

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const page = await listReservationsReadModel(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      query,
    });

    return reservationListResponse.parse({
      items: page.rows.map(toReservationListItem),
      page_meta: {
        next_cursor: page.nextCursor,
        has_more: page.hasMore,
      },
    });
  });
}

function toReservationListItem(row: ReservationListReadRow): ReservationListItem {
  if (
    !row.line_id ||
    !row.variant_id ||
    !row.line_name_snapshot ||
    row.line_rental_minor === null ||
    row.line_deposit_minor === null ||
    !row.line_currency ||
    !row.fulfillment_method
  ) {
    throw new StateConflictError('Reservation data is incomplete for staff display.');
  }

  const payment = row.payment_id ? toPaymentProjection(row) : null;
  const customerSnapshot = row.customer_full_name
    ? {
        full_name: row.customer_full_name,
        phone: row.customer_phone,
        email: row.customer_email,
      }
    : null;

  return reservationListItem.parse({
    id: row.reservation_id,
    reference_code: row.reference_code,
    status: row.reservation_status,
    customer: {
      customer_id: row.customer_id,
      snapshot: customerSnapshot,
    },
    line: {
      id: row.line_id,
      variant_id: row.variant_id,
      name_snapshot: row.line_name_snapshot,
      rental_minor: String(row.line_rental_minor),
      deposit_minor: String(row.line_deposit_minor),
      currency: row.line_currency,
    },
    fulfillment_method: row.fulfillment_method,
    pickup_at: row.pickup_at.toISOString(),
    due_at: row.due_at.toISOString(),
    price_snapshot: {
      rental_total_minor: String(row.rental_total_minor),
      security_required_minor: String(row.security_required_minor),
      due_now_minor: String(row.due_now_minor),
      currency: row.reservation_currency,
    },
    payment,
    version: row.version,
    created_at: row.created_at.toISOString(),
  });
}

function toPaymentProjection(row: ReservationListReadRow): ReservationPaymentProjection {
  if (
    !row.payment_id ||
    !row.payment_method_id ||
    !row.payment_status ||
    !row.payment_evidence_status ||
    row.payment_amount_minor === null ||
    !row.payment_currency
  ) {
    throw new StateConflictError('Reservation payment data is incomplete for staff display.');
  }

  return reservationPaymentProjection.parse({
    id: row.payment_id,
    payment_method_id: row.payment_method_id,
    status: row.payment_status,
    evidence_status: row.payment_evidence_status,
    amount_minor: String(row.payment_amount_minor),
    currency: row.payment_currency,
    verified_at: row.payment_verified_at?.toISOString() ?? null,
  });
}

function assertReservationReadContext(input: ReservationReadContext): void {
  if (input.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
  if (!input.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('This branch does not grant reservation management access.');
  }
}
