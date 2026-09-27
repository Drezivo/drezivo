import type { RequestHandler } from 'express';

import {
  archiveClothingRequest,
  categoryId,
  clothingListQuery,
  createAssetMaintenanceBlockRequest,
  createCatalogueCategoryRequest,
  createClothingRequest,
  createClothingVariantRequest,
  changeClothingSizingModeRequest,
  createPhysicalAssetRequest,
  idempotencyKey,
  physicalAssetId,
  productId,
  productVariantId,
  publishClothingRequest,
  removeClothingVariantRequest,
  replaceClothingImagesRequest,
  restoreClothingRequest,
  saveMeasurementGuideRequest,
  updateCatalogueCategoryRequest,
  updateCatalogueCategoryStatusRequest,
  updateClothingVariantLifecycleRequest,
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

export const requireAssetArchivePermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('assets.archive')) {
    next(new ForbiddenError('This branch does not grant clothing archive access.'));
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

export const validateCreateClothingVariant: RequestHandler = (req, _res, next): void => {
  const parsedProductId = productId.safeParse(req.params.productId);
  const parsedBody = createClothingVariantRequest.safeParse(req.body);
  if (!parsedProductId.success || !parsedBody.success) {
    next(new ValidationError('Clothing variant create request is invalid.'));
    return;
  }
  req.catalogueProductId = parsedProductId.data;
  req.body = parsedBody.data;
  next();
};

export const validateChangeClothingSizingMode: RequestHandler = (req, _res, next): void => {
  const parsedProductId = productId.safeParse(req.params.productId);
  const parsedBody = changeClothingSizingModeRequest.safeParse(req.body);
  if (!parsedProductId.success || !parsedBody.success) {
    next(new ValidationError('Clothing sizing mode request is invalid.'));
    return;
  }
  req.catalogueProductId = parsedProductId.data;
  req.body = parsedBody.data;
  next();
};

export const validateCreatePhysicalAsset: RequestHandler = (req, _res, next): void => {
  const parsedProductId = productId.safeParse(req.params.productId);
  const parsedVariantId = productVariantId.safeParse(req.params.variantId);
  const parsedBody = createPhysicalAssetRequest.safeParse(req.body);
  if (!parsedProductId.success || !parsedVariantId.success || !parsedBody.success) {
    next(new ValidationError('Physical piece create request is invalid.'));
    return;
  }
  req.catalogueProductId = parsedProductId.data;
  req.catalogueVariantId = parsedVariantId.data;
  req.body = parsedBody.data;
  next();
};

export const validatePublishClothing: RequestHandler = (req, _res, next): void => {
  const parsedProductId = productId.safeParse(req.params.productId);
  const parsedBody = publishClothingRequest.safeParse(req.body);
  if (!parsedProductId.success || !parsedBody.success) {
    next(new ValidationError('Clothing publish request is invalid.'));
    return;
  }
  req.catalogueProductId = parsedProductId.data;
  req.body = parsedBody.data;
  next();
};

export const validateRestoreClothing: RequestHandler = (req, _res, next): void => {
  const parsedProductId = productId.safeParse(req.params.productId);
  const parsedBody = restoreClothingRequest.safeParse(req.body);
  if (!parsedProductId.success || !parsedBody.success) {
    next(new ValidationError('Clothing restore request is invalid.'));
    return;
  }
  req.catalogueProductId = parsedProductId.data;
  req.body = parsedBody.data;
  next();
};

export const validateVariantLifecycleUpdate: RequestHandler = (req, _res, next): void => {
  const parsedProductId = productId.safeParse(req.params.productId);
  const parsedVariantId = productVariantId.safeParse(req.params.variantId);
  const parsedBody = updateClothingVariantLifecycleRequest.safeParse(req.body);
  if (!parsedProductId.success || !parsedVariantId.success || !parsedBody.success) {
    next(new ValidationError('Variant lifecycle request is invalid.'));
    return;
  }
  req.catalogueProductId = parsedProductId.data;
  req.catalogueVariantId = parsedVariantId.data;
  req.body = parsedBody.data;
  next();
};

export const validateRemoveClothingVariant: RequestHandler = (req, _res, next): void => {
  const parsedProductId = productId.safeParse(req.params.productId);
  const parsedVariantId = productVariantId.safeParse(req.params.variantId);
  const parsedBody = removeClothingVariantRequest.safeParse(req.body);
  if (!parsedProductId.success || !parsedVariantId.success || !parsedBody.success) {
    next(new ValidationError('Variant removal request is invalid.'));
    return;
  }
  req.catalogueProductId = parsedProductId.data;
  req.catalogueVariantId = parsedVariantId.data;
  req.body = parsedBody.data;
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

export const validateArchiveClothing: RequestHandler = (req, _res, next): void => {
  const parsedProductId = productId.safeParse(req.params.productId);
  const parsedBody = archiveClothingRequest.safeParse(req.body);
  if (!parsedProductId.success || !parsedBody.success) {
    next(new ValidationError('Clothing archive request is invalid.'));
    return;
  }
  req.catalogueProductId = parsedProductId.data;
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

export const validateCreateCatalogueCategory: RequestHandler = (req, _res, next): void => {
  const parsed = createCatalogueCategoryRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Category create request is invalid.'));
    return;
  }
  req.body = parsed.data;
  next();
};

export const validateCatalogueCategoryUpdate: RequestHandler = (req, _res, next): void => {
  const parsedId = categoryId.safeParse(req.params.categoryId);
  const parsedBody = updateCatalogueCategoryRequest.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    next(new ValidationError('Category update request is invalid.'));
    return;
  }
  req.catalogueCategoryId = parsedId.data;
  req.body = parsedBody.data;
  next();
};

export const validateCatalogueCategoryId: RequestHandler = (req, _res, next): void => {
  const parsedId = categoryId.safeParse(req.params.categoryId);
  if (!parsedId.success) {
    next(new ValidationError('A valid category id is required.'));
    return;
  }
  req.catalogueCategoryId = parsedId.data;
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
