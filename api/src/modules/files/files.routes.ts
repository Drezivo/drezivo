import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { authorizeUploadController, finalizeUploadController } from './files.controller.js';
import {
  requireFileIdempotencyKey,
  requireFileUploadPermission,
  validateUploadAuthorization,
  validateUploadFinalize,
} from './files.middleware.js';

export const filesRouter = Router();

const fileWriteRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyOf: (req) => req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});
const writePolicy = requireTenantAction('asset_write');

filesRouter.post(
  '/uploads',
  requireStaffAuth,
  requireTenantContext,
  fileWriteRateLimit,
  writePolicy,
  requireFileUploadPermission,
  validateUploadAuthorization,
  requireFileIdempotencyKey,
  authorizeUploadController,
);

filesRouter.post(
  '/uploads/:fileId/finalize',
  requireStaffAuth,
  requireTenantContext,
  fileWriteRateLimit,
  writePolicy,
  requireFileUploadPermission,
  validateUploadFinalize,
  requireFileIdempotencyKey,
  finalizeUploadController,
);
