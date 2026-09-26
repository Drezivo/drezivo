import type { Request, Response } from 'express';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import { getCentralPayments } from './payments.service.js';

export async function getCentralPaymentsController(req: Request, res: Response): Promise<void> {
  if (!req.centralPaymentsQuery) throw new ValidationError('Payments query is invalid.');
  const context = req.tenantContext;
  const principalId = req.clerkPrincipal?.clerkUserId;
  if (!context || !principalId) throw new ForbiddenError('Tenant context is required.');
  sendSuccess(
    req,
    res,
    await getCentralPayments(
      {
        tenantId: context.tenantId,
        branchId: context.activeBranchId,
        principalId,
        permissionCodes: context.permissionCodes,
      },
      req.centralPaymentsQuery,
    ),
  );
}
