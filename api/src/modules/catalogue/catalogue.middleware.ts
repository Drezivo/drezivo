import type { RequestHandler } from 'express';

import {
  categoryId,
  clothingListQuery,
  createAssetMaintenanceBlockRequest,
  createClothingRequest,
  idempotencyKey,
  physicalAssetId,
  productId,
  productVariantId,
  replaceClothingImagesRequest,
  saveMeasurementGuideRequest,
  updateCatalogueCategoryStatusRequest,
  updateClothingProductRequest,
  updateClothingVariantRequest,
  updatePhysicalAssetStateRequest,
  type ClothingListQuery,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    catalogueIdempotencyKey?: string;
    catalogueCategoryId?: string;
    catalogueClothingListQuery?: ClothingListQuery;
    catalogueProductId?: string;
    catalogueVariantId?: string;
    catalogueAssetId?: string;
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

export const validateCatalogueClothingListQuery: RequestHandler = (req, _res, next): void => {
  const parsed = clothingListQuery.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Clothing list query is invalid.'));
    return;
  }
  req.catalogueClothingListQuery = parsed.data;
  next();
};

export const validateCatalogueProductId: RequestHandler = (req, _res, next): void => {
  const parsed = productId.safeParse(req.params.productId);
  if (!parsed.success) {
    next(new ValidationError('A valid clothing product id is required.'));
    return;
  }
  req.catalogueProductId = parsed.data;
  next();
};

export const validateUpdateClothingProduct: RequestHandler = (req, _res, next): void => {
  const parsed = updateClothingProductRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Clothing product update request is invalid.'));
    return;
  }
  req.body = parsed.data;
  next();
};

export const validateUpdateClothingVariant: RequestHandler = (req, _res, next): void => {
  const parsedProductId = productId.safeParse(req.params.productId);
  const parsedVariantId = productVariantId.safeParse(req.params.variantId);
  const parsedBody = updateClothingVariantRequest.safeParse(req.body);
  if (!parsedProductId.success || !parsedVariantId.success || !parsedBody.success) {
    next(new ValidationError('Clothing variant update request is invalid.'));
    return;
  }
  req.catalogueProductId = parsedProductId.data;
  req.catalogueVariantId = parsedVariantId.data;
  req.body = parsedBody.data;
  next();
};

export const validateUpdatePhysicalAssetState: RequestHandler = (req, _res, next): void => {
  const parsedAssetId = physicalAssetId.safeParse(req.params.assetId);
  const parsedBody = updatePhysicalAssetStateRequest.safeParse(req.body);
  if (!parsedAssetId.success || !parsedBody.success) {
    next(new ValidationError('Physical asset state request is invalid.'));
    return;
  }
  req.catalogueAssetId = parsedAssetId.data;
  req.body = parsedBody.data;
  next();
};

export const validateCreateAssetMaintenanceBlock: RequestHandler = (req, _res, next): void => {
  const parsedAssetId = physicalAssetId.safeParse(req.params.assetId);
  const parsedBody = createAssetMaintenanceBlockRequest.safeParse(req.body);
  if (!parsedAssetId.success || !parsedBody.success) {
    next(new ValidationError('Asset maintenance block request is invalid.'));
    return;
  }
  req.catalogueAssetId = parsedAssetId.data;
  req.body = parsedBody.data;
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

export const validateReplaceClothingImages: RequestHandler = (req, _res, next): void => {
  const parsed = replaceClothingImagesRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Clothing image request is invalid.'));
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
