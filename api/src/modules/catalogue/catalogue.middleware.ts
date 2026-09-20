import type { RequestHandler } from 'express';

import {
  categoryId,
  createClothingRequest,
  idempotencyKey,
  saveMeasurementGuideRequest,
  updateCatalogueCategoryStatusRequest,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    catalogueIdempotencyKey?: string;
    catalogueCategoryId?: string;
  }
}

export const requireCatalogueIdempotencyKey: RequestHandler = (req, _res, next): void => {
  const parsed = idempotencyKey.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.catalogueIdempotencyKey = parsed.data;
  next();
};

export const requireAssetManagePermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('assets.manage')) {
    next(new ForbiddenError('This branch does not grant clothing management access.'));
    return;
  }
  next();
};

export const validateSaveMeasurementGuide: RequestHandler = (req, _res, next): void => {
  const parsed = saveMeasurementGuideRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Measurement guide request is invalid.'));
    return;
  }
  req.body = parsed.data;
  next();
};

export const validateCreateClothing: RequestHandler = (req, _res, next): void => {
  const parsed = createClothingRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Clothing request is invalid.'));
    return;
  }
  req.body = parsed.data;
  next();
};

export const validateCatalogueCategoryStatusUpdate: RequestHandler = (req, _res, next): void => {
  const parsedId = categoryId.safeParse(req.params.categoryId);
  const parsedBody = updateCatalogueCategoryStatusRequest.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    next(new ValidationError('Category status request is invalid.'));
    return;
  }
  req.catalogueCategoryId = parsedId.data;
  req.body = parsedBody.data;
  next();
};
