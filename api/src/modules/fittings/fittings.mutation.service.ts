import { randomUUID } from 'node:crypto';

import {
  fittingActionResponse,
  fittingCancelRequest,
  fittingCompleteRequest,
  fittingConfirmRequest,
  fittingGarmentPlanUpdateRequest,
  fittingGarmentPlanUpdateResponse,
  fittingNoShowRequest,
  fittingNoteUpdateRequest,
  fittingNoteUpdateResponse,
  fittingRejectRequest,
  fittingRescheduleRequest,
  type FittingActionResponse,
  type FittingCancelRequest,
  type FittingCompleteRequest,
  type FittingConfirmRequest,
  type FittingDetail,
  type FittingGarmentPlanUpdateRequest,
  type FittingGarmentPlanUpdateResponse,
  type FittingNoShowRequest,
  type FittingNoteUpdateRequest,
  type FittingNoteUpdateResponse,
  type FittingRejectRequest,
  type FittingRescheduleRequest,
  type PermissionCode,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import {
  AssetUnavailableError,
  CapacityConflictError,
  ForbiddenError,
  IdempotencyKeyReusedError,
  NotFoundError,
  ScheduleConflictError,
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
import {
  appendFittingMutationAudit,
  bumpFittingVersion,
  chooseAvailableFittingAsset,
  ensureFittingCapacitySlots,
  insertFittingAssetAllocation,
  insertFittingLine,
  lockActiveFittingLines,
  lockEligibleFittingAssets,
  lockFittingAppointmentForMutation,
  lockFittingCreateSettings,
  moveFittingAssetClaim,
  moveFittingCapacityClaim,
  readBlockingFittingAssetAllocation,
  readFittingVariantsForCreate,
  releaseFittingBlockingClaims,
  retireFittingLine,
  transitionFittingLifecycle,
  updateFittingInternalNote,
  updateFittingPeriodAndVersion,
  validateFittingScheduleForCreate,
  verifyFittingRequiredClaims,
  type ActiveFittingLineRow,
  type FittingLifecycleTimingGuard,
  type LockedFittingAppointmentRow,
} from './fittings.command.repository.js';
import { recordFittingCommandFailure } from './fittings.observability.js';
import { readFittingDetailModel } from './fittings.repository.js';

const RESCHEDULE_OPERATION = 'fitting.reschedule';
const NOTE_OPERATION = 'fitting.note.update';
const GARMENT_PLAN_OPERATION = 'fitting.garment-plan.update';
const MUTATION_SAVEPOINT = 'fitting_mutation_effects';

type ScheduledFittingStatus = 'pending' | 'confirmed';
type TerminalFittingStatus = 'completed' | 'rejected' | 'cancelled' | 'no_show';
type LifecycleTargetStatus = 'confirmed' | TerminalFittingStatus;
type LifecycleAuditAction =
  | 'fitting.confirmed'
  | 'fitting.rejected'
  | 'fitting.cancelled'
  | 'fitting.completed'
  | 'fitting.marked_no_show';

interface FittingLifecycleSpec {
  operation: string;
  allowedStatuses: readonly ScheduledFittingStatus[];
  nextStatus: LifecycleTargetStatus;
  timingGuard: FittingLifecycleTimingGuard;
  releaseClaims: boolean;
  auditAction: LifecycleAuditAction;
}

const CONFIRM_SPEC: FittingLifecycleSpec = {
  operation: 'fitting.confirm',
  allowedStatuses: ['pending'],
  nextStatus: 'confirmed',
  timingGuard: 'none',
  releaseClaims: false,
  auditAction: 'fitting.confirmed',
};
const REJECT_SPEC: FittingLifecycleSpec = {
  operation: 'fitting.reject',
  allowedStatuses: ['pending'],
  nextStatus: 'rejected',
  timingGuard: 'before_start',
  releaseClaims: true,
  auditAction: 'fitting.rejected',
};
const CANCEL_SPEC: FittingLifecycleSpec = {
  operation: 'fitting.cancel',
  allowedStatuses: ['pending', 'confirmed'],
  nextStatus: 'cancelled',
  timingGuard: 'before_start',
  releaseClaims: true,
  auditAction: 'fitting.cancelled',
};
const COMPLETE_SPEC: FittingLifecycleSpec = {
  operation: 'fitting.complete',
  allowedStatuses: ['confirmed'],
  nextStatus: 'completed',
  timingGuard: 'at_or_after_end',
  releaseClaims: true,
  auditAction: 'fitting.completed',
};
const NO_SHOW_SPEC: FittingLifecycleSpec = {
  operation: 'fitting.mark-no-show',
  allowedStatuses: ['confirmed'],
  nextStatus: 'no_show',
  timingGuard: 'at_or_after_start',
  releaseClaims: true,
  auditAction: 'fitting.marked_no_show',
};

export interface FittingMutationContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  fittingId: string;
}

export interface FittingLifecycleContext extends FittingMutationContext {
  permissionCodes: PermissionCode[];
}

export interface FittingActionCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingActionResponse> | FailureEnvelope;
}

export interface FittingNoteCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingNoteUpdateResponse> | FailureEnvelope;
}

export interface FittingGarmentPlanCommandResponse {
  status: number;
  body: SuccessEnvelope<FittingGarmentPlanUpdateResponse> | FailureEnvelope;
}

export async function confirmFittingCommand(
  context: FittingLifecycleContext,
  requestInput: FittingConfirmRequest,
): Promise<FittingActionCommandResponse> {
  const parsed = fittingConfirmRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting confirmation request is invalid.');
  return runFittingLifecycleCommand(context, parsed.data, CONFIRM_SPEC);
}

export async function rejectFittingCommand(
  context: FittingLifecycleContext,
  requestInput: FittingRejectRequest,
): Promise<FittingActionCommandResponse> {
  const parsed = fittingRejectRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting rejection request is invalid.');
  return runFittingLifecycleCommand(context, parsed.data, REJECT_SPEC);
}

export async function cancelFittingCommand(
  context: FittingLifecycleContext,
  requestInput: FittingCancelRequest,
): Promise<FittingActionCommandResponse> {
  const parsed = fittingCancelRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting cancellation request is invalid.');
  return runFittingLifecycleCommand(context, parsed.data, CANCEL_SPEC);
}

export async function completeFittingCommand(
  context: FittingLifecycleContext,
  requestInput: FittingCompleteRequest,
): Promise<FittingActionCommandResponse> {
  const parsed = fittingCompleteRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting completion request is invalid.');
  return runFittingLifecycleCommand(context, parsed.data, COMPLETE_SPEC);
}

export async function markFittingNoShowCommand(
  context: FittingLifecycleContext,
  requestInput: FittingNoShowRequest,
): Promise<FittingActionCommandResponse> {
  const parsed = fittingNoShowRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting no-show request is invalid.');
  return runFittingLifecycleCommand(context, parsed.data, NO_SHOW_SPEC);
}

export async function updateFittingNoteCommand(
  context: FittingLifecycleContext,
  requestInput: FittingNoteUpdateRequest,
): Promise<FittingNoteCommandResponse> {
  const parsed = fittingNoteUpdateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting note request is invalid.');
  if (!context.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('This branch does not grant fitting management access.');
  }
  const request = parsed.data;
  const payloadHash = canonicalRequestHash(request);

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimMutationIdempotency(client, context, NOTE_OPERATION, payloadHash);
    const replay = replayOrThrow<FittingNoteCommandResponse>(claim);
    if (replay) return replay;

    try {
      const appointment = await lockFittingAppointmentForMutation(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId: context.fittingId,
      });
      if (!appointment) throw new NotFoundError('Fitting could not be found.');
      if (
        Number(appointment.version) !== request.version ||
        !['pending', 'confirmed'].includes(appointment.status)
      ) {
        throw new StateConflictError('Fitting changed or no longer accepts note updates.');
      }
      const version = await updateFittingInternalNote(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId: context.fittingId,
        version: request.version,
        internalNote: request.internal_note,
      });
      if (!version)
        throw new StateConflictError('Fitting changed before the note could be updated.');
      await appendFittingMutationAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'fitting.note_updated',
        fittingId: context.fittingId,
        branchId: context.branchId,
        requestId: context.requestId,
        version,
      });
      const row = await readFittingDetailModel(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId: context.fittingId,
      });
      if (!row) throw new Error('Updated fitting note could not be read back.');
      const body: SuccessEnvelope<FittingNoteUpdateResponse> = {
        success: true,
        data: fittingNoteUpdateResponse.parse({ fitting: toFittingDetail(row) }),
        request_id: context.requestId,
      };
      await finalizeMutationSuccess(client, context, NOTE_OPERATION, payloadHash, body);
      return { status: 200, body };
    } catch (error) {
      return finalizeMutationFailure(client, context, NOTE_OPERATION, payloadHash, error);
    }
  });
}

/** Atomic period replacement: replacement slot/assets are acquired by in-place protected claims. */
export async function rescheduleFittingCommand(
  context: FittingMutationContext,
  requestInput: FittingRescheduleRequest,
): Promise<FittingActionCommandResponse> {
  const parsed = fittingRescheduleRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting reschedule request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash(request);

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimMutationIdempotency(
      client,
      context,
      RESCHEDULE_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingActionCommandResponse>(claim);
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

      const appointment = await lockFittingAppointmentForMutation(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId: context.fittingId,
      });
      assertFutureMutableAppointment(appointment, request.version);
      assertThirtyMinuteBranchGrid(request.starts_at, settings.timezone);

      const durationMs = appointment.ends_at.getTime() - appointment.starts_at.getTime();
      const newStartsAt = new Date(request.starts_at);
      const newEndsAt = new Date(newStartsAt.getTime() + durationMs).toISOString();
      const schedule = await validateFittingScheduleForCreate(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        startsAt: newStartsAt.toISOString(),
        endsAt: newEndsAt,
      });
      assertScheduleAllowed(schedule);

      await ensureFittingCapacitySlots(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        capacity: settings.capacity,
      });

      const lines = await lockActiveFittingLines(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      const guaranteedLines = lines.filter((line) => line.garment_guaranteed);
      const guaranteedVariantIds = [...new Set(guaranteedLines.map((line) => line.variant_id))];
      const lockedAssets = await lockEligibleFittingAssets(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        variantIds: guaranteedVariantIds,
      });
      const candidateAssetIds = lockedAssets.map((asset) => asset.id);
      const selectedAssetIds: string[] = [];
      const replacements: Array<{
        line: ActiveFittingLineRow;
        allocationId: string;
        assetId: string;
      }> = [];
      for (const line of guaranteedLines) {
        const allocation = await readBlockingFittingAssetAllocation(client, {
          tenantId: context.tenantId,
          fittingLineId: line.id,
        });
        if (!allocation || !line.asset_id) {
          throw new StateConflictError(
            'Guaranteed fitting garment has lost its active allocation.',
          );
        }
        const assetId = await chooseAvailableFittingAsset(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          variantId: line.variant_id,
          candidateAssetIds,
          startsAt: newStartsAt.toISOString(),
          endsAt: newEndsAt,
          excludedAssetIds: selectedAssetIds,
          ignoredAllocationId: allocation.id,
          preferredAssetId: line.asset_id,
        });
        if (!assetId) {
          throw new AssetUnavailableError(
            'A guaranteed garment is unavailable for the new fitting time.',
          );
        }
        selectedAssetIds.push(assetId);
        replacements.push({ line, allocationId: allocation.id, assetId });
      }

      await client.query(`SAVEPOINT ${MUTATION_SAVEPOINT}`);
      savepointOpen = true;
      const slotId = await moveFittingCapacityClaim(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId: context.fittingId,
        newAllocationId: randomUUID(),
        startsAt: newStartsAt.toISOString(),
        endsAt: newEndsAt,
      });
      if (!slotId)
        throw new CapacityConflictError('No fitting capacity remains for the requested time.');

      for (const replacement of replacements) {
        await moveFittingAssetClaim(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          fittingLineId: replacement.line.id,
          allocationId: replacement.allocationId,
          newAllocationId: randomUUID(),
          assetId: replacement.assetId,
          startsAt: newStartsAt.toISOString(),
          endsAt: newEndsAt,
        });
      }

      const version = await updateFittingPeriodAndVersion(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
        version: request.version,
        startsAt: newStartsAt.toISOString(),
        endsAt: newEndsAt,
        timezoneSnapshot: settings.timezone,
      });
      if (!version) throw new StateConflictError('Fitting changed before it could be rescheduled.');
      await appendFittingMutationAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'fitting.rescheduled',
        fittingId: context.fittingId,
        branchId: context.branchId,
        requestId: context.requestId,
        version,
      });
      const body = await buildActionSuccess(client, context);
      await finalizeMutationSuccess(client, context, RESCHEDULE_OPERATION, payloadHash, body);
      await client.query(`RELEASE SAVEPOINT ${MUTATION_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 200, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${MUTATION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${MUTATION_SAVEPOINT}`);
      }
      return finalizeMutationFailure(
        client,
        context,
        RESCHEDULE_OPERATION,
        payloadHash,
        mapClaimConflict(error),
      );
    }
  });
}

/** Full future garment-plan replacement with new guarantees secured before old lines are retired. */
export async function updateFittingGarmentPlanCommand(
  context: FittingMutationContext,
  requestInput: FittingGarmentPlanUpdateRequest,
): Promise<FittingGarmentPlanCommandResponse> {
  const parsed = fittingGarmentPlanUpdateRequest.safeParse(requestInput);
  if (!parsed.success) throw new ValidationError('Fitting garment plan request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash(request);

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimMutationIdempotency(
      client,
      context,
      GARMENT_PLAN_OPERATION,
      payloadHash,
    );
    const replay = replayOrThrow<FittingGarmentPlanCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const appointment = await lockFittingAppointmentForMutation(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId: context.fittingId,
      });
      assertFutureMutableAppointment(appointment, request.version);

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

      const existing = await lockActiveFittingLines(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
      });
      const usedExisting = new Set<string>();
      const preservedAssetIds: string[] = [];
      const additions: Array<{
        variantId: string;
        guaranteed: boolean;
        assetId: string | null;
        lineId: string;
        allocationId: string | null;
      }> = [];
      const unmatchedRequests: Array<{ variantId: string; guaranteed: boolean }> = [];

      for (const requested of request.garments) {
        const guaranteed = requested.garment_mode === 'guaranteed';
        const match = existing.find(
          (line) =>
            !usedExisting.has(line.id) &&
            line.variant_id === requested.variant_id &&
            line.garment_guaranteed === guaranteed,
        );
        if (match) {
          usedExisting.add(match.id);
          if (match.garment_guaranteed && match.asset_id) preservedAssetIds.push(match.asset_id);
        } else {
          unmatchedRequests.push({ variantId: requested.variant_id, guaranteed });
        }
      }

      const guaranteedVariantIds = [
        ...new Set(
          unmatchedRequests.filter((line) => line.guaranteed).map((line) => line.variantId),
        ),
      ];
      const lockedAssets = await lockEligibleFittingAssets(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        variantIds: guaranteedVariantIds,
      });
      const candidateAssetIds = lockedAssets.map((asset) => asset.id);
      const selectedAssetIds = [...preservedAssetIds];
      for (const requested of unmatchedRequests) {
        const lineId = randomUUID();
        if (!requested.guaranteed) {
          additions.push({
            variantId: requested.variantId,
            guaranteed: false,
            assetId: null,
            lineId,
            allocationId: null,
          });
          continue;
        }
        const assetId = await chooseAvailableFittingAsset(client, {
          tenantId: context.tenantId,
          branchId: context.branchId,
          variantId: requested.variantId,
          candidateAssetIds,
          startsAt: appointment.starts_at.toISOString(),
          endsAt: appointment.ends_at.toISOString(),
          excludedAssetIds: selectedAssetIds,
        });
        if (!assetId) {
          throw new AssetUnavailableError(
            'No eligible physical garment is available for the updated fitting plan.',
          );
        }
        selectedAssetIds.push(assetId);
        additions.push({
          variantId: requested.variantId,
          guaranteed: true,
          assetId,
          lineId,
          allocationId: randomUUID(),
        });
      }

      await client.query(`SAVEPOINT ${MUTATION_SAVEPOINT}`);
      savepointOpen = true;
      for (const addition of additions) {
        await insertFittingLine(client, {
          lineId: addition.lineId,
          tenantId: context.tenantId,
          fittingId: context.fittingId,
          variantId: addition.variantId,
          guaranteed: addition.guaranteed,
          assetId: addition.assetId,
        });
        if (addition.guaranteed && addition.assetId && addition.allocationId) {
          await insertFittingAssetAllocation(client, {
            allocationId: addition.allocationId,
            tenantId: context.tenantId,
            branchId: context.branchId,
            assetId: addition.assetId,
            fittingLineId: addition.lineId,
            startsAt: appointment.starts_at.toISOString(),
            endsAt: appointment.ends_at.toISOString(),
          });
        }
      }

      for (const oldLine of existing) {
        if (usedExisting.has(oldLine.id)) continue;
        await retireFittingLine(client, {
          tenantId: context.tenantId,
          fittingLineId: oldLine.id,
        });
      }

      const version = await bumpFittingVersion(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
        version: request.version,
      });
      if (!version)
        throw new StateConflictError('Fitting changed before its garment plan could be updated.');
      await appendFittingMutationAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: 'fitting.garment_changed',
        fittingId: context.fittingId,
        branchId: context.branchId,
        requestId: context.requestId,
        version,
      });

      const row = await readFittingDetailModel(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId: context.fittingId,
      });
      if (!row) throw new Error('Updated fitting could not be read back.');
      const data = fittingGarmentPlanUpdateResponse.parse({ fitting: toFittingDetail(row) });
      const body: SuccessEnvelope<FittingGarmentPlanUpdateResponse> = {
        success: true,
        data,
        request_id: context.requestId,
      };
      await finalizeMutationSuccess(client, context, GARMENT_PLAN_OPERATION, payloadHash, body);
      await client.query(`RELEASE SAVEPOINT ${MUTATION_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 200, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${MUTATION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${MUTATION_SAVEPOINT}`);
      }
      return finalizeMutationFailure(
        client,
        context,
        GARMENT_PLAN_OPERATION,
        payloadHash,
        mapClaimConflict(error),
      );
    }
  });
}

async function runFittingLifecycleCommand(
  context: FittingLifecycleContext,
  request: { version: number; reason?: string },
  spec: FittingLifecycleSpec,
): Promise<FittingActionCommandResponse> {
  if (!context.permissionCodes.includes('reservations.manage')) {
    throw new ForbiddenError('This branch does not grant fitting management access.');
  }
  const payloadHash = canonicalRequestHash(request);

  return withTenantTransaction(context.tenantId, context.principalId, async (client) => {
    const claim = await claimMutationIdempotency(client, context, spec.operation, payloadHash);
    const replay = replayOrThrow<FittingActionCommandResponse>(claim);
    if (replay) return replay;

    let savepointOpen = false;
    try {
      const appointment = await lockFittingAppointmentForMutation(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId: context.fittingId,
      });
      assertLifecycleCommandAllowed(appointment, request.version, spec);

      const claimsValid = await verifyFittingRequiredClaims(client, {
        tenantId: context.tenantId,
        branchId: context.branchId,
        fittingId: context.fittingId,
      });
      if (!claimsValid) {
        throw new StateConflictError(
          'Fitting no longer owns the capacity or guaranteed garment claims required by its schedule.',
        );
      }

      await client.query(`SAVEPOINT ${MUTATION_SAVEPOINT}`);
      savepointOpen = true;

      if (spec.releaseClaims) {
        const released = await releaseFittingBlockingClaims(client, {
          tenantId: context.tenantId,
          fittingId: context.fittingId,
        });
        if (released.capacityReleased !== 1) {
          throw new StateConflictError(
            'Fitting capacity claim could not be released exactly once.',
          );
        }
      }

      const version = await transitionFittingLifecycle(client, {
        tenantId: context.tenantId,
        fittingId: context.fittingId,
        version: request.version,
        expectedStatus: appointment.status,
        nextStatus: spec.nextStatus,
        reason: request.reason ?? null,
        timingGuard: spec.timingGuard,
      });
      if (!version) {
        throw new StateConflictError(
          'Fitting changed or crossed its lifecycle timing boundary before this action could complete.',
        );
      }

      await appendFittingMutationAudit(client, {
        tenantId: context.tenantId,
        actorKey: context.principalId,
        action: spec.auditAction,
        fittingId: context.fittingId,
        branchId: context.branchId,
        requestId: context.requestId,
        version,
        status: spec.nextStatus,
      });

      const body = await buildActionSuccess(client, context);
      await finalizeMutationSuccess(client, context, spec.operation, payloadHash, body);
      await client.query(`RELEASE SAVEPOINT ${MUTATION_SAVEPOINT}`);
      savepointOpen = false;
      return { status: 200, body };
    } catch (error) {
      if (savepointOpen) {
        await client.query(`ROLLBACK TO SAVEPOINT ${MUTATION_SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${MUTATION_SAVEPOINT}`);
      }
      return finalizeMutationFailure(client, context, spec.operation, payloadHash, error);
    }
  });
}

function assertLifecycleCommandAllowed(
  appointment: LockedFittingAppointmentRow | null,
  version: number,
  spec: FittingLifecycleSpec,
): asserts appointment is LockedFittingAppointmentRow & { status: ScheduledFittingStatus } {
  if (!appointment) throw new NotFoundError('Fitting could not be found.');
  if (Number(appointment.version) !== version)
    throw new StateConflictError('Fitting version is stale.');
  if (!spec.allowedStatuses.includes(appointment.status as ScheduledFittingStatus)) {
    throw new StateConflictError(
      `Fitting cannot transition from ${appointment.status} to ${spec.nextStatus}.`,
    );
  }
  if (spec.timingGuard === 'before_start' && !appointment.before_start) {
    throw new StateConflictError(
      'This fitting action is unavailable once scheduled start is reached.',
    );
  }
  if (spec.timingGuard === 'at_or_after_start' && !appointment.at_or_after_start) {
    throw new StateConflictError('A fitting can be marked no-show only after scheduled start.');
  }
  if (spec.timingGuard === 'at_or_after_end' && !appointment.at_or_after_end) {
    throw new StateConflictError('A fitting can be completed only at or after scheduled end.');
  }
}

function assertFutureMutableAppointment(
  appointment: Awaited<ReturnType<typeof lockFittingAppointmentForMutation>>,
  version: number,
): asserts appointment is NonNullable<
  Awaited<ReturnType<typeof lockFittingAppointmentForMutation>>
> {
  if (!appointment) throw new NotFoundError('Fitting could not be found.');
  if (Number(appointment.version) !== version)
    throw new StateConflictError('Fitting version is stale.');
  if (appointment.status !== 'pending' && appointment.status !== 'confirmed') {
    throw new StateConflictError('Terminal fittings cannot change schedule or garment plan.');
  }
  if (!appointment.before_start) {
    throw new StateConflictError(
      'Fitting schedule and garment plan are frozen at scheduled start.',
    );
  }
}

function assertScheduleAllowed(schedule: {
  is_future: boolean;
  within_weekly_hours: boolean;
  closure_free: boolean;
}): void {
  if (!schedule.is_future) throw new ScheduleConflictError('Fitting start must be in the future.');
  if (!schedule.within_weekly_hours) {
    throw new ScheduleConflictError(
      'Fitting must fit completely inside one branch operating window.',
    );
  }
  if (!schedule.closure_free) throw new ScheduleConflictError('Fitting overlaps a branch closure.');
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

async function buildActionSuccess(
  client: Parameters<typeof readFittingDetailModel>[0],
  context: FittingMutationContext,
): Promise<SuccessEnvelope<FittingActionResponse>> {
  const row = await readFittingDetailModel(client, {
    tenantId: context.tenantId,
    branchId: context.branchId,
    fittingId: context.fittingId,
  });
  if (!row) throw new Error('Updated fitting could not be read back.');
  return {
    success: true,
    data: fittingActionResponse.parse({ fitting: toFittingDetail(row) }),
    request_id: context.requestId,
  };
}

function toFittingDetail(
  row: NonNullable<Awaited<ReturnType<typeof readFittingDetailModel>>>,
): FittingDetail {
  const now = Date.now();
  const allowedActions: FittingDetail['allowed_actions'] = [];
  if (row.status === 'pending') {
    allowedActions.push('update_note', 'confirm');
    if (now < row.starts_at.getTime()) {
      allowedActions.push('reject', 'cancel', 'reschedule', 'update_garments');
    }
  }
  if (row.status === 'confirmed') {
    allowedActions.push('update_note');
    if (now < row.starts_at.getTime()) {
      allowedActions.push('cancel', 'reschedule', 'update_garments');
    }
    if (now >= row.starts_at.getTime()) allowedActions.push('mark_no_show');
    if (now >= row.ends_at.getTime()) allowedActions.push('complete');
  }
  const garments = Array.isArray(row.garments) ? row.garments : [];
  return fittingActionResponse.shape.fitting.parse({
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
      const guaranteed = line.garment_guaranteed === true;
      return {
        id: line.id,
        variant: {
          variant_id: line.variant_id,
          product_name: line.product_name,
          sku: line.sku,
          size_label: line.size_label,
          color_label: line.color_label,
        },
        garment_mode: guaranteed ? 'guaranteed' : 'preference',
        assigned_asset: guaranteed ? { id: line.asset_id, asset_code: line.asset_code } : null,
      };
    }),
    fee: {
      fee_minor: String(row.fee_minor),
      currency: row.currency,
      payment: normalizeFittingPayment(row.payment),
    },
    internal_note: row.internal_note,
    terminal_reason: row.terminal_reason,
    attention:
      (row.status === 'pending' || row.status === 'confirmed') && now >= row.ends_at.getTime()
        ? 'outcome_required'
        : 'none',
    allowed_actions: allowedActions,
    version: Number(row.version),
    created_at: row.created_at.toISOString(),
  });
}

async function claimMutationIdempotency(
  client: Parameters<typeof claimTenantIdempotency>[0],
  context: FittingMutationContext,
  operation: string,
  payloadHash: string,
): Promise<TenantIdempotencyClaim> {
  return claimTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
  });
}

function normalizeFittingPayment(value: unknown): FittingDetail['fee']['payment'] {
  if (!value || typeof value !== 'object') return null;
  const payment = value as Record<string, unknown>;
  return {
    id: String(payment.id) as NonNullable<FittingDetail['fee']['payment']>['id'],
    status: payment.status as NonNullable<FittingDetail['fee']['payment']>['status'],
    evidence_status: payment.evidence_status as NonNullable<
      FittingDetail['fee']['payment']
    >['evidence_status'],
    amount_minor: String(payment.amount_minor),
    currency: String(payment.currency),
    verified_at:
      payment.verified_at instanceof Date
        ? payment.verified_at.toISOString()
        : typeof payment.verified_at === 'string'
          ? payment.verified_at
          : null,
  };
}

function replayOrThrow<T extends { status: number; body: unknown }>(
  claim: TenantIdempotencyClaim,
): T | null {
  if (claim.kind === 'replayed') {
    return { status: claim.responseCode, body: claim.safeResponse } as T;
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError(
      'This Idempotency-Key was already used for another request.',
    );
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError(
      'An identical fitting mutation is already being processed. Retry shortly.',
    );
  }
  return null;
}

async function finalizeMutationSuccess(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: FittingMutationContext,
  operation: string,
  payloadHash: string,
  body: unknown,
): Promise<void> {
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'succeeded',
    responseCode: 200,
    safeResponse: body,
  });
}

async function finalizeMutationFailure<T extends { status: number; body: unknown }>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  context: FittingMutationContext,
  operation: string,
  payloadHash: string,
  error: unknown,
): Promise<T> {
  if (!isAppError(error)) throw error;
  recordFittingCommandFailure({
    operation,
    tenantId: context.tenantId,
    branchId: context.branchId,
    fittingId: context.fittingId,
    requestId: context.requestId,
    error,
  });
  const body: FailureEnvelope = {
    success: false,
    error: { code: error.code, message: error.message },
    request_id: context.requestId,
  };
  await finalizeTenantIdempotency(client, {
    tenantId: context.tenantId,
    principalKey: context.membershipId,
    operation,
    intentKey: context.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body } as T;
}

function mapClaimConflict(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23P01' &&
    'constraint' in error
  ) {
    const constraint = (error as { constraint?: unknown }).constraint;
    if (constraint === 'fitting_slot_allocation_no_overlap') {
      return new CapacityConflictError('Fitting capacity was claimed by another appointment.');
    }
    if (constraint === 'asset_allocation_no_overlap') {
      return new AssetUnavailableError('A guaranteed garment was claimed by another booking.');
    }
  }
  return error;
}
