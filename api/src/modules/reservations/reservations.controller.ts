import type { Request, Response } from 'express';

import type { PermissionCode, TenantStatus } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { sendError, sendSuccess } from '../../shared/response.js';
import { createPublicHold, getReservationList } from './reservations.service.js';

export async function listReservationsController(req: Request, res: Response): Promise<void> {
  const query = req.reservationListQuery;
  if (!query) throw new ValidationError('A valid reservation list query is required.');
  sendSuccess(req, res, await getReservationList(requireContext(req), query));
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
