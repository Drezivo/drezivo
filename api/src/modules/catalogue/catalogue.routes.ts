import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  archiveClothingController,
  createAssetMaintenanceBlockController,
  createClothingController,
  getCatalogueClothingDetailController,
  getDefaultMeasurementGuideController,
  listCatalogueCategoriesController,
  listCatalogueClothingController,
  replaceClothingImagesController,
  saveMeasurementGuideController,
  updateCatalogueCategoryStatusController,
  updateClothingProductController,
  updateClothingVariantController,
  updatePhysicalAssetStateController,
} from './catalogue.controller.js';
import {
  requireAssetManagePermission,
  requireCatalogueIdempotencyKey,
  validateCatalogueCategoryStatusUpdate,
  validateCatalogueClothingListQuery,
  validateArchiveClothing,
  validateCatalogueProductId,
  validateCreateAssetMaintenanceBlock,
  validateCreateClothing,
  validateUpdateClothingProduct,
  validateUpdateClothingVariant,
  validateUpdatePhysicalAssetState,
  validateReplaceClothingImages,
  validateSaveMeasurementGuide,
} from './catalogue.middleware.js';

export const catalogueRouter = Router();

const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) => req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const writeRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyOf: (req) => req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const readPolicy = requireTenantAction('context_read');
const writePolicy = requireTenantAction('asset_write');

catalogueRouter.get(
  '/catalogue/clothing',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  readPolicy,
  requireAssetManagePermission,
  validateCatalogueClothingListQuery,
  listCatalogueClothingController,
);

catalogueRouter.get(
  '/catalogue/clothing/:productId',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  readPolicy,
  requireAssetManagePermission,
  validateCatalogueProductId,
  getCatalogueClothingDetailController,
);

catalogueRouter.patch(
  '/catalogue/clothing/:productId',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCatalogueProductId,
  validateUpdateClothingProduct,
  requireCatalogueIdempotencyKey,
  updateClothingProductController,
);

catalogueRouter.patch(
  '/catalogue/clothing/:productId/variants/:variantId',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateUpdateClothingVariant,
  requireCatalogueIdempotencyKey,
  updateClothingVariantController,
);

catalogueRouter.post(
  '/catalogue/clothing/:productId/archive',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateArchiveClothing,
  requireCatalogueIdempotencyKey,
  archiveClothingController,
);

catalogueRouter.patch(
  '/catalogue/assets/:assetId/state',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateUpdatePhysicalAssetState,
  requireCatalogueIdempotencyKey,
  updatePhysicalAssetStateController,
);

catalogueRouter.post(
  '/catalogue/assets/:assetId/maintenance-blocks',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCreateAssetMaintenanceBlock,
  requireCatalogueIdempotencyKey,
  createAssetMaintenanceBlockController,
);

catalogueRouter.get(
  '/catalogue/categories',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  readPolicy,
  requireAssetManagePermission,
  listCatalogueCategoriesController,
);

catalogueRouter.patch(
  '/catalogue/categories/:categoryId/status',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCatalogueCategoryStatusUpdate,
  requireCatalogueIdempotencyKey,
  updateCatalogueCategoryStatusController,
);

catalogueRouter.get(
  '/catalogue/measurement-guide/default',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  readPolicy,
  requireAssetManagePermission,
  getDefaultMeasurementGuideController,
);

catalogueRouter.post(
  '/catalogue/measurement-guides',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateSaveMeasurementGuide,
  requireCatalogueIdempotencyKey,
  saveMeasurementGuideController,
);

catalogueRouter.put(
  '/catalogue/clothing/:productId/images',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCatalogueProductId,
  validateReplaceClothingImages,
  requireCatalogueIdempotencyKey,
  replaceClothingImagesController,
);

catalogueRouter.post(
  '/catalogue/clothing',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCreateClothing,
  requireCatalogueIdempotencyKey,
  createClothingController,
);
