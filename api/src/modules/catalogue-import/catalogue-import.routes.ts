import {
  MAX_IMPORT_BATCH_ITEMS,
  batchCreateClothingRequest,
  batchUploadAuthorizationRequest,
  batchUploadFinalizeRequest,
  clothingPhotoExtractRequest,
  type CatalogueImportCapabilities,
} from '@drezivo/contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { z } from 'zod';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import { requireAssetManagePermission } from '../catalogue/catalogue.middleware.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
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
  (req: Request, res: Response): void => {
    const body: CatalogueImportCapabilities = {
      photo_extraction: visionSettings() !== null,
      max_batch_items: MAX_IMPORT_BATCH_ITEMS,
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
