import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  archiveClothingController,
  createAssetMaintenanceBlockController,
  createCatalogueCategoryController,
  createClothingController,
  createClothingVariantController,
  changeClothingSizingModeController,
  createPhysicalAssetController,
  getCatalogueClothingDetailController,
  getDefaultMeasurementGuideController,
  listCatalogueCategoriesController,
  listCatalogueClothingController,
  publishClothingController,
  removeCatalogueCategoryController,
  removeClothingVariantController,
  replaceClothingImagesController,
  restoreClothingController,
  saveMeasurementGuideController,
  updateCatalogueCategoryController,
  updateCatalogueCategoryStatusController,
  updateClothingProductController,
  updateClothingVariantController,
  updateClothingVariantLifecycleController,
  updatePhysicalAssetStateController,
} from './catalogue.controller.js';
import {
  requireAssetArchivePermission,
  requireAssetManagePermission,
  requireCatalogueIdempotencyKey,
  validateCatalogueCategoryId,
  validateCatalogueCategoryStatusUpdate,
  validateCatalogueCategoryUpdate,
  validateCatalogueClothingListQuery,
  validateArchiveClothing,
  validateCatalogueProductId,
  validateCreateAssetMaintenanceBlock,
  validateCreateCatalogueCategory,
  validateCreateClothing,
  validateCreateClothingVariant,
  validateChangeClothingSizingMode,
  validateCreatePhysicalAsset,
  validatePublishClothing,
  validateRemoveClothingVariant,
  validateRestoreClothing,
  validateUpdateClothingProduct,
  validateUpdateClothingVariant,
  validateVariantLifecycleUpdate,
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
  '/catalogue/clothing/:productId/publish',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validatePublishClothing,
  requireCatalogueIdempotencyKey,
  publishClothingController,
);

catalogueRouter.post(
  '/catalogue/clothing/:productId/restore',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  requireAssetArchivePermission,
  validateRestoreClothing,
  requireCatalogueIdempotencyKey,
  restoreClothingController,
);

catalogueRouter.post(
  '/catalogue/clothing/:productId/variants',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCreateClothingVariant,
  requireCatalogueIdempotencyKey,
  createClothingVariantController,
);

catalogueRouter.post(
  '/catalogue/clothing/:productId/sizing-mode',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateChangeClothingSizingMode,
  requireCatalogueIdempotencyKey,
  changeClothingSizingModeController,
);

catalogueRouter.patch(
  '/catalogue/clothing/:productId/variants/:variantId/lifecycle',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateVariantLifecycleUpdate,
  requireCatalogueIdempotencyKey,
  updateClothingVariantLifecycleController,
);

catalogueRouter.post(
  '/catalogue/clothing/:productId/variants/:variantId/remove',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateRemoveClothingVariant,
  requireCatalogueIdempotencyKey,
  removeClothingVariantController,
);

catalogueRouter.post(
  '/catalogue/clothing/:productId/variants/:variantId/assets',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCreatePhysicalAsset,
  requireCatalogueIdempotencyKey,
  createPhysicalAssetController,
);

catalogueRouter.post(
  '/catalogue/clothing/:productId/archive',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  requireAssetArchivePermission,
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

catalogueRouter.post(
  '/catalogue/categories',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCreateCatalogueCategory,
  requireCatalogueIdempotencyKey,
  createCatalogueCategoryController,
);

catalogueRouter.patch(
  '/catalogue/categories/:categoryId',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCatalogueCategoryUpdate,
  requireCatalogueIdempotencyKey,
  updateCatalogueCategoryController,
);

catalogueRouter.delete(
  '/catalogue/categories/:categoryId',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  writePolicy,
  requireAssetManagePermission,
  validateCatalogueCategoryId,
  requireCatalogueIdempotencyKey,
  removeCatalogueCategoryController,
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
