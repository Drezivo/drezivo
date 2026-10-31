import {
  catalogueBackupImportCommitRequest,
  catalogueBackupImportPreviewRequest,
  catalogueBackupJobId,
  MAX_IMPORT_BATCH_ITEMS,
  batchCreateClothingRequest,
  batchUploadAuthorizationRequest,
  batchUploadFinalizeRequest,
  clothingPhotoExtractRequest,
  type CatalogueImportCapabilities,
} from '@drezivo/contracts';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { z } from 'zod';

import { config } from '../../config/index.js';
import { createClerkServerAdapter } from '../../integrations/clerk/clerk.adapter.js';
import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { ForbiddenError, ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import { requireAssetManagePermission, requireCatalogueIdempotencyKey } from '../catalogue/catalogue.middleware.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { streamFileResponse } from '../files/file-stream.js';
import {
  readCatalogueBackupExport,
  readCatalogueBackupExportStatus,
  startCatalogueBackupExport,
  type CatalogueBackupContext,
} from './catalogue-backup.service.js';
import { commitCatalogueBackupImport, previewCatalogueBackupImport } from './catalogue-backup.restore.js';
import {
  authorizeImportUploads,
  createImportClothing,
  finalizeImportUploads,
  type ImportContext,
} from './catalogue-import.service.js';
import { extractClothingPhoto, visionSettings } from './photo-extraction.service.js';

export const catalogueImportRouter = Router();

const tenantKey = (req: Request): string =>
  req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown';

// A batch request carries up to 25 rows, so 12 a minute is 300 rows a minute per shop. Each step
// (authorize, finalize, create) has its own budget: one import calls all three per 25 rows.
const batchRateLimit = (): RequestHandler => rateLimit({ windowMs: 60_000, max: 12, keyOf: tenantKey });
const authorizeRateLimit = batchRateLimit();
const finalizeRateLimit = batchRateLimit();
const createRateLimit = batchRateLimit();
// Matches the strictest free vision tier we support (NVIDIA Build, 40 requests a minute).
const extractRateLimit = rateLimit({ windowMs: 60_000, max: 40, keyOf: tenantKey });
const readRateLimit = rateLimit({ windowMs: 60_000, max: 60, keyOf: tenantKey });

const writePolicy = requireTenantAction('asset_write');

/**
 * Batch Add is limited to allowlisted accounts for now (CATALOGUE_IMPORT_ALLOWED_EMAILS). The
 * check uses the signed-in user's verified primary email from Clerk; an unverified or unreadable
 * email is not allowed. Provider failures surface as a 503 from the adapter, never as access.
 */
async function hasBatchAddAccess(req: Request): Promise<boolean> {
  const userId = req.clerkPrincipal?.clerkUserId;
  if (!userId || config.CATALOGUE_IMPORT_ALLOWED_EMAILS.length === 0) return false;
  const state = await createClerkServerAdapter().getUserVerificationState(userId);
  const email = state.verifiedPrimaryEmail?.trim().toLowerCase();
  return Boolean(email && config.CATALOGUE_IMPORT_ALLOWED_EMAILS.includes(email));
}

const requireBatchAddAccess: RequestHandler = (req, _res, next): void => {
  hasBatchAddAccess(req)
    .then((allowed) => next(allowed ? undefined : new ForbiddenError('Batch Add is not available for this account.')))
    .catch(next);
};
const readPolicy = requireTenantAction('context_read');

function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown, message: string): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError(message);
  return parsed.data as z.infer<S>;
}

function importContext(req: Request): ImportContext {
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
    requestId: req.requestId,
  };
}

const guarded = [requireStaffAuth, requireTenantContext];

catalogueImportRouter.get(
  '/catalogue/import/capabilities',
  ...guarded,
  readRateLimit,
  readPolicy,
  requireAssetManagePermission,
  async (req: Request, res: Response): Promise<void> => {
    const body: CatalogueImportCapabilities = {
      photo_extraction: visionSettings() !== null,
      max_batch_items: MAX_IMPORT_BATCH_ITEMS,
      batch_add: await hasBatchAddAccess(req),
    };
    sendSuccess(req, res, body);
  },
);

catalogueImportRouter.post(
  '/catalogue/import/uploads',
  ...guarded,
  authorizeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  requireBatchAddAccess,
  async (req: Request, res: Response): Promise<void> => {
    const request = parseBody(batchUploadAuthorizationRequest, req.body, 'Photo upload batch is invalid.');
    sendSuccess(req, res, { results: await authorizeImportUploads(importContext(req), request) });
  },
);

catalogueImportRouter.post(
  '/catalogue/import/uploads/finalize',
  ...guarded,
  finalizeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  requireBatchAddAccess,
  async (req: Request, res: Response): Promise<void> => {
    const request = parseBody(batchUploadFinalizeRequest, req.body, 'Photo finalize batch is invalid.');
    sendSuccess(req, res, { results: await finalizeImportUploads(importContext(req), request) });
  },
);

catalogueImportRouter.post(
  '/catalogue/import/clothing',
  ...guarded,
  createRateLimit,
  writePolicy,
  requireAssetManagePermission,
  requireBatchAddAccess,
  async (req: Request, res: Response): Promise<void> => {
    const request = parseBody(batchCreateClothingRequest, req.body, 'Clothing batch is invalid.');
    sendSuccess(req, res, { results: await createImportClothing(importContext(req), request) });
  },
);

catalogueImportRouter.post(
  '/catalogue/import/extract',
  ...guarded,
  extractRateLimit,
  writePolicy,
  requireAssetManagePermission,
  requireBatchAddAccess,
  async (req: Request, res: Response): Promise<void> => {
    const request = parseBody(clothingPhotoExtractRequest, req.body, 'Photo extraction request is invalid.');
    const context = importContext(req);
    const fields = await extractClothingPhoto({
      tenantId: context.tenantId,
      principalId: context.principalId,
      fileId: request.file_id,
    });
    sendSuccess(req, res, { fields });
  },
);

catalogueImportRouter.post(
  '/catalogue/backup/exports',
  ...guarded,
  createRateLimit,
  writePolicy,
  requireAssetManagePermission,
  requireCatalogueIdempotencyKey,
  async (req: Request, res: Response): Promise<void> => {
    const job = await startCatalogueBackupExport({ ...backupContext(req), idempotencyKey: catalogueIdempotencyKey(req) });
    sendSuccess(req, res, { job });
  },
);

catalogueImportRouter.get(
  '/catalogue/backup/exports/:jobId',
  ...guarded,
  readRateLimit,
  readPolicy,
  requireAssetManagePermission,
  async (req: Request, res: Response): Promise<void> => {
    const jobId = catalogueBackupJobId.safeParse(req.params['jobId']);
    if (!jobId.success) throw new ValidationError('A valid export job id is required.');
    const job = await readCatalogueBackupExportStatus({ ...backupContext(req), jobId: jobId.data });
    sendSuccess(req, res, { job });
  },
);

catalogueImportRouter.get(
  '/catalogue/backup/exports/:jobId/download',
  ...guarded,
  readRateLimit,
  readPolicy,
  requireAssetManagePermission,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = catalogueBackupJobId.safeParse(req.params['jobId']);
      if (!jobId.success) throw new ValidationError('A valid export job id is required.');
      const backup = await readCatalogueBackupExport({ ...backupContext(req), jobId: jobId.data });
      streamFileResponse(req, res, next, { body: backup.body, byteSize: backup.byteSize, mimeType: 'application/zip' }, 'private, no-store', backup.filename);
    } catch (error) {
      next(error);
    }
  },
);

catalogueImportRouter.post(
  '/catalogue/backup/imports/preview',
  ...guarded,
  createRateLimit,
  writePolicy,
  requireAssetManagePermission,
  requireCatalogueIdempotencyKey,
  async (req: Request, res: Response): Promise<void> => {
    const request = parseBody(catalogueBackupImportPreviewRequest, req.body, 'Inventory backup preview request is invalid.');
    const preview = await previewCatalogueBackupImport({ ...backupContext(req), fileId: request.file_id, idempotencyKey: catalogueIdempotencyKey(req) });
    sendSuccess(req, res, preview);
  },
);

catalogueImportRouter.post(
  '/catalogue/backup/imports/:importId/commit',
  ...guarded,
  createRateLimit,
  writePolicy,
  requireAssetManagePermission,
  requireCatalogueIdempotencyKey,
  async (req: Request, res: Response): Promise<void> => {
    const parsedId = catalogueBackupJobId.safeParse(req.params['importId']);
    if (!parsedId.success) throw new ValidationError('A valid import job id is required.');
    parseBody(catalogueBackupImportCommitRequest, req.body, 'Inventory restore request is invalid.');
    const result = await commitCatalogueBackupImport({ ...backupContext(req), importId: parsedId.data, idempotencyKey: catalogueIdempotencyKey(req) });
    sendSuccess(req, res, result);
  },
);

function backupContext(req: Request): CatalogueBackupContext {
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
    requestId: req.requestId,
  };
}

function catalogueIdempotencyKey(req: Request): string {
  if (!req.catalogueIdempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');
  return req.catalogueIdempotencyKey;
}
