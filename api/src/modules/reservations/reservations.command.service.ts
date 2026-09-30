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
  appendReservationAuditEvent,
  appendReservationOutboxEvent,
  chooseAvailableLockedAsset,
  createReservationCustomer,
  createReservationGraph,
  fillReservationCustomerAddress,
  lockEligibleReservationAssets,
  readReservationCustomerForCreate,
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
      const { quote, assetId } = await claimReservationAsset(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        requestId: context.requestId,
        request,
      });

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
        quote,
        assetId,
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
    request: Parameters<typeof resolveReservationQuote>[1]['request'];
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

  const expired = await releaseExpiredReservationHolds(client, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    assetIds: lockedAssetIds,
  });
  for (const row of expired) {
    await appendReservationAuditEvent(client, {
      tenantId: input.tenantId,
      actorKind: 'system',
      actorKey: 'system:reservation-expiry',
      action: 'reservation.expired',
      entityType: 'reservation',
      entityId: row.reservation_id,
      redactedSummary: { reason: 'hold_deadline_elapsed', version: row.version },
      requestId: input.requestId,
    });
    await appendReservationOutboxEvent(client, {
      tenantId: input.tenantId,
      dedupeKey: `reservation-expired:${row.reservation_id}:${row.version}`,
      eventType: 'reservation.hold_expired',
      payload: {
        reservationId: row.reservation_id,
        reservationVersion: row.version,
      },
    });
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
    customer: ReservationCustomerSnapshotRow | null;
  },
): Promise<{ graph: Awaited<ReturnType<typeof createReservationGraph>>; referenceCode: string }> {
  const reservationId = randomUUID();
  const reservationLineId = randomUUID();
  const allocationId = randomUUID();
  const paymentId = randomUUID();
  const referenceCode = `RSV-${reservationId.toUpperCase()}`;
  const rentalTotalMinor = Number(input.quote.price_snapshot.rental_total_minor);
  const securityRequiredMinor = Number(input.quote.price_snapshot.security_required_minor);
  const dueNowMinor = Number(input.quote.price_snapshot.due_now_minor);

  const graph = await createReservationGraph(client, {
    reservationId,
    reservationLineId,
    allocationId,
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
    variantId: input.quote.variant_id,
    lineNameSnapshot: input.quote.line_snapshot.name,
    measurementsSnapshot: input.quote.line_snapshot.measurements,
    pricingSnapshot: {
      rental_minor: input.quote.price_snapshot.rental_total_minor,
      deposit_minor: input.quote.price_snapshot.security_required_minor,
      currency: 'PHP',
      pricing_mode: input.quote.price_snapshot.pricing_mode,
      included_duration_minutes: input.quote.price_snapshot.included_duration_minutes,
      extra_day_price_minor: input.quote.price_snapshot.extra_day_price_minor,
      extra_day_count: input.quote.price_snapshot.extra_day_count,
    },
    assetId: input.assetId,
    blockedStart: input.quote.blocked_interval.start,
    blockedEnd: input.quote.blocked_interval.end,
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
