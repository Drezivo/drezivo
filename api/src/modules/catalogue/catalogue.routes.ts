import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  createClothingController,
  getCatalogueClothingDetailController,
  getDefaultMeasurementGuideController,
  listCatalogueCategoriesController,
  listCatalogueClothingController,
  saveMeasurementGuideController,
  updateCatalogueCategoryStatusController,
} from './catalogue.controller.js';
import {
  requireAssetManagePermission,
  requireCatalogueIdempotencyKey,
  validateCatalogueCategoryStatusUpdate,
  validateCatalogueClothingListQuery,
  validateCatalogueProductId,
  validateCreateClothing,
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
