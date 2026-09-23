import {
  reservationDetail,
  reservationListItem,
  reservationListResponse,
  reservationPaymentProjection,
  type PermissionCode,
  type ReservationDetail,
  type ReservationListItem,
  type ReservationListQuery,
  type ReservationListResponse,
  type ReservationPaymentProjection,
  type ReservationPickupRequest,
  type ReservationPickupResponse,
  type ReservationSubmitRequest,
  type ReservationSubmitResponse,
  type ReservationCancelRequest,
  type ReservationCancelResponse,
  type ReservationConfirmRequest,
  type ReservationConfirmResponse,
  type ReservationRejectRequest,
  type ReservationRejectResponse,
  type StaffReservationCompleteRequest,
  type StaffReservationCompleteResponse,
  type StaffReservationCreateRequest,
  type TenantStatus,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  ForbiddenError,
  NotFoundError,
  StateConflictError,
  TenantCancelledError,
  TenantRestrictedError,
} from '../../shared/errors.js';
import { resolveReservationQuote, type ReservationQuote } from './reservations.quote.js';
import {
  createStaffReservationCommand,
  type ReservationCommandResponse,
} from './reservations.command.service.js';
import { cancelReservationByStaff } from './reservations.cancellation.service.js';
import { completeStaffReservationCommand } from './reservations.completion.service.js';
import { pickupReservationByStaff } from './reservations.pickup.service.js';
import {
  confirmReservationByMerchant,
  rejectReservationByMerchant,
  submitReservationForConfirmation,
  type ReservationReviewCommandResponse,
  type ReservationReviewContext,
} from './reservations.review.service.js';
import {
  listReservationsReadModel,
  readReservationDetailModel,
  type ReservationDetailHeaderRow,
  type ReservationListReadRow,
} from './reservations.repository.js';

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

/**
 * Server-side staff quote used by RSV-021 before the allocation transaction claims capacity.
 * The quote never returns an authoritative availability boolean or selected asset.
 */
export async function getStaffReservationQuote(
  input: ReservationReadContext,
  request: StaffReservationCreateRequest,
): Promise<ReservationQuote> {
  assertReservationBookingContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, (client) =>
    resolveReservationQuote(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      request,
    }),
  );
}

/** Creates one held staff/walk-in reservation and authoritative serialized-asset allocation. */
export async function createStaffReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  request: StaffReservationCreateRequest,
): Promise<ReservationCommandResponse> {
  assertReservationBookingContext(input);
  return createStaffReservationCommand(
    {
      tenantId: input.tenantId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      principalId: input.principalId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
    },
    request,
  );
}

export async function completeStaffReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: StaffReservationCompleteRequest,
): Promise<ReservationReviewCommandResponse<StaffReservationCompleteResponse>> {
  assertReservationReviewContext(input);
  return completeStaffReservationCommand(
    {
      tenantId: input.tenantId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      principalId: input.principalId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      permissionCodes: input.permissionCodes,
    },
    reservationId,
    request,
  );
}

export async function cancelReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationCancelRequest,
): Promise<ReservationReviewCommandResponse<ReservationCancelResponse>> {
  assertReservationReviewContext(input);
  return cancelReservationByStaff(
    {
      tenantId: input.tenantId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      principalId: input.principalId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
    },
    reservationId,
    request,
  );
}

export async function pickupReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationPickupRequest,
): Promise<ReservationReviewCommandResponse<ReservationPickupResponse>> {
  assertReservationCustodyContext(input);
  return pickupReservationByStaff(
    {
      tenantId: input.tenantId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      principalId: input.principalId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
    },
    reservationId,
    request,
  );
}

export async function submitReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationSubmitRequest,
): Promise<ReservationReviewCommandResponse<ReservationSubmitResponse>> {
  assertReservationReviewContext(input);
  return submitReservationForConfirmation(toReviewContext(input), reservationId, request);
}

export async function confirmReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationConfirmRequest,
): Promise<ReservationReviewCommandResponse<ReservationConfirmResponse>> {
  assertMerchantReviewContext(input);
  return confirmReservationByMerchant(toReviewContext(input), reservationId, request);
}

export async function rejectReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationRejectRequest,
): Promise<ReservationReviewCommandResponse<ReservationRejectResponse>> {
  assertMerchantReviewContext(input);
  return rejectReservationByMerchant(toReviewContext(input), reservationId, request);
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

/** Authoritative staff detail shared by Reservations and Schedule drawers. */
export async function getReservationDetail(
  input: ReservationReadContext,
  reservationId: string,
): Promise<ReservationDetail> {
  assertReservationReadContext(input);

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const model = await readReservationDetailModel(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      reservationId,
    });
    if (!model) {
      throw new NotFoundError('Reservation could not be found.');
    }
    if (model.lines.length === 0) {
      throw new StateConflictError('Reservation data is incomplete for staff display.');
    }

    const header = model.header;
    const customerSnapshot = header.customer_full_name
      ? {
          full_name: header.customer_full_name,
          phone: header.customer_phone,
          email: header.customer_email,
        }
      : null;

    return reservationDetail.parse({
      id: header.reservation_id,
      reference_code: header.reference_code,
      status: header.reservation_status,
      branch_id: header.branch_id,
      storefront_id: header.storefront_id,
      customer: {
        customer_id: header.customer_id,
        snapshot: customerSnapshot,
      },
      lines: model.lines.map((line) => ({
        id: line.id,
        variant_id: line.variant_id,
        line_number: line.line_number,
        name_snapshot: line.name_snapshot,
        measurements_snapshot: line.measurements_snapshot,
        pricing_snapshot: {
          rental_minor: String(line.rental_minor),
          deposit_minor: String(line.deposit_minor),
          currency: line.currency,
        },
      })),
      pickup_at: header.pickup_at.toISOString(),
      due_at: header.due_at.toISOString(),
      timezone_snapshot: header.timezone_snapshot,
      ...(header.event_date ? { event_date: header.event_date } : {}),
      delivery_snapshot: requireDeliverySnapshot(header),
      price_snapshot: {
        rental_total_minor: String(header.rental_total_minor),
        security_required_minor: String(header.security_required_minor),
        due_now_minor: String(header.due_now_minor),
        currency: header.reservation_currency,
      },
      payment: header.payment_id ? toPaymentProjection(header) : null,
      hold_acquired_at: header.hold_acquired_at.toISOString(),
      hold_expires_at: header.hold_expires_at?.toISOString() ?? null,
      terms_accepted_at: header.terms_accepted_at?.toISOString() ?? null,
      submitted_at: header.submitted_at?.toISOString() ?? null,
      confirmed_at: header.confirmed_at?.toISOString() ?? null,
      completed_at: header.completed_at?.toISOString() ?? null,
      custody_timeline: model.custodyTimeline.map((event) => ({
        event_kind: event.event_kind,
        asset_id: event.asset_id,
        reservation_line_id: event.reservation_line_id,
        occurred_at: event.occurred_at.toISOString(),
        condition_note: event.condition_note,
      })),
      version: header.version,
      created_at: header.created_at.toISOString(),
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

function toPaymentProjection(
  row: ReservationListReadRow | ReservationDetailHeaderRow,
): ReservationPaymentProjection {
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

function requireDeliverySnapshot(
  row: ReservationDetailHeaderRow,
): { fulfillment_method: 'pickup' | 'delivery' } {
  if (!row.fulfillment_method) {
    throw new StateConflictError('Reservation delivery data is incomplete for staff display.');
  }
  return { fulfillment_method: row.fulfillment_method };
}

function toReviewContext(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
): ReservationReviewContext {
  return {
    tenantId: input.tenantId,
    branchId: input.branchId,
    membershipId: input.membershipId,
    principalId: input.principalId,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
  };
}

function assertReservationReviewContext(input: ReservationReadContext): void {
  if (!input.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('This branch does not grant reservation management access.');
  }
}

function assertReservationCustodyContext(input: ReservationReadContext): void {
  assertReservationReviewContext(input);
  if (!input.permissionCodes.includes('reservations.custody')) {
    throw new ForbiddenError('Reservation custody permission is required.');
  }
}

function assertMerchantReviewContext(input: ReservationReadContext): void {
  assertReservationReviewContext(input);
  if (
    !input.permissionCodes.includes('payments.manage') ||
    !input.permissionCodes.includes('evidence.verify')
  ) {
    throw new ForbiddenError('Merchant payment verification permission is required.');
  }
}

function assertReservationBookingContext(input: ReservationReadContext): void {
  if (input.effectiveTenantStatus === 'restricted') {
    throw new TenantRestrictedError('This workspace is temporarily restricted.');
  }
  if (input.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
  if (!input.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('This branch does not grant reservation management access.');
  }
}

function assertReservationReadContext(input: ReservationReadContext): void {
  if (input.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
  if (!input.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('This branch does not grant reservation management access.');
  }
}
