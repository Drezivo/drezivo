import type { Request, Response } from 'express';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import {
  getCustomerList,
  getCustomerSummary,
  type CustomerReadContext,
} from './customers.service.js';

export async function listCustomersController(req: Request, res: Response): Promise<void> {
  const query = req.customerListQuery;
  if (!query) throw new ValidationError('A valid customer list query is required.');
  sendSuccess(req, res, await getCustomerList(requireCustomerContext(req), query));
}

export async function getCustomerSummaryController(req: Request, res: Response): Promise<void> {
  sendSuccess(req, res, await getCustomerSummary(requireCustomerContext(req)));
}

function requireCustomerContext(req: Request): CustomerReadContext {
  const principalId = req.clerkPrincipal?.clerkUserId;
  const context = req.tenantContext;
  if (!principalId || !context) throw new ValidationError('Workspace context is required.');

  return {
    tenantId: context.tenantId,
    branchId: context.activeBranchId,
    principalId,
    permissionCodes: context.permissionCodes,
  };
}
