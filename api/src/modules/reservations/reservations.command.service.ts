import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  staffReservationCreateRequest,
  staffReservationCreateResponse,
  type StaffReservationCreateRequest,
  type StaffReservationCreateResponse,
} from '@drezivo/contracts';

import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  CapacityConflictError,
  IdempotencyKeyReusedError,
  StateConflictError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
  type TenantIdempotencyClaim,
} from '../../shared/tenant-idempotency.js';
import { withTenantTransaction } from '../../db/client.js';
import { resolveReservationQuote, type ReservationQuoteRequest } from './reservations.quote.js';
import { resolveReservationCustomer } from './reservations.customer.js';
import {
  appendExpiredReservationAuditEvents,
  appendExpiredReservationOutboxEvents,
  appendReservationAuditEvent,
  appendReservationOutboxEvent,
  chooseAvailableLockedAsset,
  createReservationGraph,
  lockEligibleReservationAssets,
  RESERVATION_HOLD_RECLAIM_BATCH_SIZE,
  releaseExpiredReservationHolds,
  type ReservationGraphLineInput,
  type ReservationCustomerSnapshotRow,
} from './reservations.command.repository.js';

const CREATE_STAFF_RESERVATION_OPERATION = 'reservation.staff.create.v1';
const CREATE_EFFECTS_SAVEPOINT = 'reservation_create_effects';

export interface ReservationCreateContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface ReservationCommandResponse {
  status: number;
  body: SuccessEnvelope<StaffReservationCreateResponse> | FailureEnvelope;
}

/**
 * Idempotent staff/walk-in booking transaction. Quote reads remain advisory until this service
 * locks eligible physical assets, reclaims expired holds with database time, rechecks overlap,
 * and inserts the exclusion-protected allocation in the same transaction as the reservation.
 */
export async function createStaffReservationCommand(
  context: ReservationCreateContext,
  requestInput: StaffReservationCreateRequest,
): Promise<ReservationCommandResponse> {
  const parsed = staffReservationCreateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Staff reservation request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash(request);

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: CREATE_STAFF_RESERVATION_OPERATION,
      intentKey: context.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const claimedLines = await claimReservationLines(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        requestId: context.requestId,
        request,
      });
      const firstClaimedLine = claimedLines[0];
      if (!firstClaimedLine) throw new ValidationError('At least one rental item is required.');
      const quote = aggregateReservationQuotes(claimedLines.map((line) => line.quote));

      await client.query(`SAVEPOINT ${CREATE_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;

      const customer = request.customer
        ? await resolveReservationCustomer(client, context.tenantId, request.customer)
        : null;
      const { graph, referenceCode } = await createHeldReservation(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        requestId: context.requestId,
        actor: { kind: 'staff', key: context.principalId },
        eventDate: request.event_date ?? null,
        fulfillmentMethod: request.fulfillment_method,
        quote,
        assetId: firstClaimedLine.assetId,
        lines: claimedLines,
        customer,
      });

      const data = staffReservationCreateResponse.parse({
        reservation: {
          id: graph.reservation_id,
          reference_code: referenceCode,
          status: 'held',
          branch_id: context.branchId,
          storefront_id: quote.storefront_id,
          variant_id: quote.variant_id,
          payment_method_id: quote.payment_method_id,
          fulfillment_method: request.fulfillment_method,
          pickup_at: quote.pickup_at,
          due_at: quote.due_at,
          timezone_snapshot: quote.timezone_snapshot,
          ...(request.event_date ? { event_date: request.event_date } : {}),
          price_snapshot: {
            rental_total_minor: quote.price_snapshot.rental_total_minor,
            security_required_minor: quote.price_snapshot.security_required_minor,
            due_now_minor: quote.price_snapshot.due_now_minor,
            currency: 'PHP',
          },
          hold_expires_at: graph.hold_expires_at.toISOString(),
          version: graph.version,
          created_at: graph.created_at.toISOString(),
        },
        payment_instructions: toPaymentInstructions(quote.payment_method_snapshot),
      });
      const body: SuccessEnvelope<StaffReservationCreateResponse> = {
        success: true,
        data,
        request_id: context.requestId,
      };

      await finalizeTenantIdempotency(client, {
        tenantId: context.tenantId,
        principalKey: context.membershipId,
        operation: CREATE_STAFF_RESERVATION_OPERATION,
        intentKey: context.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 201,
        safeResponse: body,
      });
      await client.query(`RELEASE SAVEPOINT ${CREATE_EFFECTS_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 201, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${CREATE_EFFECTS_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${CREATE_EFFECTS_SAVEPOINT}`);
      }
      if (isAllocationOverlapViolation(error)) {
        return finalizeKnownFailure(
          client,
          context,
          payloadHash,
          new CapacityConflictError('The requested garment was claimed by another reservation.'),
        );
      }
      return finalizeKnownFailure(client, context, payloadHash, error);
    }
  });
}

export type ReservationQuote = Awaited<ReturnType<typeof resolveReservationQuote>>;

/**
 * Capacity step shared by staff and guest booking: quote, lock the size's eligible garments,
 * reclaim expired holds with database time, and choose a garment free for the blocked interval.
 * The chosen garment is only a promise once `createHeldReservation` inserts its allocation.
 */
export async function claimReservationAsset(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    requestId: string;
    request: ReservationQuoteRequest;
  },
): Promise<{ quote: ReservationQuote; assetId: string }> {
  const quote = await resolveReservationQuote(client, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    request: input.request,
  });

  const lockedAssetIds = await lockEligibleReservationAssets(client, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    variantId: input.request.variant_id,
  });
  if (lockedAssetIds.length === 0) {
    throw new CapacityConflictError('No ready garment is available for this reservation.');
  }

  while (true) {
    const expired = await releaseExpiredReservationHolds(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      assetIds: lockedAssetIds,
      batchSize: RESERVATION_HOLD_RECLAIM_BATCH_SIZE,
    });
    if (expired.length === 0) break;

    await appendExpiredReservationAuditEvents(client, {
      tenantId: input.tenantId,
      requestId: input.requestId,
      rows: expired,
    });
    await appendExpiredReservationOutboxEvents(client, {
      tenantId: input.tenantId,
      rows: expired,
    });

    if (expired.length < RESERVATION_HOLD_RECLAIM_BATCH_SIZE) break;
  }

  const assetId = await chooseAvailableLockedAsset(client, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    variantId: input.request.variant_id,
    assetIds: lockedAssetIds,
    blockedStart: quote.blocked_interval.start,
    blockedEnd: quote.blocked_interval.end,
  });
  if (!assetId) {
    throw new CapacityConflictError('The requested garment is no longer available for those dates.');
  }
  return { quote, assetId };
}

type ClaimedReservationLine = { quote: ReservationQuote; assetId: string };

/** Freshly quote every requested line, lock all candidate assets in stable order, and only then
 * choose unique physical garments. Nothing is inserted until all lines have capacity. */
async function claimReservationLines(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    requestId: string;
    request: StaffReservationCreateRequest;
  },
): Promise<ClaimedReservationLine[]> {
  const variantIds = input.request.lines?.map((line) => line.variant_id) ?? [input.request.variant_id];
  const quotes: ReservationQuote[] = [];
  for (const variantId of variantIds) {
    const quoteRequest: ReservationQuoteRequest = {
      variant_id: variantId,
      requested_interval: input.request.requested_interval,
      ...(input.request.event_date ? { event_date: input.request.event_date } : {}),
      fulfillment_method: input.request.fulfillment_method,
      payment_method_id: input.request.payment_method_id,
    };
    quotes.push(await resolveReservationQuote(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      request: quoteRequest,
    }));
  }

  const assetsByVariant = new Map<string, string[]>();
  for (const variantId of [...new Set(variantIds)].sort()) {
    assetsByVariant.set(variantId, await lockEligibleReservationAssets(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      variantId,
    }));
  }
  const allLockedAssetIds = [...new Set([...assetsByVariant.values()].flat())];
  if (allLockedAssetIds.length === 0) {
    throw new CapacityConflictError('No ready garment is available for this reservation.');
  }

  while (true) {
    const expired = await releaseExpiredReservationHolds(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      assetIds: allLockedAssetIds,
      batchSize: RESERVATION_HOLD_RECLAIM_BATCH_SIZE,
    });
    if (expired.length === 0) break;
    await appendExpiredReservationAuditEvents(client, { tenantId: input.tenantId, requestId: input.requestId, rows: expired });
    await appendExpiredReservationOutboxEvents(client, { tenantId: input.tenantId, rows: expired });
    if (expired.length < RESERVATION_HOLD_RECLAIM_BATCH_SIZE) break;
  }

  const claimed: ClaimedReservationLine[] = [];
  const claimedAssetIds: string[] = [];
  for (const quote of quotes) {
    const assetId = await chooseAvailableLockedAsset(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      variantId: quote.variant_id,
      assetIds: assetsByVariant.get(quote.variant_id) ?? [],
      blockedStart: quote.blocked_interval.start,
      blockedEnd: quote.blocked_interval.end,
      excludeAssetIds: claimedAssetIds,
    });
    if (!assetId) {
      throw new CapacityConflictError('One or more requested garments are no longer available for those dates. Remove or change unavailable items and retry.');
    }
    claimed.push({ quote, assetId });
    claimedAssetIds.push(assetId);
  }
  return claimed;
}

function aggregateReservationQuotes(quotes: ReservationQuote[]): ReservationQuote {
  const first = quotes[0];
  if (!first) throw new ValidationError('At least one rental item is required.');
  const rentalTotal = quotes.reduce((sum, quote) => sum + BigInt(quote.price_snapshot.rental_total_minor), 0n);
  const securityTotal = quotes.reduce((sum, quote) => sum + BigInt(quote.price_snapshot.security_required_minor), 0n);
  const deliveryTotal = BigInt(first.price_snapshot.delivery_total_minor);
  const dueNow = rentalTotal + securityTotal + deliveryTotal;
  if (dueNow > 2_147_483_647n) throw new ValidationError('The combined reservation total exceeds the supported amount.');
  return {
    ...first,
    price_snapshot: {
      ...first.price_snapshot,
      rental_total_minor: rentalTotal.toString(),
      security_required_minor: securityTotal.toString(),
      due_now_minor: dueNow.toString(),
    },
  };
}

/** Inserts the held reservation, its exclusion-protected allocation, audit, and outbox event. */
export async function createHeldReservation(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    requestId: string;
    actor: { kind: 'staff' | 'guest'; key: string };
    eventDate: string | null;
    fulfillmentMethod: StaffReservationCreateRequest['fulfillment_method'];
    quote: ReservationQuote;
    assetId: string;
    lines?: ClaimedReservationLine[];
    customer: ReservationCustomerSnapshotRow | null;
  },
): Promise<{ graph: Awaited<ReturnType<typeof createReservationGraph>>; referenceCode: string }> {
  const reservationId = randomUUID();
  const paymentId = randomUUID();
  const referenceCode = `RSV-${reservationId.toUpperCase()}`;
  const rentalTotalMinor = Number(input.quote.price_snapshot.rental_total_minor);
  const securityRequiredMinor = Number(input.quote.price_snapshot.security_required_minor);
  const dueNowMinor = Number(input.quote.price_snapshot.due_now_minor);
  const claimedLines = input.lines ?? [{ quote: input.quote, assetId: input.assetId }];
  const lines: ReservationGraphLineInput[] = claimedLines.map(({ quote, assetId }) => ({
    reservationLineId: randomUUID(),
    allocationId: randomUUID(),
    variantId: quote.variant_id,
    lineNameSnapshot: quote.line_snapshot.name,
    measurementsSnapshot: quote.line_snapshot.measurements,
    fitRangeSnapshot: quote.line_snapshot.fit_range,
    measurementUnitSnapshot: quote.line_snapshot.measurement_unit,
    pricingSnapshot: {
      rental_minor: quote.price_snapshot.rental_total_minor,
      deposit_minor: quote.price_snapshot.security_required_minor,
      currency: 'PHP',
      pricing_mode: quote.price_snapshot.pricing_mode,
      included_duration_minutes: quote.price_snapshot.included_duration_minutes,
      extra_day_price_minor: quote.price_snapshot.extra_day_price_minor,
      extra_day_count: quote.price_snapshot.extra_day_count,
      rental_day_basis: quote.price_snapshot.rental_day_basis,
      included_rental_days: quote.price_snapshot.included_rental_days,
      rental_day_count: quote.price_snapshot.rental_day_count,
    },
    rentalMinor: Number(quote.price_snapshot.rental_total_minor),
    depositMinor: Number(quote.price_snapshot.security_required_minor),
    assetId,
    blockedStart: quote.blocked_interval.start,
    blockedEnd: quote.blocked_interval.end,
  }));

  const graph = await createReservationGraph(client, {
    reservationId,
    lines,
    paymentId,
    tenantId: input.tenantId,
    branchId: input.branchId,
    customerId: input.customer?.id ?? null,
    storefrontId: input.quote.storefront_id,
    policySnapshotId: input.quote.policy_snapshot_id,
    paymentMethodId: input.quote.payment_method_id,
    referenceCode,
    eventDate: input.eventDate,
    pickupAt: input.quote.pickup_at,
    dueAt: input.quote.due_at,
    timezoneSnapshot: input.quote.timezone_snapshot,
    customerSnapshot: input.customer
      ? {
          full_name: input.customer.full_name,
          phone: input.customer.phone,
          email: input.customer.email,
          address: input.customer.address,
        }
      : null,
    deliverySnapshot: input.quote.delivery_snapshot,
    priceSnapshot: input.quote.price_snapshot,
    rentalTotalMinor,
    securityRequiredMinor,
    dueNowMinor,
  });

  await appendReservationAuditEvent(client, {
    tenantId: input.tenantId,
    actorKind: input.actor.kind,
    actorKey: input.actor.key,
    action: 'reservation.created',
    entityType: 'reservation',
    entityId: graph.reservation_id,
    redactedSummary: {
      status: 'held',
      branch_id: input.branchId,
      variant_id: input.quote.variant_id,
      asset_id: input.assetId,
      line_count: lines.length,
      fulfillment_method: input.fulfillmentMethod,
    },
    requestId: input.requestId,
  });
  await appendReservationOutboxEvent(client, {
    tenantId: input.tenantId,
    dedupeKey: `reservation-created:${graph.reservation_id}`,
    eventType: 'reservation.held',
    payload: {
      reservationId: graph.reservation_id,
      reservationVersion: graph.version,
      branchId: input.branchId,
      variantId: input.quote.variant_id,
      assetId: input.assetId,
      lineCount: lines.length,
    },
  });
  return { graph, referenceCode };
}

export function toPaymentInstructions(snapshot: {
  name: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
  destination_snapshot: Record<string, unknown>;
}): {
  method_name: string;
  rail: 'cash' | 'manual_qr' | 'manual_transfer';
  destination_note?: string;
} {
  const instructions = snapshot.destination_snapshot.instructions;
  return {
    method_name: snapshot.name,
    rail: snapshot.rail,
    ...(typeof instructions === 'string' && instructions.trim().length > 0
      ? { destination_note: instructions.trim().slice(0, 2_000) }
      : {}),
  };
}

function replayOrThrow(claim: TenantIdempotencyClaim): ReservationCommandResponse | null {
  if (claim.kind === 'replayed') {
    return {
      status: claim.responseCode,
      body: claim.safeResponse as ReservationCommandResponse['body'],
    };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical reservation request is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeKnownFailure(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: ReservationCreateContext,
  payloadHash: string,
  error: unknown,
): Promise<ReservationCommandResponse> {
  if (!isAppError(error)) throw error;
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: CREATE_STAFF_RESERVATION_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}

export function isAllocationOverlapViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23P01' &&
    'constraint' in error &&
    (error as { constraint?: unknown }).constraint === 'asset_allocation_no_overlap'
  );
}
