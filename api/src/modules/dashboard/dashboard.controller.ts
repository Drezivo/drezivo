import type { Request, Response } from 'express';

import { ForbiddenError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import { getDashboardOverview } from './dashboard.service.js';

export async function getDashboardOverviewController(req: Request, res: Response): Promise<void> {
  const context = req.tenantContext;
  const principalId = req.clerkPrincipal?.clerkUserId;
  if (!context || !principalId) throw new ForbiddenError('Tenant context is required.');

  sendSuccess(
    req,
    res,
    await getDashboardOverview({
      tenantId: context.tenantId,
      branchId: context.activeBranchId,
      principalId,
      permissionCodes: context.permissionCodes,
    }),
  );
}
