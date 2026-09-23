import type { Request, Response } from 'express';

import type { PermissionCode, TenantStatus } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { sendError, sendSuccess } from '../../shared/response.js';
import {
  confirmReservation,
  createPublicHold,
  createStaffReservation,
  getReservationDetail,
  getReservationList,
  rejectReservation,
  submitReservation,
} from './reservations.service.js';

export async function listReservationsController(req: Request, res: Response): Promise<void> {
  const query = req.reservationListQuery;
  if (!query) throw new ValidationError('A valid reservation list query is required.');
  sendSuccess(req, res, await getReservationList(requireContext(req), query));
}

export async function getReservationDetailController(req: Request, res: Response): Promise<void> {
  if (!req.reservationId) throw new ValidationError('A valid reservation id is required.');
  sendSuccess(req, res, await getReservationDetail(requireContext(req), req.reservationId));
}

export async function createStaffReservationController(req: Request, res: Response): Promise<void> {
  const request = req.reservationCreateRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!request) throw new ValidationError('Staff reservation request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await createStaffReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    request,
  );
  res.status(result.status).json(result.body);
}

export async function submitReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationSubmitRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation submission request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await submitReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function confirmReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationConfirmRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation confirmation request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await confirmReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export async function rejectReservationController(req: Request, res: Response): Promise<void> {
  const reservationId = req.reservationId;
  const request = req.reservationRejectRequest;
  const idempotencyKey = req.reservationIdempotencyKey;
  if (!reservationId) throw new ValidationError('A valid reservation id is required.');
  if (!request) throw new ValidationError('Reservation rejection request is invalid.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await rejectReservation(
    { ...requireContext(req), requestId: req.requestId, idempotencyKey },
    reservationId,
    request,
  );
  res.status(result.status).json(result.body);
}

export function createPublicHoldController(req: Request, res: Response): void {
  createPublicHold();
  sendError(
    res,
    501,
    'NOT_IMPLEMENTED',
    'Reservation holds are not available in this scaffold.',
    req.requestId,
  );
}

function requireContext(req: Request): {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
} {
  const principalId = req.clerkPrincipal?.clerkUserId;
  const context = req.tenantContext;
  if (!principalId || !context) throw new ValidationError('Workspace context is required.');

  return {
    tenantId: context.tenantId,
    branchId: context.activeBranchId,
    membershipId: context.membershipId,
    principalId,
    permissionCodes: context.permissionCodes,
    effectiveTenantStatus: context.effectiveTenantStatus,
  };
}
