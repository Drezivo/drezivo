import { randomUUID } from 'node:crypto';

import {
  fittingCreateRequest,
  fittingCreateResponse,
  fittingDetail,
  type FittingCreateRequest,
  type FittingCreateResponse,
  type FittingDetail,
} from '@drezivo/contracts';

import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import { withTenantTransaction } from '../../db/client.js';
import {
  CapacityConflictError,
  IdempotencyKeyReusedError,
  NotFoundError,
  ScheduleConflictError,
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
import {
  appendFittingCreateAudit,
  claimFittingCapacitySlot,
  createFittingAppointmentBase,
  createFittingCustomer,
  ensureFittingCapacitySlots,
  lockFittingCreateSettings,
  readFittingCustomerForCreate,
  readFittingVariantsForCreate,
  validateFittingScheduleForCreate,
  type FittingCreateCustomerRow,
} from './fittings.command.repository.js';
import { readFittingDetailModel } from './fittings.repository.js';

const CREATE_FITTING_OPERATION = 'fitting.create.staff';
const CREATE_EFFECTS_SAVEPOINT = 'fitting_create_effects';

export interface FittingCreateContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
}

export interface FittingCreateCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingCreateResponse> | FailureEnvelope;
}

/**
 * FIT-BE-040/041 creation orchestration. Schedule validation and hidden capacity claiming are
 * authoritative inside this transaction. Guaranteed-asset claiming remains the FIT-BE-043 seam;
 * until that lands, guaranteed lines fail closed instead of fabricating a garment guarantee.
 */
export async function createStaffFittingCommand(
  context: FittingCreateContext,
  requestInput: FittingCreateRequest,
): Promise<FittingCreateCommandResponse> {
  const parsed = fittingCreateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Staff fitting request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash(request);

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: context.tenantId,
      principalKey: context.membershipId,
      operation: CREATE_FITTING_OPERATION,
      intentKey: context.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const settings = await lockFittingCreateSettings(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
      });
      if (!settings)
        throw new StateConflictError('Fitting settings are not configured for this branch.');
      if (!settings.enabled)
        throw new StateConflictError('Fitting appointments are disabled for this branch.');
      assertThirtyMinuteBranchGrid(request.starts_at, settings.timezone);
      const startsAt = new Date(request.starts_at);
      const endsAt = new Date(
        startsAt.getTime() + settings.duration_minutes * 60_000,
      ).toISOString();
      const feeMinor = Number(settings.fee_minor);
      if (!Number.isSafeInteger(feeMinor) || feeMinor < 0)
        throw new StateConflictError('Configured fitting fee is invalid.');

      const schedule = await validateFittingScheduleForCreate(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        startsAt: startsAt.toISOString(),
        endsAt,
      });
      if (!schedule.is_future) {
        throw new ScheduleConflictError('Fitting start must be in the future.');
      }
      if (!schedule.within_weekly_hours) {
        throw new ScheduleConflictError(
          'Fitting must fit completely inside one branch operating window.',
        );
      }
      if (!schedule.closure_free) {
        throw new ScheduleConflictError('Fitting overlaps a branch closure.');
      }

      const distinctVariantIds = [...new Set(request.garments.map((line) => line.variant_id))];
      const variants = await readFittingVariantsForCreate(client, {
        tenantId: context.tenantId,
        variantIds: distinctVariantIds,
      });
      if (variants.length !== distinctVariantIds.length) {
        throw new ValidationError(
          'One or more fitting garments are unavailable in this catalogue.',
        );
      }
      if (request.garments.some((line) => line.garment_mode === 'guaranteed')) {
        throw new StateConflictError(
          'Guaranteed fitting garments require the FIT-BE-043 atomic asset claimant.',
        );
      }

      await client.query(`SAVEPOINT ${CREATE_EFFECTS_SAVEPOINT}`);
      savepointOpen = true;
      const customer = await resolveCustomer(client, context.tenantId, request);
      const fittingId = randomUUID();
      const chargeId = randomUUID();
      const capacityAllocationId = randomUUID();
      const lines = request.garments.map((line) => ({
        lineId: randomUUID(),
        variantId: line.variant_id,
        guaranteed: line.garment_mode === 'guaranteed',
      }));
      await ensureFittingCapacitySlots(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        capacity: settings.capacity,
      });
      await createFittingAppointmentBase(client, {
        fittingId,
        tenantId: context.tenantId,
        branchId: context.branchId,
        customerId: customer.id,
        startsAt: startsAt.toISOString(),
        endsAt,
        timezoneSnapshot: settings.timezone,
        currency: settings.currency,
        feeMinor,
        internalNote: request.internal_note ?? null,
        businessKey: `staff:${context.membershipId}:${context.idempotencyKey}`,
        garments: lines,
        chargeId,
      });
      const capacitySlotId = await claimFittingCapacitySlot(client, {
        allocationId: capacityAllocationId,
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId,
        startsAt: startsAt.toISOString(),
        endsAt,
      });
      if (!capacitySlotId) {
        throw new CapacityConflictError('No fitting capacity remains for the requested time.');
      }
      await appendFittingCreateAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        fittingId,
        branchId: context.branchId,
        requestId: context.requestId,
      });

      const row = await readFittingDetailModel(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId,
      });
      if (!row) throw new Error('Created fitting could not be read back.');
      const data = fittingCreateResponse.parse({ fitting: toCreatedDetail(row) });
      const body: SuccessEnvelope<FittingCreateResponse> = {
        success: true,
        data,
        request_id: context.requestId,
      };
      await finalizeTenantIdempotency(client, {
        tenantId: context.tenantId,
        principalKey: context.membershipId,
        operation: CREATE_FITTING_OPERATION,
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
      if (isCapacityOverlapViolation(error)) {
        return finalizeKnownFailure(
          client,
          context,
          payloadHash,
          new CapacityConflictError('Fitting capacity was claimed by another appointment.'),
        );
      }
      return finalizeKnownFailure(client, context, payloadHash, error);
    }
  });
}

async function resolveCustomer(
  client: Parameters<typeof readFittingCustomerForCreate>[0],
  tenantId: string,
  request: FittingCreateRequest,
): Promise<FittingCreateCustomerRow> {
  if (request.customer.source === 'existing') {
    const customer = await readFittingCustomerForCreate(client, {
      tenantId,
      customerId: request.customer.customer_id,
    });
    if (!customer) throw new NotFoundError('Customer could not be found.');
    return customer;
  }
  return createFittingCustomer(client, {
    tenantId,
    fullName: request.customer.customer.full_name,
    phone: request.customer.customer.phone ?? null,
    email: request.customer.customer.email ?? null,
  });
}

function assertThirtyMinuteBranchGrid(instant: string, timezone: string): void {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    if (
      Number(parts['minute']) % 30 !== 0 ||
      Number(parts['second']) !== 0 ||
      new Date(instant).getUTCMilliseconds() !== 0
    ) {
      throw new ValidationError('Fitting start must align to the branch-local 30-minute grid.');
    }
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new StateConflictError('The branch timezone is invalid.');
  }
}

function toCreatedDetail(row: Awaited<ReturnType<typeof readFittingDetailModel>>): FittingDetail {
  if (!row) throw new Error('Missing fitting detail.');
  const garments = Array.isArray(row.garments) ? row.garments : [];
  return fittingDetail.parse({
    id: row.fitting_id,
    branch_id: row.branch_id,
    booking_channel: row.booking_channel,
    status: row.status,
    period: { start: row.starts_at.toISOString(), end: row.ends_at.toISOString() },
    timezone_snapshot: row.timezone_snapshot,
    customer: {
      id: row.customer_id,
      full_name: row.customer_full_name,
      phone: row.customer_phone,
      email: row.customer_email,
    },
    garments: garments.map((raw) => {
      const line = raw as Record<string, unknown>;
      return {
        id: line.id,
        variant: {
          variant_id: line.variant_id,
          product_name: line.product_name,
          sku: line.sku,
          size_label: line.size_label,
          color_label: line.color_label,
        },
        garment_mode: line.garment_guaranteed ? 'guaranteed' : 'preference',
        assigned_asset: null,
      };
    }),
    fee: { fee_minor: String(row.fee_minor), currency: row.currency, payment: null },
    internal_note: row.internal_note,
    terminal_reason: row.terminal_reason,
    attention: 'none',
    allowed_actions: [
      'confirm',
      'reject',
      'cancel',
      'reschedule',
      'update_garments',
      'update_note',
    ],
    version: Number(row.version),
    created_at: row.created_at.toISOString(),
  });
}

function replayOrThrow(claim: TenantIdempotencyClaim): FittingCreateCommandResponse | null {
  if (claim.kind === 'replayed')
    return {
      status: claim.responseCode,
      body: claim.safeResponse as FittingCreateCommandResponse['body'],
    };
  if (claim.kind === 'key_reused')
    throw new IdempotencyKeyReusedError(
      'This Idempotency-Key was already used for another request.',
    );
  if (claim.kind === 'in_progress')
    throw new StateConflictError(
      'An identical fitting request is already being processed. Retry shortly.',
    );
  return null;
}

function isCapacityOverlapViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23P01' &&
    'constraint' in error &&
    (error as { constraint?: unknown }).constraint === 'fitting_slot_allocation_no_overlap'
  );
}

async function finalizeKnownFailure(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: FittingCreateContext,
  payloadHash: string,
  error: unknown,
): Promise<FittingCreateCommandResponse> {
  if (!isAppError(error)) throw error;
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation: CREATE_FITTING_OPERATION,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body };
}
