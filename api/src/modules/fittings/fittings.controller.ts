import type { Request, Response } from 'express';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import {
  createStaffFittingCommand,
  type FittingCreateContext,
} from './fittings.command.service.js';
import {
  attachFittingPaymentReceiptCommand,
  createFittingPaymentIntentCommand,
  verifyFittingPaymentCommand,
  type FittingFinanceContext,
} from './fittings.finance.service.js';
import {
  cancelFittingCommand,
  completeFittingCommand,
  confirmFittingCommand,
  markFittingNoShowCommand,
  rejectFittingCommand,
  rescheduleFittingCommand,
  updateFittingGarmentPlanCommand,
  updateFittingNoteCommand,
  type FittingLifecycleContext,
  type FittingMutationContext,
} from './fittings.mutation.service.js';
import {
  createFittingClosureCommand,
  removeFittingClosureCommand,
  updateFittingClosureCommand,
  updateFittingSettingsCommand,
  updateFittingWeeklyHoursCommand,
  type FittingClosureCommandContext,
  type FittingConfigurationCommandContext,
} from './fittings.schedule.command.service.js';
import {
  getFittingClosures,
  getFittingDetail,
  getFittingIntakeOptions,
  getFittingList,
  getFittingSettings,
  type FittingReadContext,
} from './fittings.service.js';

export async function listFittingsController(req: Request, res: Response): Promise<void> {
  if (!req.fittingListQuery) throw new ValidationError('Fitting list query is invalid.');
  sendSuccess(req, res, await getFittingList(readContext(req), req.fittingListQuery));
}

export async function getFittingController(req: Request, res: Response): Promise<void> {
  if (!req.fittingId) throw new ValidationError('A valid fitting id is required.');
  sendSuccess(req, res, await getFittingDetail(readContext(req), req.fittingId));
}

export async function getFittingIntakeController(req: Request, res: Response): Promise<void> {
  if (!req.fittingIntakeQuery) throw new ValidationError('Fitting intake query is invalid.');
  sendSuccess(req, res, await getFittingIntakeOptions(readContext(req), req.fittingIntakeQuery));
}

export async function createFittingController(req: Request, res: Response): Promise<void> {
  if (!req.fittingCreateRequest) throw new ValidationError('Staff fitting request is invalid.');
  const result = await createStaffFittingCommand(commandContext(req), req.fittingCreateRequest);
  res.status(result.status).json(result.body);
}

export async function updateFittingNoteController(req: Request, res: Response): Promise<void> {
  if (!req.fittingNoteUpdateRequest) throw new ValidationError('Fitting note request is invalid.');
  const result = await updateFittingNoteCommand(
    lifecycleContext(req),
    req.fittingNoteUpdateRequest,
  );
  res.status(result.status).json(result.body);
}

export async function updateFittingGarmentsController(req: Request, res: Response): Promise<void> {
  if (!req.fittingGarmentPlanUpdateRequest) {
    throw new ValidationError('Fitting garment plan request is invalid.');
  }
  const result = await updateFittingGarmentPlanCommand(
    mutationContext(req),
    req.fittingGarmentPlanUpdateRequest,
  );
  res.status(result.status).json(result.body);
}

export async function rescheduleFittingController(req: Request, res: Response): Promise<void> {
  if (!req.fittingRescheduleRequest)
    throw new ValidationError('Fitting reschedule request is invalid.');
  const result = await rescheduleFittingCommand(mutationContext(req), req.fittingRescheduleRequest);
  res.status(result.status).json(result.body);
}

export async function confirmFittingController(req: Request, res: Response): Promise<void> {
  if (!req.fittingConfirmRequest)
    throw new ValidationError('Fitting confirmation request is invalid.');
  const result = await confirmFittingCommand(lifecycleContext(req), req.fittingConfirmRequest);
  res.status(result.status).json(result.body);
}

export async function rejectFittingController(req: Request, res: Response): Promise<void> {
  if (!req.fittingRejectRequest) throw new ValidationError('Fitting rejection request is invalid.');
  const result = await rejectFittingCommand(lifecycleContext(req), req.fittingRejectRequest);
  res.status(result.status).json(result.body);
}

export async function cancelFittingController(req: Request, res: Response): Promise<void> {
  if (!req.fittingCancelRequest)
    throw new ValidationError('Fitting cancellation request is invalid.');
  const result = await cancelFittingCommand(lifecycleContext(req), req.fittingCancelRequest);
  res.status(result.status).json(result.body);
}

export async function completeFittingController(req: Request, res: Response): Promise<void> {
  if (!req.fittingCompleteRequest)
    throw new ValidationError('Fitting completion request is invalid.');
  const result = await completeFittingCommand(lifecycleContext(req), req.fittingCompleteRequest);
  res.status(result.status).json(result.body);
}

export async function noShowFittingController(req: Request, res: Response): Promise<void> {
  if (!req.fittingNoShowRequest) throw new ValidationError('Fitting no-show request is invalid.');
  const result = await markFittingNoShowCommand(lifecycleContext(req), req.fittingNoShowRequest);
  res.status(result.status).json(result.body);
}

export async function createFittingPaymentController(req: Request, res: Response): Promise<void> {
  if (!req.fittingPaymentIntentCreateRequest) {
    throw new ValidationError('Fitting payment request is invalid.');
  }
  const result = await createFittingPaymentIntentCommand(
    financeContext(req),
    req.fittingPaymentIntentCreateRequest,
  );
  res.status(result.status).json(result.body);
}

export async function attachFittingPaymentReceiptController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.fittingPaymentReceiptAttachRequest) {
    throw new ValidationError('Fitting payment receipt request is invalid.');
  }
  const result = await attachFittingPaymentReceiptCommand(
    financeContext(req),
    req.fittingPaymentReceiptAttachRequest,
  );
  res.status(result.status).json(result.body);
}

export async function verifyFittingPaymentController(req: Request, res: Response): Promise<void> {
  if (!req.fittingPaymentVerifyRequest) {
    throw new ValidationError('Fitting payment verification request is invalid.');
  }
  const result = await verifyFittingPaymentCommand(
    financeContext(req),
    req.fittingPaymentVerifyRequest,
  );
  res.status(result.status).json(result.body);
}

export async function getFittingSettingsController(req: Request, res: Response): Promise<void> {
  sendSuccess(req, res, await getFittingSettings(readContext(req)));
}

export async function updateFittingSettingsController(req: Request, res: Response): Promise<void> {
  if (!req.fittingSettingsUpdateRequest)
    throw new ValidationError('Fitting settings request is invalid.');
  const result = await updateFittingSettingsCommand(
    configurationContext(req),
    req.fittingSettingsUpdateRequest,
  );
  res.status(result.status).json(result.body);
}

export async function updateFittingHoursController(req: Request, res: Response): Promise<void> {
  if (!req.fittingWeeklyHoursUpdateRequest) {
    throw new ValidationError('Weekly fitting-hours request is invalid.');
  }
  const result = await updateFittingWeeklyHoursCommand(
    configurationContext(req),
    req.fittingWeeklyHoursUpdateRequest,
  );
  res.status(result.status).json(result.body);
}

export async function listFittingClosuresController(req: Request, res: Response): Promise<void> {
  if (!req.fittingClosureListQuery) throw new ValidationError('Fitting closure query is invalid.');
  sendSuccess(req, res, await getFittingClosures(readContext(req), req.fittingClosureListQuery));
}

export async function createFittingClosureController(req: Request, res: Response): Promise<void> {
  if (!req.fittingClosureCreateRequest)
    throw new ValidationError('Fitting closure request is invalid.');
  const result = await createFittingClosureCommand(
    configurationContext(req),
    req.fittingClosureCreateRequest,
  );
  res.status(result.status).json(result.body);
}

export async function updateFittingClosureController(req: Request, res: Response): Promise<void> {
  if (!req.fittingClosureUpdateRequest)
    throw new ValidationError('Fitting closure request is invalid.');
  const result = await updateFittingClosureCommand(
    closureContext(req),
    req.fittingClosureUpdateRequest,
  );
  res.status(result.status).json(result.body);
}

export async function removeFittingClosureController(req: Request, res: Response): Promise<void> {
  if (!req.fittingClosureRemoveRequest) {
    throw new ValidationError('Fitting closure removal request is invalid.');
  }
  const result = await removeFittingClosureCommand(
    closureContext(req),
    req.fittingClosureRemoveRequest,
  );
  res.status(result.status).json(result.body);
}

function requireTenant(req: Request): NonNullable<Request['tenantContext']> {
  const context = req.tenantContext;
  if (!context) throw new ValidationError('Tenant context is required.');
  return context;
}

function requireFittingId(req: Request): string {
  if (!req.fittingId) throw new ValidationError('A valid fitting id is required.');
  return req.fittingId;
}

function requireIdempotencyKey(req: Request): string {
  if (!req.fittingIdempotencyKey) {
    throw new ValidationError('A valid Idempotency-Key header is required.');
  }
  return req.fittingIdempotencyKey;
}

function readContext(req: Request): FittingReadContext {
  const tenant = requireTenant(req);
  return {
    tenantId: tenant.tenantId,
    branchId: tenant.activeBranchId,
    membershipId: tenant.membershipId,
    principalId: req.clerkPrincipal?.clerkUserId ?? '',
    permissionCodes: tenant.permissionCodes,
    effectiveTenantStatus: tenant.effectiveTenantStatus,
  };
}

function commandContext(req: Request): FittingCreateContext {
  const tenant = requireTenant(req);
  return {
    tenantId: tenant.tenantId,
    branchId: tenant.activeBranchId,
    membershipId: tenant.membershipId,
    principalId: req.clerkPrincipal?.clerkUserId ?? '',
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
  };
}

function mutationContext(req: Request): FittingMutationContext {
  return { ...commandContext(req), fittingId: requireFittingId(req) };
}

function lifecycleContext(req: Request): FittingLifecycleContext {
  const tenant = requireTenant(req);
  return { ...mutationContext(req), permissionCodes: tenant.permissionCodes };
}

function financeContext(req: Request): FittingFinanceContext {
  const tenant = requireTenant(req);
  return {
    ...mutationContext(req),
    permissionCodes: tenant.permissionCodes,
    role: tenant.role,
    effectiveTenantStatus: tenant.effectiveTenantStatus,
  };
}

function configurationContext(req: Request): FittingConfigurationCommandContext {
  const tenant = requireTenant(req);
  return {
    tenantId: tenant.tenantId,
    branchId: tenant.activeBranchId,
    membershipId: tenant.membershipId,
    principalId: req.clerkPrincipal?.clerkUserId ?? '',
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    role: tenant.role,
    effectiveTenantStatus: tenant.effectiveTenantStatus,
  };
}

function closureContext(req: Request): FittingClosureCommandContext {
  if (!req.fittingClosureId) throw new ValidationError('A valid fitting closure id is required.');
  return { ...configurationContext(req), closureId: req.fittingClosureId };
}
