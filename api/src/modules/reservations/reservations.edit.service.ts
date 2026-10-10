import {
  branchId as branchIdSchema,
  productVariantId,
  reservationEditRequest,
  reservationEditResponse,
  reservationSummary,
  tenantId as tenantIdSchema,
  type FulfillmentMethod,
  type InstantInterval,
  type ReservationEditRequestInput,
  type ReservationEditResponse,
  type ReservationSummary,
} from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import { withTenantTransaction } from '../../db/client.js';
import {
  CapacityConflictError,
  HoldExpiredError,
  IdempotencyKeyReusedError,
  InvalidReservationTransitionError,
  NotFoundError,
  PriceChangeNotAcceptedError,
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
import { resolveReservationCatalogueQuoteSelection } from '../catalogue/catalogue-allocation.service.js';
import {
  appendReservationAuditEvent,
  appendReservationOutboxEvent,
  chooseAvailableLockedAsset,
  lockEligibleReservationAssets,
} from './reservations.command.repository.js';
import { isAllocationOverlapViolation, reclaimExpiredHoldsOnLockedAssets } from './reservations.command.service.js';
import {
  applyReservationEdit,
  readReservationEditFacts,
  readReservationLinesForEdit,
  rebookReservationLineAllocation,
  unblockReservationAllocationsForEdit,
  updatePendingReservationPaymentAmount,
  updateReservationLinePricing,
  type ReservationEditFactsRow,
  type ReservationEditLineRow,
} from './reservations.edit.repository.js';
import {
  assertEventDateWithinRentalPeriod,
  assertRequestedPickupNotInPast,
  computeRentalTotal,
  resolveDelivery,
} from './reservations.quote.js';
import {
  lockLatestReservationReceipt,
  lockReservationAllocationsForReview,
  lockReservationForReview,
  lockReservationPaymentForReview,
  readReservationMutationSummary,
  type LockedReservationAllocationRow,
  type LockedReservationReviewRow,
  type ReservationMutationSummaryRow,
} from './reservations.review.repository.js';

const EDIT_OPERATION = 'reservation.edit.v1';
const EDIT_SAVEPOINT = 'reservation_edit_effects';
const EDITABLE_STATES = new Set<LockedReservationReviewRow['status']>(['held', 'pending_confirmation', 'confirmed']);
/** Receipt states that mean the renter already sent money for the current amount. */
const RECEIPT_COMMITS_AMOUNT = new Set(['uploaded', 'under_review', 'verified']);

export interface ReservationEditContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface ReservationEditCommandResponse {
  status: number;
  body: SuccessEnvelope<ReservationEditResponse> | FailureEnvelope;
}

interface LinePrice {
  line: ReservationEditLineRow;
  rentalMinor: number;
  pricingSnapshot: Record<string, unknown>;
}

/**
 * Staff correction of a reservation before handover. Lock order matches the other lifecycle
 * commands: reservation, payment, receipt, current allocations, then every candidate garment for
 * the new dates in one UUID order. New dates are priced with the terms accepted at booking (never
 * today's catalogue price) and the garment swap happens in place inside this transaction, so a
 * conflict rolls back to the original booking untouched.
 */
export async function editReservationByStaff(
  context: ReservationEditContext,
  reservationId: string,
  requestInput: ReservationEditRequestInput,
): Promise<ReservationEditCommandResponse> {
  const parsed = reservationEditRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Reservation edit request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ reservation_id: reservationId, ...request });

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: EDIT_OPERATION,
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
      assertEditableState(reservation, request.version);

      const facts = await readReservationEditFacts(client, { tenantId: context.tenantId, reservationId });
      if (!facts) throw new StateConflictError('Reservation booking facts are unavailable.');
      const lines = await readReservationLinesForEdit(client, { tenantId: context.tenantId, reservationId });
      const payment = await lockReservationPaymentForReview(client, { tenantId: context.tenantId, reservationId });
      const receipt = payment
        ? await lockLatestReservationReceipt(client, { tenantId: context.tenantId, paymentId: payment.payment_id })
        : null;
      const allocations = await lockReservationAllocationsForReview(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
      });
      assertOneBlockingAllocationPerLine(lines, allocations);

      const currentInterval: InstantInterval = {
        start: reservation.pickup_at.toISOString(),
        end: reservation.due_at.toISOString(),
      };
      const interval = request.requested_interval ?? currentInterval;
      const datesChanged =
        Date.parse(interval.start) !== Date.parse(currentInterval.start) ||
        Date.parse(interval.end) !== Date.parse(currentInterval.end);
      const currentFulfillment = fulfillmentOf(facts);
      const fulfillment = request.fulfillment_method ?? currentFulfillment;
      const eventDate = request.event_date !== undefined ? request.event_date : facts.event_date;

      if (datesChanged) await assertRequestedPickupNotInPast(client, interval.start);
      assertEventDateWithinRentalPeriod({
        eventDate: eventDate ?? undefined,
        requestedInterval: interval,
        timeZone: facts.timezone_snapshot,
      });
      if (request.customer && facts.customer_snapshot === null) {
        throw new ValidationError('Add the customer by completing the booking first.');
      }

      const linePrices = datesChanged
        ? lines.map((line) => repriceLine(line, interval, facts.timezone_snapshot))
        : lines.map((line) => ({ line, rentalMinor: Number(line.rental_minor), pricingSnapshot: line.pricing_snapshot }));
      const delivery =
        fulfillment === currentFulfillment
          ? { feeMinor: BigInt(deliveryFeeOf(facts)), deliverySnapshot: facts.delivery_snapshot }
          : deliveryFor(facts, fulfillment);
      const rentalTotal = linePrices.reduce((sum, price) => sum + price.rentalMinor, 0);
      const dueNow = rentalTotal + Number(facts.security_required_minor) + Number(delivery.feeMinor);
      const previousDueNow = Number(facts.due_now_minor);
      const priceChanged = dueNow !== previousDueNow;

      // Once the renter paid or sent a receipt, the recorded amount stays; staff settle the difference.
      const moneyCommitted =
        payment !== null &&
        (payment.status !== 'pending' ||
          payment.verified_at !== null ||
          (receipt !== null && RECEIPT_COMMITS_AMOUNT.has(receipt.evidence_status)));
      // Pickup requires the verified amount to cover the total, and there is no flow to record a
      // top-up, so a paid booking can only keep or lower its total. Raising it needs a new booking.
      if (moneyCommitted && dueNow > previousDueNow) {
        throw new StateConflictError(
          `This change raises the amount due to ${formatPeso(dueNow)}, but the renter already paid or sent a receipt for ${formatPeso(previousDueNow)}. Keep the current total, or cancel and continue it as a new booking.`,
        );
      }
      if (priceChanged && moneyCommitted && !request.accept_price_change) {
        throw new PriceChangeNotAcceptedError(
          `This change lowers the amount due to ${formatPeso(dueNow)} from ${formatPeso(previousDueNow)}, and the renter already paid or sent a receipt. Confirm the price change to save it, then refund the difference.`,
        );
      }
      if (priceChanged && payment === null && dueNow > 0) {
        throw new StateConflictError('This reservation has no payment record to update. Cancel it and continue it as a new booking.');
      }

      await client.query(`SAVEPOINT ${EDIT_SAVEPOINT}`);
      savepointOpen = true;

      if (datesChanged) {
        await moveGarmentsToNewDates(client, context, reservationId, lines, allocations, interval);
        for (const price of linePrices) {
          await updateReservationLinePricing(client, {
            tenantId: context.tenantId,
            reservationLineId: price.line.id,
            rentalMinor: price.rentalMinor,
            pricingSnapshot: price.pricingSnapshot,
          });
        }
      }

      const newVersion = await applyReservationEdit(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        reservationId,
        version: request.version,
        pickupAt: interval.start,
        dueAt: interval.end,
        eventDate,
        customerSnapshot: request.customer
          ? {
              full_name: request.customer.full_name,
              phone: request.customer.phone,
              email: request.customer.email?.toLowerCase() ?? null,
              address: request.customer.address,
            }
          : facts.customer_snapshot,
        deliverySnapshot: delivery.deliverySnapshot,
        priceSnapshot: {
          ...facts.price_snapshot,
          ...pricingTermsOf(linePrices[0]?.pricingSnapshot),
          rental_total_minor: String(rentalTotal),
          delivery_total_minor: delivery.feeMinor.toString(),
          due_now_minor: String(dueNow),
        },
        rentalTotalMinor: rentalTotal,
        dueNowMinor: dueNow,
      });
      if (newVersion === null) throw new StateConflictError('Reservation edit lost a concurrent change. Refresh and try again.');

      if (priceChanged && payment !== null && !moneyCommitted) {
        const updated = await updatePendingReservationPaymentAmount(client, {
          tenantId: context.tenantId,
          paymentId: payment.payment_id,
          amountMinor: dueNow,
        });
        if (!updated) throw new StateConflictError('The payment changed during this edit. Refresh and try again.');
      }

      const changed = [
        request.customer ? 'customer' : null,
        request.event_date !== undefined && request.event_date !== facts.event_date ? 'event_date' : null,
        fulfillment !== currentFulfillment ? 'fulfillment_method' : null,
        datesChanged ? 'dates' : null,
      ].filter((field): field is string => field !== null);
      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.edited',
        entityType: 'reservation',
        entityId: reservationId,
        redactedSummary: {
          version: newVersion,
          changed,
          price_changed: priceChanged,
          previous_due_now_minor: previousDueNow,
          due_now_minor: dueNow,
          money_committed: moneyCommitted,
        },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-edited:${reservationId}:${newVersion}`,
        eventType: 'reservation.edited',
        payload: { reservationId, reservationVersion: newVersion, changed, priceChanged },
      });

      const data = reservationEditResponse.parse({
        reservation: await requireMutationSummary(client, context, reservationId),
        price_changed: priceChanged,
        previous_due_now_minor: String(previousDueNow),
      });
      await client.query(`RELEASE SAVEPOINT ${EDIT_SAVEPOINT}`);
      savepointOpen = false;
      return finalizeSuccess(client, context, payloadHash, data);
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${EDIT_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${EDIT_SAVEPOINT}`);
      }
      if (isAllocationOverlapViolation(error)) {
        return finalizeKnownFailure(
          client,
          context,
          payloadHash,
          new CapacityConflictError('Another booking took a garment for those dates. The reservation was not changed.'),
        );
      }
      return finalizeKnownFailure(client, context, payloadHash, error);
    }
  });
}

function assertEditableState(reservation: LockedReservationReviewRow, version: number): void {
  if (reservation.version !== version) {
    throw new StaleVersionError('Reservation version is stale. Refresh before retrying.');
  }
  if (!EDITABLE_STATES.has(reservation.status)) {
    throw new InvalidReservationTransitionError(
      `A reservation can be edited only before pickup. This one is ${reservation.status.replace('_', ' ')}.`,
    );
  }
  const deadlinePassed =
    reservation.status !== 'confirmed' &&
    (reservation.hold_expires_at === null || reservation.hold_expires_at.getTime() <= reservation.database_now.getTime());
  if (deadlinePassed) {
    throw new HoldExpiredError('This reservation expired. Continue it as a new booking instead.');
  }
}

function assertOneBlockingAllocationPerLine(
  lines: ReservationEditLineRow[],
  allocations: LockedReservationAllocationRow[],
): void {
  const blockingLineIds = allocations.filter((allocation) => allocation.is_blocking).map((allocation) => allocation.reservation_line_id);
  if (
    lines.length === 0 ||
    blockingLineIds.length !== lines.length ||
    new Set(blockingLineIds).size !== lines.length ||
    !lines.every((line) => blockingLineIds.includes(line.id))
  ) {
    throw new StateConflictError('Reservation garments are not in a state that can be edited.');
  }
}

/**
 * Matches every line to a garment free for the new dates. The reservation's own allocations stop
 * blocking first so its current garments are candidates, and each line keeps its garment when that
 * one is still free, so a date change does not shuffle garments without need.
 */
async function moveGarmentsToNewDates(
  client: PoolClient,
  context: ReservationEditContext,
  reservationId: string,
  lines: ReservationEditLineRow[],
  allocations: LockedReservationAllocationRow[],
  interval: InstantInterval,
): Promise<void> {
  const blocked = new Map<string, { start: string; end: string }>();
  for (const line of lines) {
    const selection = await resolveReservationCatalogueQuoteSelection(client, {
      tenantId: tenantIdSchema.parse(context.tenantId),
      branchId: branchIdSchema.parse(context.branchId),
      variantId: productVariantId.parse(line.variant_id),
      requestedInterval: interval,
    });
    if (!selection) throw new NotFoundError('A clothing item on this reservation is no longer available to book.');
    blocked.set(line.id, selection.blocked_interval);
  }

  const lockedAssetIds = await lockEligibleReservationAssets(client, {
    tenantId: context.tenantId,
    branchId: context.branchId,
    variantIds: lines.map((line) => line.variant_id),
  });
  await reclaimExpiredHoldsOnLockedAssets(client, {
    tenantId: context.tenantId,
    branchId: context.branchId,
    requestId: context.requestId,
    assetIds: lockedAssetIds,
  });

  const unblocked = await unblockReservationAllocationsForEdit(client, { tenantId: context.tenantId, reservationId });
  if (unblocked !== lines.length) throw new StateConflictError('Reservation garments changed during this edit.');

  for (const line of lines) {
    const period = blocked.get(line.id);
    if (!period) throw new StateConflictError('Reservation garment period is unavailable.');
    const current = allocations.find((allocation) => allocation.reservation_line_id === line.id)?.asset_id;
    const choose = (assetIds: string[]): Promise<string | null> =>
      chooseAvailableLockedAsset(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        variantId: line.variant_id,
        assetIds,
        blockedStart: period.start,
        blockedEnd: period.end,
      });
    const assetId =
      (current && lockedAssetIds.includes(current) ? await choose([current]) : null) ?? (await choose(lockedAssetIds));
    if (!assetId) {
      throw new CapacityConflictError('A garment on this reservation is not free for the new dates. The reservation was not changed.');
    }
    const rebooked = await rebookReservationLineAllocation(client, {
      tenantId: context.tenantId,
      reservationLineId: line.id,
      assetId,
      blockedStart: period.start,
      blockedEnd: period.end,
    });
    if (!rebooked) throw new StateConflictError('Reservation garments changed during this edit.');
  }
}

/** Re-prices one line for new dates from the price terms recorded when it was booked. */
function repriceLine(line: ReservationEditLineRow, interval: InstantInterval, timeZone: string): LinePrice {
  const terms = line.pricing_snapshot;
  const pricingMode = terms['pricing_mode'];
  const includedMinutes = terms['included_duration_minutes'];
  const extraDayPrice = terms['extra_day_price_minor'];
  const extraDayCount = terms['extra_day_count'];
  if (
    (pricingMode !== 'fixed_duration' && pricingMode !== 'daily') ||
    typeof includedMinutes !== 'number' ||
    typeof extraDayPrice !== 'string' ||
    typeof extraDayCount !== 'number'
  ) {
    throw new StateConflictError(
      'This reservation was booked before its price terms were recorded, so its dates cannot be edited. Cancel it and continue it as a new booking.',
    );
  }
  const baseRental = BigInt(line.rental_minor) - BigInt(extraDayCount) * BigInt(extraDayPrice);
  const rental = computeRentalTotal({
    requestedInterval: interval,
    timeZone,
    pricingMode,
    baseRentalMinor: baseRental.toString(),
    includedDurationMinutes: includedMinutes,
    extraDayPriceMinor: extraDayPrice,
  });
  return {
    line,
    rentalMinor: Number(rental.totalMinor),
    pricingSnapshot: {
      ...terms,
      rental_minor: rental.totalMinor.toString(),
      extra_day_count: rental.extraDayCount,
      included_rental_days: rental.includedRentalDays,
      rental_day_count: rental.rentalDayCount,
    },
  };
}

/** The reservation-level copy of the first line's day counts, kept in step with its price. */
function pricingTermsOf(snapshot: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!snapshot) return {};
  const keys = ['extra_day_count', 'included_rental_days', 'rental_day_count'] as const;
  return Object.fromEntries(keys.filter((key) => key in snapshot).map((key) => [key, snapshot[key]]));
}

/** Delivery for a changed handover method, from the policy the renter accepted at booking. */
function deliveryFor(
  facts: ReservationEditFactsRow,
  fulfillment: FulfillmentMethod,
): { feeMinor: bigint; deliverySnapshot: Record<string, unknown> } {
  const delivery = resolveDelivery(facts.delivery_rules, fulfillment);
  return {
    feeMinor: delivery.feeMinor,
    deliverySnapshot: {
      fulfillment_method: fulfillment,
      fee_minor: delivery.feeMinor.toString(),
      ...(delivery.terms ? { terms: delivery.terms } : {}),
    },
  };
}

function fulfillmentOf(facts: ReservationEditFactsRow): FulfillmentMethod {
  return facts.delivery_snapshot['fulfillment_method'] === 'delivery' ? 'delivery' : 'pickup';
}

function deliveryFeeOf(facts: ReservationEditFactsRow): string {
  const fee = facts.delivery_snapshot['fee_minor'];
  return typeof fee === 'string' && /^\d+$/.test(fee) ? fee : '0';
}

function formatPeso(minor: number): string {
  return `₱${(minor / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function requireMutationSummary(
  client: PoolClient,
  context: ReservationEditContext,
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

function replayOrThrow(claim: TenantIdempotencyClaim): ReservationEditCommandResponse | null {
  if (claim.kind === 'replayed') {
    return { status: claim.responseCode, body: claim.safeResponse as ReservationEditCommandResponse['body'] };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical reservation edit is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeSuccess(
  client: PoolClient,
  context: ReservationEditContext,
  payloadHash: string,
  data: ReservationEditResponse,
): Promise<ReservationEditCommandResponse> {
  const body: SuccessEnvelope<ReservationEditResponse> = { success: true, data, request_id: context.requestId };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: EDIT_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'succeeded',
    responseCode: 200,
    safeResponse: body,
  });
  return { status: 200, body };
}

async function finalizeKnownFailure(
  client: PoolClient,
  context: ReservationEditContext,
  payloadHash: string,
  error: unknown,
): Promise<ReservationEditCommandResponse> {
  if (!isAppError(error)) throw error;
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: EDIT_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}
