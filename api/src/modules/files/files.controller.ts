import type { Request, Response } from 'express';

import type {
  PermissionCode,
  TenantStatus,
  UploadAuthorizationRequest,
} from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { authorizeUpload, finalizeUpload } from './files.service.js';

export async function authorizeUploadController(req: Request, res: Response): Promise<void> {
  const result = await authorizeUpload({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    request: req.body as UploadAuthorizationRequest,
  });
  res.status(result.status).json(result.body);
}

export async function finalizeUploadController(req: Request, res: Response): Promise<void> {
  const fileId = req.fileUploadFileId;
  if (!fileId) throw new ValidationError('A valid file id is required.');
  const result = await finalizeUpload({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    fileId,
  });
  res.status(result.status).json(result.body);
}

function requireContext(req: Request): {
  tenantId: string;
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
    membershipId: context.membershipId,
    principalId,
    permissionCodes: context.permissionCodes,
    effectiveTenantStatus: context.effectiveTenantStatus,
  };
}

function requireIdempotencyKey(req: Request): string {
  if (!req.fileUploadIdempotencyKey) {
    throw new ValidationError('A valid Idempotency-Key header is required.');
  }
  return req.fileUploadIdempotencyKey;
}
