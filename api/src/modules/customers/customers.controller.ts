import type { Request, Response } from 'express';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import {
  getCustomerDetail,
  getCustomerFittingHistory,
  getCustomerList,
  getCustomerReservationHistory,
  getCustomerSummary,
  archiveCustomer,
  updateCustomer,
  type CustomerMutationContext,
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

export async function getCustomerDetailController(req: Request, res: Response): Promise<void> {
  if (!req.customerId) throw new ValidationError('A valid customer id is required.');
  sendSuccess(req, res, await getCustomerDetail(requireCustomerContext(req), req.customerId));
}

export async function listCustomerReservationsController(req: Request, res: Response): Promise<void> {
  const customerId = req.customerId;
  const query = req.customerHistoryQuery;
  if (!customerId || !query) throw new ValidationError('A valid customer history request is required.');
  sendSuccess(
    req,
    res,
    await getCustomerReservationHistory(requireCustomerContext(req), customerId, query),
  );
}

export async function listCustomerFittingsController(req: Request, res: Response): Promise<void> {
  const customerId = req.customerId;
  const query = req.customerHistoryQuery;
  if (!customerId || !query) throw new ValidationError('A valid customer history request is required.');
  sendSuccess(
    req,
    res,
    await getCustomerFittingHistory(requireCustomerContext(req), customerId, query),
  );
}

export async function updateCustomerController(req: Request, res: Response): Promise<void> {
  if (!req.customerId || !req.customerEditRequest || !req.customerIdempotencyKey) {
    throw new ValidationError('A valid customer edit request is required.');
  }
  const result = await updateCustomer(
    requireCustomerMutationContext(req),
    req.customerId,
    req.customerEditRequest,
  );
  res.status(result.status).json(result.body);
}

export async function archiveCustomerController(req: Request, res: Response): Promise<void> {
  if (!req.customerId || !req.customerArchiveRequest || !req.customerIdempotencyKey) {
    throw new ValidationError('A valid customer archive request is required.');
  }
  const result = await archiveCustomer(
    requireCustomerMutationContext(req),
    req.customerId,
    req.customerArchiveRequest,
  );
  res.status(result.status).json(result.body);
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

function requireCustomerMutationContext(req: Request): CustomerMutationContext {
  const context = req.tenantContext;
  const principalId = req.clerkPrincipal?.clerkUserId;
  if (!principalId || !context || !req.customerIdempotencyKey) {
    throw new ValidationError('Workspace context is required.');
  }
  return {
    tenantId: context.tenantId,
    branchId: context.activeBranchId,
    membershipId: context.membershipId,
    principalId,
    permissionCodes: context.permissionCodes,
    effectiveTenantStatus: context.effectiveTenantStatus,
    requestId: req.requestId,
    idempotencyKey: req.customerIdempotencyKey,
  };
}
