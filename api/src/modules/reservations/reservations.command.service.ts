import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  MAX_RESERVATION_LINES,
  staffReservationCreateRequest,
  staffReservationCreateResponse,
  type StaffReservationCreateRequest,
  type StaffReservationCreateResponse,
} from '@drezivo/contracts';

import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  CapacityConflictError,
  IdempotencyKeyReusedError,
  NotFoundError,
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
import { resolveReservationQuote } from './reservations.quote.js';
import {
  appendExpiredReservationAuditEvents,
  appendExpiredReservationOutboxEvents,
  appendReservationAuditEvent,
  appendReservationOutboxEvent,
  chooseAvailableLockedAsset,
  createReservationCustomer,
  createReservationGraph,
  fillReservationCustomerAddress,
  type NewReservationLine,
  lockEligibleReservationAssets,
  readReservationCustomerForCreate,
  RESERVATION_HOLD_RECLAIM_BATCH_SIZE,
  releaseExpiredReservationHolds,
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
      const { booking, assetIds } = await claimReservationAssets(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        requestId: context.requestId,
        request,
        variantIds: [request.variant_id, ...(request.additional_variant_ids ?? [])],
      });
      const quote = booking.first;

      await client.query(`SAVEPOINT ${CREATE_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;

      const customer = await resolveCustomer(client, context.tenantId, request);
      const { graph, referenceCode } = await createHeldReservation(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        requestId: context.requestId,
        actor: { kind: 'staff', key: context.principalId },
        eventDate: request.event_date ?? null,
        fulfillmentMethod: request.fulfillment_method,
        booking,
        assetIds,
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
            rental_total_minor: booking.price_snapshot.rental_total_minor,
            security_required_minor: booking.price_snapshot.security_required_minor,
            due_now_minor: booking.price_snapshot.due_now_minor,
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
type ReservationQuoteRequest = Parameters<typeof resolveReservationQuote>[1]['request'];

/**
 * One booking of one or more garments for the same dates: a quote per garment plus what the
 * renter pays in total. Dates, policy, payment method and delivery are shared, so delivery is
 * charged once per booking, not per garment.
 */
export interface ReservationBookingQuote {
  lines: ReservationQuote[];
  /** The first garment's quote, which carries the booking-level facts every line shares. */
  first: ReservationQuote;
  price_snapshot: ReservationQuote['price_snapshot'];
}

const POSTGRES_INT_MAX = 2_147_483_647n;

export async function resolveReservationBookingQuote(
  client: PoolClient,
  input: { tenantId: string; branchId: string; request: ReservationQuoteRequest; variantIds: readonly string[] },
): Promise<ReservationBookingQuote> {
  if (input.variantIds.length === 0 || input.variantIds.length > MAX_RESERVATION_LINES) {
    throw new ValidationError(`A booking holds from 1 to ${MAX_RESERVATION_LINES} garments.`);
  }
  const lines: ReservationQuote[] = [];
  for (const variantId of input.variantIds) {
    lines.push(
      await resolveReservationQuote(client, {
        tenantId: input.tenantId,
        branchId: input.branchId,
        request: { ...input.request, variant_id: variantId as ReservationQuoteRequest['variant_id'] },
      }),
    );
  }
  const [first] = lines;
  if (!first) throw new ValidationError('A booking needs at least one garment.');
  const rental = lines.reduce((sum, line) => sum + BigInt(line.price_snapshot.rental_total_minor), 0n);
  const deposit = lines.reduce((sum, line) => sum + BigInt(line.price_snapshot.security_required_minor), 0n);
  const dueNow = rental + deposit + BigInt(first.price_snapshot.delivery_total_minor);
  if (dueNow > POSTGRES_INT_MAX) throw new StateConflictError('This booking total is too large to record.');
  return {
    lines,
    first,
    price_snapshot: {
      ...first.price_snapshot,
      rental_total_minor: rental.toString(),
      security_required_minor: deposit.toString(),
      due_now_minor: dueNow.toString(),
    },
  };
}

/**
 * Capacity step shared by staff and guest booking: quote every garment, lock all their eligible
 * pieces in one UUID order, reclaim expired holds with database time, and choose a distinct free
 * piece per garment. The choices are only a promise once `createHeldReservation` inserts them.
 */
export async function claimReservationAssets(
  client: PoolClient,
  input: { tenantId: string; branchId: string; requestId: string; request: ReservationQuoteRequest; variantIds: readonly string[] },
): Promise<{ booking: ReservationBookingQuote; assetIds: string[] }> {
  const booking = await resolveReservationBookingQuote(client, input);

  const lockedAssetIds = await lockEligibleReservationAssets(client, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    variantIds: input.variantIds,
  });
  if (lockedAssetIds.length === 0) {
    throw new CapacityConflictError('No ready garment is available for this reservation.');
  }

  await reclaimExpiredHoldsOnLockedAssets(client, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    requestId: input.requestId,
    assetIds: lockedAssetIds,
  });

  const assetIds: string[] = [];
  for (const line of booking.lines) {
    const assetId = await chooseAvailableLockedAsset(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      variantId: line.variant_id,
      // A piece already chosen for an earlier line of this booking is not free for the next one.
      assetIds: lockedAssetIds.filter((id) => !assetIds.includes(id)),
      blockedStart: line.blocked_interval.start,
      blockedEnd: line.blocked_interval.end,
    });
    if (!assetId) {
      throw new CapacityConflictError(
        booking.lines.length === 1
          ? 'The requested garment is no longer available for those dates.'
          : `${line.line_snapshot.name} is no longer available for those dates.`,
      );
    }
    assetIds.push(assetId);
  }
  return { booking, assetIds };
}

/**
 * Releases holds that already expired on the locked garments, using database time, and records
 * each expiry. Callers hold the asset locks, so no other booking can claim these garments meanwhile.
 */
export async function reclaimExpiredHoldsOnLockedAssets(
  client: PoolClient,
  input: { tenantId: string; branchId: string; requestId: string; assetIds: string[] },
): Promise<void> {
  while (true) {
    const expired = await releaseExpiredReservationHolds(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      assetIds: input.assetIds,
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
}

/** Inserts the held reservation, one line and exclusion-protected allocation per garment, audit, and outbox event. */
export async function createHeldReservation(
  client: PoolClient,
  input: {
    tenantId: string;
    branchId: string;
    requestId: string;
    actor: { kind: 'staff' | 'guest'; key: string };
    eventDate: string | null;
    fulfillmentMethod: StaffReservationCreateRequest['fulfillment_method'];
    booking: ReservationBookingQuote;
    assetIds: string[];
    customer: ReservationCustomerSnapshotRow | null;
  },
): Promise<{ graph: Awaited<ReturnType<typeof createReservationGraph>>; referenceCode: string }> {
  const { booking } = input;
  const first = booking.first;
  if (input.assetIds.length !== booking.lines.length) throw new Error('Each garment needs exactly one chosen piece.');
  const reservationId = randomUUID();
  const paymentId = randomUUID();
  const referenceCode = `RSV-${reservationId.toUpperCase()}`;

  const lines: NewReservationLine[] = booking.lines.map((quote, index) => ({
    reservationLineId: randomUUID(),
    allocationId: randomUUID(),
    variantId: quote.variant_id,
    nameSnapshot: quote.line_snapshot.name,
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
    assetId: input.assetIds[index] as string,
    blockedStart: quote.blocked_interval.start,
    blockedEnd: quote.blocked_interval.end,
  }));

  const graph = await createReservationGraph(client, {
    reservationId,
    paymentId,
    tenantId: input.tenantId,
    branchId: input.branchId,
    customerId: input.customer?.id ?? null,
    storefrontId: first.storefront_id,
    policySnapshotId: first.policy_snapshot_id,
    paymentMethodId: first.payment_method_id,
    referenceCode,
    eventDate: input.eventDate,
    pickupAt: first.pickup_at,
    dueAt: first.due_at,
    timezoneSnapshot: first.timezone_snapshot,
    customerSnapshot: input.customer
      ? {
          full_name: input.customer.full_name,
          phone: input.customer.phone,
          email: input.customer.email,
          address: input.customer.address,
        }
      : null,
    deliverySnapshot: first.delivery_snapshot,
    priceSnapshot: booking.price_snapshot,
    rentalTotalMinor: Number(booking.price_snapshot.rental_total_minor),
    securityRequiredMinor: Number(booking.price_snapshot.security_required_minor),
    dueNowMinor: Number(booking.price_snapshot.due_now_minor),
    lines,
  });

  const variantIds = booking.lines.map((quote) => quote.variant_id);
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
      variant_id: first.variant_id,
      asset_id: input.assetIds[0],
      ...(variantIds.length > 1 ? { variant_ids: variantIds, asset_ids: input.assetIds } : {}),
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
      variantId: first.variant_id,
      assetId: input.assetIds[0],
      ...(variantIds.length > 1 ? { variantIds, assetIds: input.assetIds } : {}),
    },
  });
  return { graph, referenceCode };
}

async function resolveCustomer(
  client: Parameters<typeof readReservationCustomerForCreate>[0],
  tenantId: string,
  request: StaffReservationCreateRequest,
): Promise<ReservationCustomerSnapshotRow | null> {
  if (!request.customer) return null;

  if (request.customer.source === 'existing') {
    const existing = await readReservationCustomerForCreate(client, {
      tenantId,
      customerId: request.customer.customer_id,
    });
    if (!existing) throw new NotFoundError('Customer could not be found.');
    return fillMissingReservationAddress(client, tenantId, existing, request.customer.address);
  }

  return createReservationCustomer(client, {
    tenantId,
    fullName: request.customer.customer.full_name,
    phone: request.customer.customer.phone ?? null,
    email: request.customer.customer.email?.trim().toLowerCase() ?? null,
    address: request.customer.customer.address,
    socialMedia: request.customer.customer.social_media ?? null,
    notes: request.customer.customer.notes ?? null,
  });
}

async function fillMissingReservationAddress(
  client: Parameters<typeof readReservationCustomerForCreate>[0],
  tenantId: string,
  customer: ReservationCustomerSnapshotRow,
  address: string | undefined,
): Promise<ReservationCustomerSnapshotRow> {
  if (customer.address !== null) {
    if (address !== undefined) {
      throw new ValidationError('Customer already has an address. Update it through customer management.');
    }
    return customer;
  }
  if (address === undefined) {
    throw new ValidationError('Customer address is required before creating a reservation.');
  }
  const filledAddress = await fillReservationCustomerAddress(client, {
    tenantId,
    customerId: customer.id,
    address,
  });
  if (!filledAddress) {
    throw new StateConflictError('Customer address changed during reservation creation.');
  }
  return { ...customer, address: filledAddress };
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
