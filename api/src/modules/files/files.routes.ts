import { Router } from 'express';
import { z } from 'zod';

import { fileObjectId } from '@drezivo/contracts';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { authorizeUploadController, finalizeUploadController, readStaffFileController } from './files.controller.js';
import { validate } from '../../middleware/validate.js';
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

filesRouter.get(
  '/media/staff/:fileId',
  requireStaffAuth,
  requireTenantContext,
  rateLimit({ windowMs: 60_000, max: 120, keyOf: (req) => req.tenantContext?.tenantId ?? req.ip ?? 'unknown' }),
  requireTenantAction('context_read'),
  validate({ params: z.object({ fileId: fileObjectId }).strict() }),
  readStaffFileController,
);
