import type { Request, Response } from 'express';

import type {
  CreateClothingRequest,
  PermissionCode,
  SaveMeasurementGuideRequest,
  TenantStatus,
} from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import {
  createClothing,
  getCatalogueCategories,
  getDefaultMeasurementGuide,
  saveMeasurementGuide,
} from './catalogue.service.js';

export async function listCatalogueCategoriesController(req: Request, res: Response): Promise<void> {
  sendSuccess(req, res, await getCatalogueCategories(requireContext(req)));
}

export async function getDefaultMeasurementGuideController(
  req: Request,
  res: Response,
): Promise<void> {
  sendSuccess(req, res, await getDefaultMeasurementGuide(requireContext(req)));
}

export async function saveMeasurementGuideController(req: Request, res: Response): Promise<void> {
  const result = await saveMeasurementGuide({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    request: req.body as SaveMeasurementGuideRequest,
  });
  res.status(result.status).json(result.body);
}

export async function createClothingController(req: Request, res: Response): Promise<void> {
  const result = await createClothing({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    request: req.body as CreateClothingRequest,
  });
  res.status(result.status).json(result.body);
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

function requireIdempotencyKey(req: Request): string {
  if (!req.catalogueIdempotencyKey) {
    throw new ValidationError('A valid Idempotency-Key header is required.');
  }
  return req.catalogueIdempotencyKey;
}
