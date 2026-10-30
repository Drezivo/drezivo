import type { NextFunction, Request, Response } from 'express';

import { fileObjectId } from '@drezivo/contracts';
import type {
  PermissionCode,
  TenantStatus,
  UploadAuthorizationRequest,
} from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { streamFileResponse } from './file-stream.js';
import { authorizeUpload, finalizeUpload, readStaffFile } from './files.service.js';

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

export async function readStaffFileController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const fileId = fileObjectId.parse((req.params as { fileId: unknown }).fileId);
    const context = req.tenantContext;
    const principalId = req.clerkPrincipal?.clerkUserId;
    if (!context || !principalId) throw new ValidationError('Workspace context is required.');
    const file = await readStaffFile({
      tenantId: context.tenantId,
      membershipId: context.membershipId,
      principalId,
      permissionCodes: context.permissionCodes,
      effectiveTenantStatus: context.effectiveTenantStatus,
      branchId: context.activeBranchId,
      requestId: req.requestId,
      fileId,
      width: parseImageWidth(req.query.w),
    });
    streamFileResponse(req, res, next, file, 'private, no-store');
  } catch (error) {
    next(error);
  }
}

function parseImageWidth(value: unknown): 320 | 960 | 1600 | null {
  if (value === '320') return 320;
  if (value === '1600') return 1600;
  return value === '960' ? 960 : null;
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
