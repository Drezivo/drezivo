import { randomUUID } from 'node:crypto';

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
      const quote = await resolveReservationQuote(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        request,
      });

      const lockedAssetIds = await lockEligibleReservationAssets(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        variantId: request.variant_id,
      });
      if (lockedAssetIds.length === 0) {
        throw new CapacityConflictError('No ready garment is available for this reservation.');
      }

      const expired = await releaseExpiredReservationHolds(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        assetIds: lockedAssetIds,
      });
      for (const row of expired) {
        await appendReservationAuditEvent(client, {
          tenantId: context.tenantId,
          actorKind: 'system',
          actorKey: 'system:reservation-expiry',
          action: 'reservation.expired',
          entityType: 'reservation',
          entityId: row.reservation_id,
          redactedSummary: { reason: 'hold_deadline_elapsed', version: row.version },
          requestId: context.requestId,
        });
        await appendReservationOutboxEvent(client, {
          tenantId: context.tenantId,
          dedupeKey: `reservation-expired:${row.reservation_id}:${row.version}`,
          eventType: 'reservation.hold_expired',
          payload: {
            reservationId: row.reservation_id,
            reservationVersion: row.version,
          },
        });
      }

      const assetId = await chooseAvailableLockedAsset(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        variantId: request.variant_id,
        assetIds: lockedAssetIds,
        blockedStart: quote.blocked_interval.start,
        blockedEnd: quote.blocked_interval.end,
      });
      if (!assetId) {
        throw new CapacityConflictError('The requested garment is no longer available for those dates.');
      }

      await client.query(`SAVEPOINT ${CREATE_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;

      const customer = await resolveCustomer(client, context.tenantId, request);
      const reservationId = randomUUID();
      const reservationLineId = randomUUID();
      const allocationId = randomUUID();
      const paymentId = randomUUID();
      const referenceCode = `RSV-${reservationId.toUpperCase()}`;
      const rentalTotalMinor = Number(quote.price_snapshot.rental_total_minor);
      const securityRequiredMinor = Number(quote.price_snapshot.security_required_minor);
      const dueNowMinor = Number(quote.price_snapshot.due_now_minor);

      const graph = await createReservationGraph(client, {
        reservationId,
        reservationLineId,
        allocationId,
        paymentId,
        tenantId: context.tenantId,
        branchId: context.branchId,
        customerId: customer?.id ?? null,
        storefrontId: quote.storefront_id,
        policySnapshotId: quote.policy_snapshot_id,
        paymentMethodId: quote.payment_method_id,
        referenceCode,
        eventDate: request.event_date ?? null,
        pickupAt: quote.pickup_at,
        dueAt: quote.due_at,
        timezoneSnapshot: quote.timezone_snapshot,
        customerSnapshot: customer
          ? {
              full_name: customer.full_name,
              phone: customer.phone,
              email: customer.email,
              address: customer.address,
            }
          : null,
        deliverySnapshot: quote.delivery_snapshot,
        priceSnapshot: quote.price_snapshot,
        rentalTotalMinor,
        securityRequiredMinor,
        dueNowMinor,
        variantId: quote.variant_id,
        lineNameSnapshot: quote.line_snapshot.name,
        measurementsSnapshot: quote.line_snapshot.measurements,
        pricingSnapshot: {
          rental_minor: quote.price_snapshot.rental_total_minor,
          deposit_minor: quote.price_snapshot.security_required_minor,
          currency: 'PHP',
          pricing_mode: quote.price_snapshot.pricing_mode,
          included_duration_minutes: quote.price_snapshot.included_duration_minutes,
          extra_day_price_minor: quote.price_snapshot.extra_day_price_minor,
          extra_day_count: quote.price_snapshot.extra_day_count,
        },
        assetId,
        blockedStart: quote.blocked_interval.start,
        blockedEnd: quote.blocked_interval.end,
      });

      await appendReservationAuditEvent(client, {
        tenantId: context.tenantId,
        actorKind: 'staff',
        actorKey: context.principalId,
        action: 'reservation.created',
        entityType: 'reservation',
        entityId: graph.reservation_id,
        redactedSummary: {
          status: 'held',
          branch_id: context.branchId,
          variant_id: quote.variant_id,
          asset_id: assetId,
          fulfillment_method: request.fulfillment_method,
        },
        requestId: context.requestId,
      });
      await appendReservationOutboxEvent(client, {
        tenantId: context.tenantId,
        dedupeKey: `reservation-created:${graph.reservation_id}`,
        eventType: 'reservation.held',
        payload: {
          reservationId: graph.reservation_id,
          reservationVersion: graph.version,
          branchId: context.branchId,
          variantId: quote.variant_id,
          assetId,
        },
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

function toPaymentInstructions(snapshot: {
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

function isAllocationOverlapViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23P01' &&
    'constraint' in error &&
    (error as { constraint?: unknown }).constraint === 'asset_allocation_no_overlap'
  );
}
