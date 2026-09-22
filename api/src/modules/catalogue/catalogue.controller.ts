import type { Request, Response } from 'express';

import type {
  ArchiveClothingRequest,
  CreateAssetMaintenanceBlockRequest,
  CreateCatalogueCategoryRequest,
  CreateClothingRequest,
  PermissionCode,
  ReplaceClothingImagesRequest,
  SaveMeasurementGuideRequest,
  TenantStatus,
  UpdateCatalogueCategoryRequest,
  UpdateCatalogueCategoryStatusRequest,
  UpdateClothingProductRequest,
  UpdateClothingVariantRequest,
  UpdatePhysicalAssetStateRequest,
} from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import {
  archiveClothing,
  createAssetMaintenanceBlock,
  createCatalogueCategory,
  createClothing,
  getCatalogueCategories,
  getCatalogueClothingDetail,
  getCatalogueClothingList,
  getDefaultMeasurementGuide,
  removeCatalogueCategory,
  replaceClothingImages,
  saveMeasurementGuide,
  updateCatalogueCategory,
  updateCatalogueCategoryStatus,
  updateClothingProduct,
  updateClothingVariant,
  updatePhysicalAssetState,
} from './catalogue.service.js';

export async function listCatalogueCategoriesController(req: Request, res: Response): Promise<void> {
  sendSuccess(req, res, await getCatalogueCategories(requireContext(req)));
}

export async function listCatalogueClothingController(req: Request, res: Response): Promise<void> {
  const query = req.catalogueClothingListQuery;
  if (!query) throw new ValidationError('A valid clothing list query is required.');
  sendSuccess(req, res, await getCatalogueClothingList(requireContext(req), query));
}

export async function getCatalogueClothingDetailController(
  req: Request,
  res: Response,
): Promise<void> {
  const productId = req.catalogueProductId;
  if (!productId) throw new ValidationError('A valid clothing product id is required.');
  sendSuccess(req, res, await getCatalogueClothingDetail(requireContext(req), productId));
}

export async function updateClothingProductController(req: Request, res: Response): Promise<void> {
  const productId = req.catalogueProductId;
  if (!productId) throw new ValidationError('A valid clothing product id is required.');
  const result = await updateClothingProduct({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    productId,
    request: req.body as UpdateClothingProductRequest,
  });
  res.status(result.status).json(result.body);
}

export async function updateClothingVariantController(req: Request, res: Response): Promise<void> {
  const productId = req.catalogueProductId;
  const variantId = req.catalogueVariantId;
  if (!productId || !variantId) {
    throw new ValidationError('Valid clothing product and variant ids are required.');
  }
  const result = await updateClothingVariant({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    productId,
    variantId,
    request: req.body as UpdateClothingVariantRequest,
  });
  res.status(result.status).json(result.body);
}

export async function updatePhysicalAssetStateController(
  req: Request,
  res: Response,
): Promise<void> {
  const assetId = req.catalogueAssetId;
  if (!assetId) throw new ValidationError('A valid physical asset id is required.');
  const result = await updatePhysicalAssetState({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    assetId,
    request: req.body as UpdatePhysicalAssetStateRequest,
  });
  res.status(result.status).json(result.body);
}

export async function createAssetMaintenanceBlockController(
  req: Request,
  res: Response,
): Promise<void> {
  const assetId = req.catalogueAssetId;
  if (!assetId) throw new ValidationError('A valid physical asset id is required.');
  const result = await createAssetMaintenanceBlock({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    assetId,
    request: req.body as CreateAssetMaintenanceBlockRequest,
  });
  res.status(result.status).json(result.body);
}

export async function archiveClothingController(req: Request, res: Response): Promise<void> {
  const productId = req.catalogueProductId;
  if (!productId) throw new ValidationError('A valid clothing product id is required.');
  const result = await archiveClothing({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    productId,
    request: req.body as ArchiveClothingRequest,
  });
  res.status(result.status).json(result.body);
}

export async function createCatalogueCategoryController(req: Request, res: Response): Promise<void> {
  const result = await createCatalogueCategory({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    request: req.body as CreateCatalogueCategoryRequest,
  });
  res.status(result.status).json(result.body);
}

export async function updateCatalogueCategoryController(req: Request, res: Response): Promise<void> {
  const categoryId = req.catalogueCategoryId;
  if (!categoryId) throw new ValidationError('A valid category id is required.');
  const result = await updateCatalogueCategory({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    categoryId,
    request: req.body as UpdateCatalogueCategoryRequest,
  });
  res.status(result.status).json(result.body);
}

export async function removeCatalogueCategoryController(req: Request, res: Response): Promise<void> {
  const categoryId = req.catalogueCategoryId;
  if (!categoryId) throw new ValidationError('A valid category id is required.');
  const result = await removeCatalogueCategory({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    categoryId,
  });
  res.status(result.status).json(result.body);
}

export async function updateCatalogueCategoryStatusController(
  req: Request,
  res: Response,
): Promise<void> {
  const categoryId = req.catalogueCategoryId;
  if (!categoryId) throw new ValidationError('A valid category id is required.');
  const result = await updateCatalogueCategoryStatus({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    categoryId,
    request: req.body as UpdateCatalogueCategoryStatusRequest,
  });
  res.status(result.status).json(result.body);
}

export async function getDefaultMeasurementGuideController(
  req: Request,
  res: Response,
): Promise<void> {
  sendSuccess(req, res, await getDefaultMeasurementGuide(requireContext(req)));
}

export async function saveMeasurementGuideController(req: Request, res: Response): Promise<void> {
  const result = await saveMeasurementGuide({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    request: req.body as SaveMeasurementGuideRequest,
  });
  res.status(result.status).json(result.body);
}

export async function replaceClothingImagesController(req: Request, res: Response): Promise<void> {
  const productId = req.catalogueProductId;
  if (!productId) throw new ValidationError('A valid clothing product id is required.');
  const result = await replaceClothingImages({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    productId,
    request: req.body as ReplaceClothingImagesRequest,
  });
  res.status(result.status).json(result.body);
}

export async function createClothingController(req: Request, res: Response): Promise<void> {
  const result = await createClothing({
    ...requireContext(req),
    requestId: req.requestId,
    idempotencyKey: requireIdempotencyKey(req),
    request: req.body as CreateClothingRequest,
  });
  res.status(result.status).json(result.body);
}

function requireContext(req: Request): {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
} {
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
  };
}

function requireIdempotencyKey(req: Request): string {
  if (!req.catalogueIdempotencyKey) {
    throw new ValidationError('A valid Idempotency-Key header is required.');
  }
  return req.catalogueIdempotencyKey;
}
