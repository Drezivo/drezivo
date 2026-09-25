import {
  branchId,
  productVariantId,
  tenantId,
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
  type ReservationReturnRequest,
  type ReservationReturnResponse,
  type ReservationInspectionRequest,
  type ReservationInspectionResponse,
  type ReservationCompleteRequest,
  type ReservationCompleteResponse,
  type ReservationSubmitRequest,
  type ReservationSubmitResponse,
  type ReservationCancelRequest,
  type ReservationCancelResponse,
  type ReservationConfirmRequest,
  type ReservationConfirmResponse,
  type ReservationPaymentReceiptAttachRequest,
  type ReservationPaymentReceiptAttachResponse,
  type ReservationPaymentVerifyRequest,
  type ReservationPaymentVerifyResponse,
  type ReservationRejectRequest,
  type ReservationRejectResponse,
  type StaffReservationCompleteRequest,
  type StaffReservationCompleteResponse,
  staffReservationAvailabilityCalendarResponse,
  staffReservationAvailabilityCheckResponse,
  staffReservationIntakeResponse,
  type StaffReservationAvailabilityCalendarQuery,
  type StaffReservationAvailabilityCalendarResponse,
  type StaffReservationAvailabilityCheckQuery,
  type StaffReservationAvailabilityCheckResponse,
  type StaffReservationCreateRequest,
  type StaffReservationIntakeQuery,
  type StaffReservationIntakeResponse,
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
import { resolveReservationCatalogueQuoteSelection } from '../catalogue/catalogue-allocation.service.js';
import {
  assertRequestedPickupNotInPast,
  resolveReservationQuote,
  computeRentalTotal,
  type ReservationQuote,
} from './reservations.quote.js';
import {
  createStaffReservationCommand,
  type ReservationCommandResponse,
} from './reservations.command.service.js';
import { cancelReservationByStaff } from './reservations.cancellation.service.js';
import { completeStaffReservationCommand } from './reservations.completion.service.js';
import {
  completeReturnedReservationByStaff,
  inspectReturnedReservationByStaff,
} from './reservations.completion-gate.service.js';
import { pickupReservationByStaff } from './reservations.pickup.service.js';
import { returnReservationByStaff } from './reservations.return.service.js';
import {
  attachReservationPaymentReceipt,
  confirmReservationByMerchant,
  rejectReservationByMerchant,
  submitReservationForConfirmation,
  verifyReservationPaymentByStaff,
  type ReservationReviewCommandResponse,
  type ReservationReviewContext,
} from './reservations.review.service.js';
import {
  countStaffVariantAvailableAssets,
  readStaffVariantCalendarAvailability,
} from './reservations.availability.repository.js';
import {
  listReservationsReadModel,
  listStaffReservationPaymentMethodOptions,
  readReservationDetailModel,
  searchStaffReservationCustomerOptions,
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

export async function getStaffReservationIntakeOptions(
  input: ReservationReadContext,
  query: StaffReservationIntakeQuery,
): Promise<StaffReservationIntakeResponse> {
  assertReservationBookingContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) =>
    staffReservationIntakeResponse.parse({
      payment_methods: await listStaffReservationPaymentMethodOptions(client, input.tenantId),
      customers: await searchStaffReservationCustomerOptions(client, {
        tenantId: input.tenantId,
        ...(query.customer_search ? { search: query.customer_search } : {}),
      }),
    }),
  );
}

export async function getStaffReservationAvailabilityCalendar(
  input: ReservationReadContext,
  query: StaffReservationAvailabilityCalendarQuery,
): Promise<StaffReservationAvailabilityCalendarResponse> {
  assertReservationBookingContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const projection = await readStaffVariantCalendarAvailability(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      variantId: query.variant_id,
      startDate: query.start_date,
      endDate: query.end_date,
    });
    if (!projection) throw new NotFoundError('Clothing variant could not be found.');

    const { metadata } = projection;
    const minimumDurationMinutes =
      metadata.pricing_mode === 'fixed_duration' ? metadata.included_duration_minutes : 0;
    return staffReservationAvailabilityCalendarResponse.parse({
      variant_id: metadata.variant_id,
      timezone: metadata.timezone,
      window: { start_date: query.start_date, end_date: query.end_date },
      active_assets: metadata.active_assets,
      ready_assets: metadata.ready_assets,
      pricing: {
        pricing_mode: metadata.pricing_mode,
        rental_price_minor: String(metadata.rental_price_minor),
        security_deposit_minor: String(metadata.security_deposit_minor),
        currency: metadata.currency,
        included_duration_minutes: metadata.included_duration_minutes,
        minimum_duration_minutes: minimumDurationMinutes,
        extra_day_price_minor: String(metadata.extra_day_price_minor),
        recovery_minutes: metadata.turnaround_minutes,
      },
      days: projection.days.map((day) => ({
        ...day,
        state:
          day.available_assets === 0
            ? 'unavailable'
            : day.available_assets < day.ready_assets
              ? 'limited'
              : 'available',
      })),
    });
  });
}

export async function getStaffReservationAvailabilityCheck(
  input: ReservationReadContext,
  query: StaffReservationAvailabilityCheckQuery,
): Promise<StaffReservationAvailabilityCheckResponse> {
  assertReservationBookingContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    await assertRequestedPickupNotInPast(client, query.pickup_at);
    const requestedInterval = { start: query.pickup_at, end: query.due_at };
    const catalogue = await resolveReservationCatalogueQuoteSelection(client, {
      tenantId: tenantId.parse(input.tenantId),
      branchId: branchId.parse(input.branchId),
      variantId: productVariantId.parse(query.variant_id),
      requestedInterval,
    });
    if (!catalogue) throw new NotFoundError('Clothing variant could not be found.');

    const rental = computeRentalTotal({
      requestedInterval,
      pricingMode: catalogue.variant.pricing_mode,
      baseRentalMinor: catalogue.variant.rental_price_minor,
      includedDurationMinutes: catalogue.variant.included_duration_minutes,
      extraDayPriceMinor: catalogue.variant.extra_day_price_minor,
    });
    const minimumDurationMinutes =
      catalogue.variant.pricing_mode === 'fixed_duration'
        ? catalogue.variant.included_duration_minutes
        : 0;

    const availableAssets = await countStaffVariantAvailableAssets(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      variantId: query.variant_id,
      blockedStart: catalogue.blocked_interval.start,
      blockedEnd: catalogue.blocked_interval.end,
    });

    return staffReservationAvailabilityCheckResponse.parse({
      variant_id: catalogue.variant_id,
      requested_interval: requestedInterval,
      blocked_interval: catalogue.blocked_interval,
      available: availableAssets > 0,
      available_assets: availableAssets,
      guaranteed: false,
      pricing: {
        pricing_mode: catalogue.variant.pricing_mode,
        rental_price_minor: catalogue.variant.rental_price_minor,
        security_deposit_minor: catalogue.variant.security_deposit_minor,
        currency: catalogue.variant.currency,
        included_duration_minutes: catalogue.variant.included_duration_minutes,
        minimum_duration_minutes: minimumDurationMinutes,
        extra_day_price_minor: catalogue.variant.extra_day_price_minor,
        recovery_minutes: catalogue.variant.turnaround_minutes,
      },
      rental_preview: {
        rental_total_minor: rental.totalMinor.toString(),
        extra_day_count: rental.extraDayCount,
        currency: catalogue.variant.currency,
      },
    });
  });
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

export async function returnReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationReturnRequest,
): Promise<ReservationReviewCommandResponse<ReservationReturnResponse>> {
  assertReservationReturnContext(input);
  return returnReservationByStaff(
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

export async function inspectReturnedReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationInspectionRequest,
): Promise<ReservationReviewCommandResponse<ReservationInspectionResponse>> {
  assertReservationReturnContext(input);
  if (!input.permissionCodes.includes('assets.manage')) {
    throw new ForbiddenError('Asset condition management permission is required.');
  }
  return inspectReturnedReservationByStaff(
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

export async function completeRentalReservation(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationCompleteRequest,
): Promise<ReservationReviewCommandResponse<ReservationCompleteResponse>> {
  // Completion is an existing-rental settlement action. The shared tenant policy allows
  // settlement for active, restricted, and cancelled workspaces; only permissions apply here.
  assertReservationCustodyContext(input);
  return completeReturnedReservationByStaff(
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

export async function attachReservationReceipt(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationPaymentReceiptAttachRequest,
): Promise<ReservationReviewCommandResponse<ReservationPaymentReceiptAttachResponse>> {
  assertReservationReviewContext(input);
  if (!input.permissionCodes.includes('payments.manage')) {
    throw new ForbiddenError('Payment management permission is required.');
  }
  return attachReservationPaymentReceipt(toReviewContext(input), reservationId, request);
}

export async function verifyReservationPayment(
  input: ReservationReadContext & { requestId: string; idempotencyKey: string },
  reservationId: string,
  request: ReservationPaymentVerifyRequest,
): Promise<ReservationReviewCommandResponse<ReservationPaymentVerifyResponse>> {
  assertReservationReviewContext(input);
  if (
    !input.permissionCodes.includes('payments.manage') ||
    !input.permissionCodes.includes('evidence.verify')
  ) {
    throw new ForbiddenError('Payment evidence verification permission is required.');
  }
  return verifyReservationPaymentByStaff(toReviewContext(input), reservationId, request);
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
    !row.payment_method_name ||
    !row.payment_rail ||
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
    method_name: row.payment_method_name,
    rail: row.payment_rail,
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

function assertReservationReturnContext(input: ReservationReadContext): void {
  assertReservationCustodyContext(input);
  if (input.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
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
