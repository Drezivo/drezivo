import type { Request, Response } from 'express';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import {
  getDashboardFittingSummary,
  getClothingAvailabilityTimeline,
  getOperationalCalendar,
  type OperationsReadContext,
} from './operations.service.js';

export async function getOperationalCalendarController(req: Request, res: Response): Promise<void> {
  if (!req.operationalCalendarQuery) throw new ValidationError('Calendar query is invalid.');
  sendSuccess(
    req,
    res,
    await getOperationalCalendar(requireContext(req), req.operationalCalendarQuery),
  );
}

export async function getClothingAvailabilityTimelineController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.clothingAvailabilityTimelineQuery) {
    throw new ValidationError('Clothing availability query is invalid.');
  }
  sendSuccess(
    req,
    res,
    await getClothingAvailabilityTimeline(requireContext(req), req.clothingAvailabilityTimelineQuery),
  );
}

export async function getDashboardFittingSummaryController(
  req: Request,
  res: Response,
): Promise<void> {
  sendSuccess(req, res, await getDashboardFittingSummary(requireContext(req)));
}

function requireContext(req: Request): OperationsReadContext {
  const context = req.tenantContext;
  const principalId = req.clerkPrincipal?.clerkUserId;
  if (!context || !principalId) throw new ForbiddenError('Tenant context is required.');
  return {
    tenantId: context.tenantId,
    branchId: context.activeBranchId,
    principalId,
    permissionCodes: context.permissionCodes,
  };
}
