import {
  archiveClothingRequest,
  archiveClothingResponse,
  catalogueCategory,
  catalogueCategoryList,
  createCatalogueCategoryRequest,
  removeCatalogueCategoryResponse,
  updateCatalogueCategoryRequest,
  clothingDetail,
  clothingListResponse,
  createAssetMaintenanceBlockRequest,
  createAssetMaintenanceBlockResponse,
  createClothingRequest,
  createClothingResponse,
  createClothingVariantRequest,
  createClothingVariantResponse,
  changeClothingSizingModeRequest,
  changeClothingSizingModeResponse,
  createPhysicalAssetRequest,
  createPhysicalAssetResponse,
  measurementGuide,
  measurementGuideDefaultResponse,
  physicalAssetSummary,
  publishClothingRequest,
  publishClothingResponse,
  removeClothingVariantRequest,
  replaceClothingImagesRequest,
  restoreClothingRequest,
  restoreClothingResponse,
  replaceClothingImagesResponse,
  updateClothingProductRequest,
  updateClothingProductResponse,
  updateClothingVariantLifecycleRequest,
  updateClothingVariantLifecycleResponse,
  updateClothingVariantRequest,
  updateClothingVariantResponse,
  updatePhysicalAssetStateRequest,
  updatePhysicalAssetStateResponse,
  type ArchiveClothingRequest,
  type ArchiveClothingResponse,
  type CatalogueCategory,
  type CatalogueCategoryList,
  type CreateCatalogueCategoryRequest,
  type ClothingDetail,
  type ClothingListQuery,
  type ClothingListResponse,
  type CreateAssetMaintenanceBlockRequest,
  type CreateAssetMaintenanceBlockResponse,
  type CreateClothingRequest,
  type CreateClothingResponse,
  type CreateClothingVariantRequest,
  type CreateClothingVariantResponse,
  type ChangeClothingSizingModeRequest,
  type ChangeClothingSizingModeResponse,
  type CreatePhysicalAssetRequest,
  type CreatePhysicalAssetResponse,
  type MeasurementGuide,
  type MeasurementGuideDefaultResponse,
  type PermissionCode,
  type PhysicalAssetSummary,
  type PublishClothingRequest,
  type PublishClothingResponse,
  type RemoveClothingVariantRequest,
  type ReplaceClothingImagesRequest,
  type RestoreClothingRequest,
  type RestoreClothingResponse,
  type ReplaceClothingImagesResponse,
  type SaveMeasurementGuideRequest,
  type ClothingPricingInput,
  type UpdateClothingProductRequest,
  type UpdateClothingProductResponse,
  type UpdateClothingVariantLifecycleRequest,
  type UpdateClothingVariantLifecycleResponse,
  type UpdateClothingVariantRequest,
  type UpdateClothingVariantResponse,
  type UpdatePhysicalAssetStateRequest,
  type UpdatePhysicalAssetStateResponse,
  type TenantStatus,
  type RemoveCatalogueCategoryResponse,
  type UpdateCatalogueCategoryRequest,
  type UpdateCatalogueCategoryStatusRequest,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import {
  assertPhysicalAssetCapacity,
  lockTenantQuotaScope,
} from '../entitlements/entitlements.service.js';
import {
  ForbiddenError,
  IdempotencyKeyReusedError,
  InvalidCategoryError,
  InvalidMeasurementGuideError,
  NotFoundError,
  StateConflictError,
  StaleVersionError,
  TenantCancelledError,
  UnresolvedCustodyError,
  TenantRestrictedError,
  ValidationError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  claimTenantIdempotency,
  finalizeTenantIdempotency,
} from '../../shared/tenant-idempotency.js';
import {
  createDisruptionsForThreatenedReservations,
  createMaintenanceBlock,
  readAssetOperationalConstraints,
  truncateRecoveryForReadyAsset,
} from '../availability/availability.repository.js';
import {
  listClothingReadModel,
  readClothingDetailModel,
  readClothingListSummary,
} from './catalogue.read.repository.js';
import {
  appendCatalogueAuditEvent,
  archiveClothingGraph,
  countActivePhysicalAssetsForVariant,
  countActiveVariantsForProduct,
  countArchivedVariantsForProduct,
  createCategory,
  createClothingGraph,
  createPhysicalAssetForVariant,
  createVariantForProduct,
  archiveActiveVariantsForSizingMode,
  listCategories,
  readCategoryForCreate,
  readCatalogueImageFiles,
  readProductPublishability,
  readDefaultMeasurementGuide,
  readMeasurementGuideFileForView,
  readMeasurementGuidesForCreate,
  readPhysicalAssetForStateMutation,
  readPhysicalAssetsForArchive,
  readProductForEdit,
  readPreservedFreeSizeVariant,
  readProductForImageMutation,
  readVariantForEdit,
  replaceDefaultMeasurementGuide,
  removeCategory,
  removeVariantSafely,
  replaceProductImages,
  restoreClothingGraph,
  updateCategory,
  updateCategoryStatus,
  updateVariantLifecycle,
  updatePhysicalAssetState as persistPhysicalAssetState,
  updateProductForEdit,
  updateProductSizingMode,
  publishClothingGraph,
  updateVariantForEdit,
  validateMeasurementGuideFile,
  type CatalogueFileRow,
  type EditablePhysicalAssetRow,
  type MeasurementGuideRow,
} from './catalogue.repository.js';

const SAVE_GUIDE_OPERATION = 'catalogue.measurement_guide.save';
const CREATE_CLOTHING_OPERATION = 'catalogue.clothing.create';
const CHANGE_CLOTHING_SIZING_MODE_OPERATION = 'catalogue.clothing.sizing_mode.change';
const CREATE_CATEGORY_OPERATION = 'catalogue.category.create';
const UPDATE_CATEGORY_OPERATION = 'catalogue.category.update';
const UPDATE_CATEGORY_STATUS_OPERATION = 'catalogue.category.status.update';
const REMOVE_CATEGORY_OPERATION = 'catalogue.category.remove';
const REPLACE_CLOTHING_IMAGES_OPERATION = 'catalogue.clothing.images.replace';
const UPDATE_CLOTHING_PRODUCT_OPERATION = 'catalogue.clothing.product.update';
const UPDATE_CLOTHING_VARIANT_OPERATION = 'catalogue.clothing.variant.update';
const PUBLISH_CLOTHING_OPERATION = 'catalogue.clothing.publish';
const RESTORE_CLOTHING_OPERATION = 'catalogue.clothing.restore';
const UPDATE_VARIANT_LIFECYCLE_OPERATION = 'catalogue.clothing.variant.lifecycle.update';
const REMOVE_VARIANT_OPERATION = 'catalogue.clothing.variant.remove';
const CREATE_VARIANT_OPERATION = 'catalogue.clothing.variant.create';
const CREATE_PHYSICAL_ASSET_OPERATION = 'catalogue.asset.create';
const UPDATE_PHYSICAL_ASSET_STATE_OPERATION = 'catalogue.asset.state.update';
const CREATE_ASSET_MAINTENANCE_BLOCK_OPERATION = 'catalogue.asset.maintenance_block.create';
const ARCHIVE_CLOTHING_OPERATION = 'catalogue.clothing.archive';
const MEASUREMENT_GUIDE_VIEW_EXPIRY_SECONDS = 5 * 60;
const CATALOGUE_IMAGE_VIEW_EXPIRY_SECONDS = 5 * 60;
const POSTGRES_INT_MAX = 2_147_483_647;

interface CatalogueContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
}

interface CommandContext extends CatalogueContext {
  requestId: string;
  idempotencyKey: string;
}

type GuideCommandBody = SuccessEnvelope<MeasurementGuide> | FailureEnvelope;
type ClothingCommandBody = SuccessEnvelope<CreateClothingResponse> | FailureEnvelope;
type ClothingSizingModeCommandBody = SuccessEnvelope<ChangeClothingSizingModeResponse> | FailureEnvelope;
type CategoryCommandBody = SuccessEnvelope<CatalogueCategory> | FailureEnvelope;
type RemoveCategoryCommandBody = SuccessEnvelope<RemoveCatalogueCategoryResponse> | FailureEnvelope;
type ClothingImagesCommandBody = SuccessEnvelope<ReplaceClothingImagesResponse> | FailureEnvelope;
type ClothingProductUpdateCommandBody = SuccessEnvelope<UpdateClothingProductResponse> | FailureEnvelope;
type ClothingVariantUpdateCommandBody = SuccessEnvelope<UpdateClothingVariantResponse> | FailureEnvelope;
type PublishClothingCommandBody = SuccessEnvelope<PublishClothingResponse> | FailureEnvelope;
type RestoreClothingCommandBody = SuccessEnvelope<RestoreClothingResponse> | FailureEnvelope;
type VariantLifecycleCommandBody = SuccessEnvelope<UpdateClothingVariantLifecycleResponse> | FailureEnvelope;
type CreateVariantCommandBody = SuccessEnvelope<CreateClothingVariantResponse> | FailureEnvelope;
type CreatePhysicalAssetCommandBody = SuccessEnvelope<CreatePhysicalAssetResponse> | FailureEnvelope;
type PhysicalAssetStateCommandBody = SuccessEnvelope<UpdatePhysicalAssetStateResponse> | FailureEnvelope;
type AssetMaintenanceBlockCommandBody = SuccessEnvelope<CreateAssetMaintenanceBlockResponse> | FailureEnvelope;
type ArchiveClothingCommandBody = SuccessEnvelope<ArchiveClothingResponse> | FailureEnvelope;

export interface CatalogueCommandResponse<TBody> {
  status: number;
  body: TBody;
}

export async function getCatalogueCategories(
  input: CatalogueContext,
): Promise<CatalogueCategoryList> {
  assertCatalogueReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const rows = await listCategories(client, input.tenantId);
    return catalogueCategoryList.parse({ items: rows });
  });
}

export async function getCatalogueClothingList(
  input: CatalogueContext,
  query: ClothingListQuery,
  storage: ObjectStorage = objectStorage,
): Promise<ClothingListResponse> {
  assertCatalogueReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const page = await listClothingReadModel(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      query,
    });
    const summary = await readClothingListSummary(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      query,
    });
    const items = await Promise.all(
      page.rows.map(async (row) => {
        const primaryImageUrl = row.primary_image_storage_key
          ? (
              await storage.authorizeRead({
                storageKey: row.primary_image_storage_key,
                versionId: row.primary_image_version_id,
                expiresInSeconds: CATALOGUE_IMAGE_VIEW_EXPIRY_SECONDS,
              })
            ).readUrl
          : null;

        return {
          product_id: row.product_id,
          code: row.code,
          name: row.name,
          subcategory: row.subcategory,
          category:
            row.category_id && row.category_name
              ? { id: row.category_id, name: row.category_name }
              : null,
          product_status: row.product_status,
          sizing_mode: row.sizing_mode,
          has_free_size: row.has_free_size,
          size_labels: row.size_labels,
          price_from_minor: row.price_from_minor.toString(),
          currency: row.currency,
          primary_image_url: primaryImageUrl,
          readiness: {
            active_assets: row.active_assets,
            ready: row.ready,
            needs_cleaning: row.needs_cleaning,
            needs_repair: row.needs_repair,
            unready: row.unready,
          },
          availability: {
            window: {
              start: row.availability_start.toISOString(),
              end: row.availability_end.toISOString(),
            },
            active_assets: row.availability_active_assets,
            available_assets: row.available_assets,
            unavailable_assets: row.unavailable_assets,
            reserved_assets: row.reserved_assets,
            rented_assets: row.rented_assets,
            cleaning_assets: row.cleaning_assets,
            maintenance_assets: row.maintenance_assets,
            manual_blocked_assets: row.manual_blocked_assets,
          },
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        };
      }),
    );

    return clothingListResponse.parse({
      items,
      page_meta: {
        next_cursor: page.nextCursor,
        has_more: page.hasMore,
      },
      summary,
    });
  });
}

export async function getCatalogueClothingDetail(
  input: CatalogueContext,
  productId: string,
  storage: ObjectStorage = objectStorage,
): Promise<ClothingDetail> {
  assertCatalogueReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const model = await readClothingDetailModel(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      productId,
    });
    if (!model) {
      throw new NotFoundError('The selected clothing item could not be found.');
    }

    const assetsByVariant = new Map<string, typeof model.assets>();
    for (const asset of model.assets) {
      const assets = assetsByVariant.get(asset.variant_id) ?? [];
      assets.push(asset);
      assetsByVariant.set(asset.variant_id, assets);
    }

    const images = await Promise.all(
      model.images.map(async (image) => {
        try {
          const authorization = await storage.authorizeRead({
            storageKey: image.storage_key,
            versionId: image.version_id,
            expiresInSeconds: CATALOGUE_IMAGE_VIEW_EXPIRY_SECONDS,
          });
          return {
            file_id: image.file_id,
            display_order: image.display_order,
            image_url: authorization.readUrl,
          };
        } catch {
          return {
            file_id: image.file_id,
            display_order: image.display_order,
            image_url: null,
          };
        }
      }),
    );

    return clothingDetail.parse({
      product_id: model.product.product_id,
      code: model.product.code,
      name: model.product.name,
      description: model.product.description ?? '',
      subcategory: model.product.subcategory,
      category:
        model.product.category_id && model.product.category_name
          ? { id: model.product.category_id, name: model.product.category_name }
          : null,
      status: model.product.product_status,
      sizing_mode: model.product.sizing_mode,
      images,
      variants: model.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        size_label: variant.size_label,
        color_label: variant.color_label,
        measurement_mode: variant.measurement_mode,
        measurement_guide_id: variant.measurement_guide_id,
        measurement_unit: variant.measurement_unit,
        measurements: variant.measurements,
        rental_price_minor: variant.rental_price_minor.toString(),
        security_deposit_minor: variant.security_deposit_minor.toString(),
        currency: variant.currency,
        pricing_mode: variant.pricing_mode,
        included_duration_minutes: variant.included_duration_minutes,
        extra_day_price_minor: variant.extra_day_price_minor.toString(),
        prep_minutes: variant.prep_minutes,
        turnaround_minutes: variant.turnaround_minutes,
        status: variant.status,
        assets: (assetsByVariant.get(variant.id) ?? []).map((asset) => ({
          id: asset.id,
          branch_id: asset.branch_id,
          variant_id: asset.variant_id,
          asset_code: asset.asset_code,
          lifecycle_status: asset.lifecycle_status,
          readiness: asset.readiness,
          custody_kind: asset.custody_kind,
          condition_note: asset.condition_note,
          measurement_overrides: asset.measurement_overrides,
          alteration_note: asset.alteration_note,
          version: asset.version,
          created_at: asset.created_at.toISOString(),
          updated_at: asset.updated_at.toISOString(),
        })),
        created_at: variant.created_at.toISOString(),
        updated_at: variant.updated_at.toISOString(),
      })),
      upcoming_allocations: model.upcomingAllocations.map((allocation) => ({
        asset_id: allocation.asset_id,
        reservation_line_id: allocation.reservation_line_id,
        kind: allocation.kind,
        starts_at: allocation.starts_at.toISOString(),
        ends_at: allocation.ends_at.toISOString(),
      })),
      has_more_upcoming_allocations: model.hasMoreUpcomingAllocations,
      created_at: model.product.created_at.toISOString(),
      updated_at: model.product.updated_at.toISOString(),
    });
  });
}

export async function createCatalogueCategory(
  input: CommandContext & { request: CreateCatalogueCategoryRequest },
): Promise<CatalogueCommandResponse<CategoryCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsedRequest = createCatalogueCategoryRequest.safeParse(input.request);
  if (!parsedRequest.success) throw new ValidationError('Category create request is invalid.');
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash(request);

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: CREATE_CATEGORY_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<CategoryCommandBody>(claim);
    if (replay) return replay;

    try {
      const row = await createCategory(client, {
        tenantId: input.tenantId,
        name: request.name,
        displayOrder: request.display_order,
      });
      const data = catalogueCategory.parse(row);
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.category.created',
        entityType: 'category',
        entityId: data.id,
        redactedSummary: { display_order: data.display_order },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: CREATE_CATEGORY_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 201,
        safeResponse: body,
      });
      return { status: 201, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, CREATE_CATEGORY_OPERATION, payloadHash, error);
    }
  });
}

export async function updateCatalogueCategory(
  input: CommandContext & { categoryId: string; request: UpdateCatalogueCategoryRequest },
): Promise<CatalogueCommandResponse<CategoryCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsedRequest = updateCatalogueCategoryRequest.safeParse(input.request);
  if (!parsedRequest.success) throw new ValidationError('Category update request is invalid.');
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash({ category_id: input.categoryId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: UPDATE_CATEGORY_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<CategoryCommandBody>(claim);
    if (replay) return replay;

    try {
      const row = await updateCategory(client, {
        tenantId: input.tenantId,
        categoryId: input.categoryId,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.display_order !== undefined ? { displayOrder: request.display_order } : {}),
      });
      if (!row) throw new NotFoundError('The selected clothing category could not be found.');
      const data = catalogueCategory.parse(row);
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.category.updated',
        entityType: 'category',
        entityId: data.id,
        redactedSummary: { display_order: data.display_order },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: UPDATE_CATEGORY_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, UPDATE_CATEGORY_OPERATION, payloadHash, error);
    }
  });
}

export async function removeCatalogueCategory(
  input: CommandContext & { categoryId: string },
): Promise<CatalogueCommandResponse<RemoveCategoryCommandBody>> {
  assertCatalogueWriteContext(input);
  const payloadHash = canonicalRequestHash({ category_id: input.categoryId });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: REMOVE_CATEGORY_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<RemoveCategoryCommandBody>(claim);
    if (replay) return replay;

    try {
      const removed = await removeCategory(client, input.tenantId, input.categoryId);
      if (!removed) throw new NotFoundError('The selected clothing category could not be found.');
      const data = removeCatalogueCategoryResponse.parse({
        category_id: removed.categoryId,
        outcome: removed.outcome,
      });
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: `catalogue.category.${data.outcome}`,
        entityType: 'category',
        entityId: data.category_id,
        redactedSummary: { outcome: data.outcome },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: REMOVE_CATEGORY_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, REMOVE_CATEGORY_OPERATION, payloadHash, error);
    }
  });
}

export async function updateCatalogueCategoryStatus(
  input: CommandContext & {
    categoryId: string;
    request: UpdateCatalogueCategoryStatusRequest;
  },
): Promise<CatalogueCommandResponse<CategoryCommandBody>> {
  assertCatalogueWriteContext(input);
  const payloadHash = canonicalRequestHash({
    category_id: input.categoryId,
    status: input.request.status,
  });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: UPDATE_CATEGORY_STATUS_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<CategoryCommandBody>(claim);
    if (replay) return replay;

    try {
      const row = await updateCategoryStatus(
        client,
        input.tenantId,
        input.categoryId,
        input.request.status,
      );
      if (!row) {
        throw new NotFoundError('The selected clothing category could not be found.');
      }
      const data = catalogueCategory.parse(row);
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.category.status_updated',
        entityType: 'category',
        entityId: data.id,
        redactedSummary: { status: data.status },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: UPDATE_CATEGORY_STATUS_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(
        client,
        input,
        UPDATE_CATEGORY_STATUS_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

export async function getDefaultMeasurementGuide(
  input: CatalogueContext,
  storage: ObjectStorage = objectStorage,
): Promise<MeasurementGuideDefaultResponse> {
  assertCatalogueReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const row = await readDefaultMeasurementGuide(client, input.tenantId);
    if (!row) return measurementGuideDefaultResponse.parse({ guide: null });
    const imageUrl = await measurementGuideImageUrl(client, input.tenantId, row.file_id, storage);
    return measurementGuideDefaultResponse.parse({ guide: toMeasurementGuide(row, imageUrl) });
  });
}

export async function saveMeasurementGuide(input: CommandContext & {
  request: SaveMeasurementGuideRequest;
}): Promise<CatalogueCommandResponse<GuideCommandBody>> {
  assertCatalogueWriteContext(input);
  const payloadHash = canonicalRequestHash(input.request);

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: SAVE_GUIDE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<GuideCommandBody>(claim);
    if (replay) return replay;

    try {
      if (!(await validateMeasurementGuideFile(client, input.tenantId, input.request.file_id))) {
        throw new ValidationError('The measurement guide image is not an accepted measurement-guide file.');
      }

      const row = await replaceDefaultMeasurementGuide(client, {
        tenantId: input.tenantId,
        fileId: input.request.file_id,
        name: input.request.name,
        makeDefault: input.request.make_default,
      });
      const data = measurementGuide.parse(toMeasurementGuide(row));
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.measurement_guide.saved',
        entityType: 'measurement_guide',
        entityId: data.id,
        redactedSummary: { make_default: input.request.make_default },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: SAVE_GUIDE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 201,
        safeResponse: body,
      });
      return { status: 201, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, SAVE_GUIDE_OPERATION, payloadHash, error);
    }
  });
}

export async function createClothing(input: CommandContext & {
  request: CreateClothingRequest;
}): Promise<CatalogueCommandResponse<ClothingCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsedRequest = createClothingRequest.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new ValidationError('Clothing request is invalid.');
  }
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash(request);
  const physicalPieceCount = request.sizes.length;

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    await lockTenantQuotaScope(client, input.tenantId);
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: CREATE_CLOTHING_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<ClothingCommandBody>(claim);
    if (replay) return replay;

    try {
      const category = await readCategoryForCreate(client, input.tenantId, request.category_id);
      if (!category) {
        throw new NotFoundError('The selected clothing category could not be found.');
      }
      if (category.status !== 'active') {
        throw new InvalidCategoryError('The selected clothing category is inactive.');
      }

      await assertCatalogueImageFiles(client, input.tenantId, request.image_file_ids);

      const measurementGuideIds = Array.from(
        new Set(
          request.sizes.flatMap((size) =>
            size.measurement_mode === 'default_guide' && size.measurement_guide_id
              ? [size.measurement_guide_id]
              : [],
          ),
        ),
      );
      const measurementGuides = await readMeasurementGuidesForCreate(
        client,
        input.tenantId,
        measurementGuideIds,
      );
      if (measurementGuides.length !== measurementGuideIds.length) {
        throw new NotFoundError('A selected measurement guide could not be found.');
      }
      if (measurementGuides.some((guide) => guide.status !== 'active')) {
        throw new InvalidMeasurementGuideError('A selected measurement guide is not active.');
      }

      await assertPhysicalAssetCapacity(client, input.tenantId, physicalPieceCount);
      const money = normalizePricing(request);
      const graph = await createClothingGraph(client, {
        tenantId: input.tenantId,
        branchId: input.branchId,
        request,
        status: request.activate ? 'active' : 'draft',
        ...money,
      });
      const data = createClothingResponse.parse({
        product_id: graph.productId,
        code: graph.code,
        subcategory: request.subcategory ?? null,
        sizing_mode: graph.sizingMode,
        variant_count: graph.variantCount,
        physical_piece_count: graph.physicalPieceCount,
        status: request.activate ? 'active' : 'draft',
      });
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: request.activate ? 'catalogue.clothing.created_active' : 'catalogue.clothing.created_draft',
        entityType: 'product',
        entityId: data.product_id,
        redactedSummary: {
          variant_count: data.variant_count,
          physical_piece_count: data.physical_piece_count,
          measurement_guide_count: measurementGuideIds.length,
        },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: CREATE_CLOTHING_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 201,
        safeResponse: body,
      });
      return { status: 201, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, CREATE_CLOTHING_OPERATION, payloadHash, error);
    }
  });
}

export async function changeClothingSizingMode(input: CommandContext & {
  productId: string;
  request: ChangeClothingSizingModeRequest;
}): Promise<CatalogueCommandResponse<ClothingSizingModeCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsedRequest = changeClothingSizingModeRequest.safeParse(input.request);
  if (!parsedRequest.success) throw new ValidationError('Clothing sizing mode request is invalid.');
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    await lockTenantQuotaScope(client, input.tenantId);
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: CHANGE_CLOTHING_SIZING_MODE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<ClothingSizingModeCommandBody>(claim);
    if (replay) return replay;

    try {
      const product = await readProductForEdit(client, input.tenantId, input.productId);
      if (!product) throw new NotFoundError('The clothing item could not be found.');
      if (product.status === 'archived') throw new StateConflictError('Restore the clothing item before changing sizing mode.');

      const activeVariantCount = await countActiveVariantsForProduct(client, input.tenantId, input.productId);
      if (product.sizing_mode === request.mode) {
        if (activeVariantCount < 1) throw new StateConflictError('The clothing item needs an active variant before its sizing mode can be used.');
        const archivedVariantCount = await countArchivedVariantsForProduct(client, input.tenantId, input.productId);
        const preserved = await readPreservedFreeSizeVariant(client, input.tenantId, input.productId);
        const data = changeClothingSizingModeResponse.parse({
          product_id: input.productId,
          sizing_mode: product.sizing_mode,
          active_variant_count: activeVariantCount,
          archived_variant_count: archivedVariantCount,
          free_size_variant_id: preserved?.id ?? null,
        });
        const body = successBody(input.requestId, data);
        await finalizeTenantIdempotency(client, {
          tenantId: input.tenantId,
          principalKey: input.membershipId,
          operation: CHANGE_CLOTHING_SIZING_MODE_OPERATION,
          intentKey: input.idempotencyKey,
          payloadHash,
          status: 'succeeded',
          responseCode: 200,
          safeResponse: body,
        });
        return { status: 200, body };
      }

      const preservedFreeSize = await readPreservedFreeSizeVariant(client, input.tenantId, input.productId);
      let additionalAssets = 0;
      if (request.mode === 'sized') {
        const variants = request.variants ?? [];
        const seenSizes = new Set<string>();
        for (const variant of variants) {
          if (variant.size_label === null) throw new ValidationError('Sized mode requires real size labels.');
          const key = variant.size_label.toLocaleLowerCase();
          if (seenSizes.has(key)) throw new ValidationError('Each sized variant must use a unique size label.');
          seenSizes.add(key);
        }
        additionalAssets = variants.length;
      } else if (!preservedFreeSize || (await countActivePhysicalAssetsForVariant(client, input.tenantId, preservedFreeSize.id)) < 1) {
        additionalAssets = 1;
      }
      if (additionalAssets > 0) await assertPhysicalAssetCapacity(client, input.tenantId, additionalAssets);

      await archiveActiveVariantsForSizingMode(client, input.tenantId, input.productId);
      await updateProductSizingMode(client, {
        tenantId: input.tenantId,
        productId: input.productId,
        sizingMode: request.mode,
      });

      let freeSizeVariantId: string | null = preservedFreeSize?.id ?? null;
      if (request.mode === 'sized') {
        for (const variantRequest of request.variants ?? []) {
          if (variantRequest.measurement_mode === 'default_guide' && variantRequest.measurement_guide_id) {
            const guides = await readMeasurementGuidesForCreate(client, input.tenantId, [variantRequest.measurement_guide_id]);
            if (!guides[0]) throw new NotFoundError('The selected measurement guide could not be found.');
            if (guides[0].status !== 'active') throw new InvalidMeasurementGuideError('The selected measurement guide is not active.');
          }
          const pricing = normalizePricingInput(variantRequest.pricing);
          const variant = await createVariantForProduct(client, {
            tenantId: input.tenantId,
            productId: input.productId,
            request: variantRequest,
            ...pricing,
          });
          await createPhysicalAssetForVariant(client, {
            tenantId: input.tenantId,
            branchId: input.branchId,
            variantId: variant.id,
            request: createPhysicalAssetRequest.parse({}),
          });
        }
      } else if (preservedFreeSize) {
        if (preservedFreeSize.status !== 'active') {
          await updateVariantLifecycle(client, {
            tenantId: input.tenantId,
            variantId: preservedFreeSize.id,
            status: 'active',
          });
        }
        if ((await countActivePhysicalAssetsForVariant(client, input.tenantId, preservedFreeSize.id)) < 1) {
          await createPhysicalAssetForVariant(client, {
            tenantId: input.tenantId,
            branchId: input.branchId,
            variantId: preservedFreeSize.id,
            request: createPhysicalAssetRequest.parse({}),
          });
        }
      } else {
        if (!request.variant) throw new ValidationError('A Free size variant is required for this product.');
        if (request.variant.measurement_mode === 'default_guide' && request.variant.measurement_guide_id) {
          const guides = await readMeasurementGuidesForCreate(client, input.tenantId, [request.variant.measurement_guide_id]);
          if (!guides[0]) throw new NotFoundError('The selected measurement guide could not be found.');
          if (guides[0].status !== 'active') throw new InvalidMeasurementGuideError('The selected measurement guide is not active.');
        }
        const pricing = normalizePricingInput(request.variant.pricing);
        const variant = await createVariantForProduct(client, {
          tenantId: input.tenantId,
          productId: input.productId,
          request: request.variant,
          ...pricing,
        });
        freeSizeVariantId = variant.id;
        await createPhysicalAssetForVariant(client, {
          tenantId: input.tenantId,
          branchId: input.branchId,
          variantId: variant.id,
          request: createPhysicalAssetRequest.parse({}),
        });
      }

      const finalActiveVariantCount = await countActiveVariantsForProduct(client, input.tenantId, input.productId);
      const archivedVariantCount = await countArchivedVariantsForProduct(client, input.tenantId, input.productId);
      const data = changeClothingSizingModeResponse.parse({
        product_id: input.productId,
        sizing_mode: request.mode,
        active_variant_count: finalActiveVariantCount,
        archived_variant_count: archivedVariantCount,
        free_size_variant_id: freeSizeVariantId,
      });
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.clothing.sizing_mode_changed',
        entityType: 'product',
        entityId: input.productId,
        redactedSummary: { sizing_mode: request.mode, active_variant_count: finalActiveVariantCount },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: CHANGE_CLOTHING_SIZING_MODE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, CHANGE_CLOTHING_SIZING_MODE_OPERATION, payloadHash, error);
    }
  });
}

export async function updateClothingProduct(input: CommandContext & {
  productId: string;
  request: UpdateClothingProductRequest;
}): Promise<CatalogueCommandResponse<ClothingProductUpdateCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsedRequest = updateClothingProductRequest.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new ValidationError('Clothing product update request is invalid.');
  }
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: UPDATE_CLOTHING_PRODUCT_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<ClothingProductUpdateCommandBody>(claim);
    if (replay) return replay;

    try {
      const current = await readProductForEdit(client, input.tenantId, input.productId);
      if (!current) throw new NotFoundError('The clothing item could not be found.');
      assertFreshCatalogueTimestamp(
        current.updated_at,
        request.expected_updated_at,
        'This clothing item was changed by another edit. Refresh and try again.',
      );

      if (request.category_id !== undefined) {
        const category = await readCategoryForCreate(client, input.tenantId, request.category_id);
        if (!category) {
          throw new NotFoundError('The selected clothing category could not be found.');
        }
        if (category.status !== 'active') {
          throw new InvalidCategoryError('The selected clothing category is inactive.');
        }
      }

      const updated = await updateProductForEdit(client, {
        tenantId: input.tenantId,
        productId: input.productId,
        current,
        request,
      });
      const category = updated.category_id
        ? await readCategoryForCreate(client, input.tenantId, updated.category_id)
        : null;
      const data = updateClothingProductResponse.parse({
        product_id: updated.id,
        name: updated.name,
        description: updated.description ?? '',
        subcategory: updated.subcategory,
        category: category ? { id: category.id, name: category.name } : null,
        status: updated.status,
        sizing_mode: updated.sizing_mode,
        updated_at: updated.updated_at.toISOString(),
      });
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.clothing.product_updated',
        entityType: 'product',
        entityId: updated.id,
        redactedSummary: {
          changed_fields: Object.keys(request).filter((key) => key !== 'expected_updated_at'),
        },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: UPDATE_CLOTHING_PRODUCT_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(
        client,
        input,
        UPDATE_CLOTHING_PRODUCT_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

export async function updateClothingVariant(input: CommandContext & {
  productId: string;
  variantId: string;
  request: UpdateClothingVariantRequest;
}): Promise<CatalogueCommandResponse<ClothingVariantUpdateCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsedRequest = updateClothingVariantRequest.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new ValidationError('Clothing variant update request is invalid.');
  }
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash({
    product_id: input.productId,
    variant_id: input.variantId,
    ...request,
  });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: UPDATE_CLOTHING_VARIANT_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<ClothingVariantUpdateCommandBody>(claim);
    if (replay) return replay;

    try {
      const product = await readProductForEdit(client, input.tenantId, input.productId);
      if (!product) throw new NotFoundError('The clothing item could not be found.');
      const current = await readVariantForEdit(
        client,
        input.tenantId,
        input.productId,
        input.variantId,
      );
      if (!current) throw new NotFoundError('The clothing variant could not be found.');
      const requestedSize = request.size_label !== undefined ? request.size_label : current.size_label;
      if (product.sizing_mode === 'free_size' && requestedSize !== null) {
        throw new StateConflictError('Switch this clothing item to sized mode before assigning a real size.');
      }
      if (product.sizing_mode === 'sized' && requestedSize === null) {
        throw new StateConflictError('Switch this clothing item to Free size mode before removing the size label.');
      }
      assertFreshCatalogueTimestamp(
        current.updated_at,
        request.expected_updated_at,
        'This clothing variant was changed by another edit. Refresh and try again.',
      );

      if (
        request.measurement?.measurement_mode === 'default_guide' &&
        request.measurement.measurement_guide_id
      ) {
        const guides = await readMeasurementGuidesForCreate(client, input.tenantId, [
          request.measurement.measurement_guide_id,
        ]);
        const guide = guides[0];
        if (!guide) {
          throw new NotFoundError('The selected measurement guide could not be found.');
        }
        if (guide.status !== 'active') {
          throw new InvalidMeasurementGuideError('The selected measurement guide is not active.');
        }
      }

      const pricing = request.pricing ? normalizePricingInput(request.pricing) : null;
      const updated = await updateVariantForEdit(client, {
        tenantId: input.tenantId,
        variantId: input.variantId,
        current,
        request,
        pricing,
      });
      const data = updateClothingVariantResponse.parse({
        variant_id: updated.id,
        product_id: updated.product_id,
        size_label: updated.size_label,
        color_label: updated.color_label,
        measurement_mode: updated.measurement_mode,
        measurement_guide_id: updated.measurement_guide_id,
        measurement_unit: updated.measurement_unit,
        measurements: updated.measurements,
        rental_price_minor: updated.rental_price_minor.toString(),
        security_deposit_minor: updated.security_deposit_minor.toString(),
        currency: updated.currency,
        pricing_mode: updated.pricing_mode,
        included_duration_minutes: updated.included_duration_minutes,
        extra_day_price_minor: updated.extra_day_price_minor.toString(),
        prep_minutes: updated.prep_minutes,
        turnaround_minutes: updated.turnaround_minutes,
        status: updated.status,
        updated_at: updated.updated_at.toISOString(),
      });
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.clothing.variant_updated',
        entityType: 'product_variant',
        entityId: updated.id,
        redactedSummary: {
          product_id: updated.product_id,
          changed_fields: Object.keys(request).filter((key) => key !== 'expected_updated_at'),
          measurement_mode: request.measurement?.measurement_mode ?? null,
          pricing_mode: request.pricing?.mode ?? null,
        },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: UPDATE_CLOTHING_VARIANT_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(
        client,
        input,
        UPDATE_CLOTHING_VARIANT_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

export async function publishClothing(input: CommandContext & {
  productId: string;
  request: PublishClothingRequest;
}): Promise<CatalogueCommandResponse<PublishClothingCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsed = publishClothingRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('Clothing publish request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: PUBLISH_CLOTHING_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<PublishClothingCommandBody>(claim);
    if (replay) return replay;
    try {
      const current = await readProductForEdit(client, input.tenantId, input.productId);
      if (!current) throw new NotFoundError('The clothing item could not be found.');
      assertFreshCatalogueTimestamp(current.updated_at, request.expected_updated_at, 'This clothing item changed before it could be published. Refresh and try again.');
      if (current.status !== 'draft') throw new StateConflictError('Only draft clothing can be published.');
      const publishability = await readProductPublishability(client, input.tenantId, input.productId);
      if (publishability.category_status !== 'active') throw new InvalidCategoryError('Choose an active clothing category before publishing.');
      if (publishability.accepted_image_count < 1) throw new StateConflictError('Add at least one accepted clothing photo before publishing.');
      const graph = await publishClothingGraph(client, input.tenantId, input.productId);
      const data = publishClothingResponse.parse({
        product_id: graph.product.id,
        status: graph.product.status,
        activated_variant_count: graph.activatedVariantCount,
        updated_at: graph.product.updated_at.toISOString(),
      });
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId, actorKey: input.principalId, action: 'catalogue.clothing.published', entityType: 'product', entityId: data.product_id,
        redactedSummary: { activated_variant_count: data.activated_variant_count }, requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: PUBLISH_CLOTHING_OPERATION, intentKey: input.idempotencyKey, payloadHash, status: 'succeeded', responseCode: 200, safeResponse: body });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, PUBLISH_CLOTHING_OPERATION, payloadHash, error);
    }
  });
}

export async function restoreClothing(input: CommandContext & {
  productId: string;
  request: RestoreClothingRequest;
}): Promise<CatalogueCommandResponse<RestoreClothingCommandBody>> {
  assertCatalogueArchiveContext(input);
  const parsed = restoreClothingRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('Clothing restore request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: RESTORE_CLOTHING_OPERATION, intentKey: input.idempotencyKey, payloadHash });
    const replay = replayOrThrow<RestoreClothingCommandBody>(claim);
    if (replay) return replay;
    try {
      const current = await readProductForEdit(client, input.tenantId, input.productId);
      if (!current) throw new NotFoundError('The clothing item could not be found.');
      assertFreshCatalogueTimestamp(current.updated_at, request.expected_updated_at, 'This clothing item changed before it could be restored. Refresh and try again.');
      if (current.status !== 'archived') throw new StateConflictError('Only archived clothing can be restored.');
      const graph = await restoreClothingGraph(client, input.tenantId, input.productId);
      const data = restoreClothingResponse.parse({ product_id: graph.product.id, status: graph.product.status, restored_variant_count: graph.restoredVariantCount, updated_at: graph.product.updated_at.toISOString() });
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.clothing.restored_to_draft',
        entityType: 'product',
        entityId: data.product_id,
        redactedSummary: {
          restored_variant_count: data.restored_variant_count,
          restored_asset_count: graph.restoredAssetCount,
        },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: RESTORE_CLOTHING_OPERATION, intentKey: input.idempotencyKey, payloadHash, status: 'succeeded', responseCode: 200, safeResponse: body });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, RESTORE_CLOTHING_OPERATION, payloadHash, error);
    }
  });
}

export async function updateClothingVariantLifecycle(input: CommandContext & {
  productId: string;
  variantId: string;
  request: UpdateClothingVariantLifecycleRequest;
}): Promise<CatalogueCommandResponse<VariantLifecycleCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsed = updateClothingVariantLifecycleRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('Variant lifecycle request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, variant_id: input.variantId, ...request });
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: UPDATE_VARIANT_LIFECYCLE_OPERATION, intentKey: input.idempotencyKey, payloadHash });
    const replay = replayOrThrow<VariantLifecycleCommandBody>(claim);
    if (replay) return replay;
    try {
      const product = await readProductForEdit(client, input.tenantId, input.productId);
      if (!product) throw new NotFoundError('The clothing item could not be found.');
      if (product.status === 'archived') throw new StateConflictError('Restore the clothing item before changing variant lifecycle.');
      const current = await readVariantForEdit(client, input.tenantId, input.productId, input.variantId);
      if (!current) throw new NotFoundError('The clothing variant could not be found.');
      assertFreshCatalogueTimestamp(current.updated_at, request.expected_updated_at, 'This clothing variant changed before the lifecycle update. Refresh and try again.');
      if (request.status === 'active') {
        const assets = await countActivePhysicalAssetsForVariant(client, input.tenantId, input.variantId);
        if (assets < 1) throw new StateConflictError('This variant needs an active physical piece before it can be used.');
      }
      if (current.status === 'active' && request.status !== 'active' && product.status === 'active') {
        const activeVariants = await countActiveVariantsForProduct(client, input.tenantId, input.productId);
        if (activeVariants <= 1) throw new StateConflictError('An active clothing item must keep at least one active variant.');
      }
      const updated = await updateVariantLifecycle(client, { tenantId: input.tenantId, variantId: input.variantId, status: request.status });
      const data = updateClothingVariantLifecycleResponse.parse({ variant_id: updated.id, product_id: updated.product_id, status: updated.status, outcome: 'updated', updated_at: updated.updated_at.toISOString() });
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, { tenantId: input.tenantId, actorKey: input.principalId, action: 'catalogue.clothing.variant_lifecycle_updated', entityType: 'product_variant', entityId: updated.id, redactedSummary: { status: updated.status }, requestId: input.requestId });
      await finalizeTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: UPDATE_VARIANT_LIFECYCLE_OPERATION, intentKey: input.idempotencyKey, payloadHash, status: 'succeeded', responseCode: 200, safeResponse: body });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, UPDATE_VARIANT_LIFECYCLE_OPERATION, payloadHash, error);
    }
  });
}

export async function removeClothingVariant(input: CommandContext & {
  productId: string;
  variantId: string;
  request: RemoveClothingVariantRequest;
}): Promise<CatalogueCommandResponse<VariantLifecycleCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsed = removeClothingVariantRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('Variant removal request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, variant_id: input.variantId, ...request });
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: REMOVE_VARIANT_OPERATION, intentKey: input.idempotencyKey, payloadHash });
    const replay = replayOrThrow<VariantLifecycleCommandBody>(claim);
    if (replay) return replay;
    try {
      const product = await readProductForEdit(client, input.tenantId, input.productId);
      if (!product) throw new NotFoundError('The clothing item could not be found.');
      if (product.status === 'archived') throw new StateConflictError('Restore the clothing item before removing a variant.');
      const current = await readVariantForEdit(client, input.tenantId, input.productId, input.variantId);
      if (!current) throw new NotFoundError('The clothing variant could not be found.');
      assertFreshCatalogueTimestamp(current.updated_at, request.expected_updated_at, 'This clothing variant changed before removal. Refresh and try again.');
      if (current.status === 'active' && product.status === 'active') {
        const activeVariants = await countActiveVariantsForProduct(client, input.tenantId, input.productId);
        if (activeVariants <= 1) throw new StateConflictError('An active clothing item must keep at least one active variant.');
      }
      const removed = await removeVariantSafely(client, input.tenantId, input.productId, input.variantId);
      const data = updateClothingVariantLifecycleResponse.parse({ variant_id: input.variantId, product_id: input.productId, status: removed.row?.status ?? 'draft', outcome: removed.outcome === 'deleted' ? 'deleted' : 'updated', updated_at: removed.row?.updated_at.toISOString() ?? null });
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, { tenantId: input.tenantId, actorKey: input.principalId, action: removed.outcome === 'deleted' ? 'catalogue.clothing.variant_deleted' : 'catalogue.clothing.variant_archived', entityType: 'product_variant', entityId: input.variantId, redactedSummary: { outcome: removed.outcome }, requestId: input.requestId });
      await finalizeTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: REMOVE_VARIANT_OPERATION, intentKey: input.idempotencyKey, payloadHash, status: 'succeeded', responseCode: 200, safeResponse: body });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, REMOVE_VARIANT_OPERATION, payloadHash, error);
    }
  });
}

export async function createClothingVariant(input: CommandContext & {
  productId: string;
  request: CreateClothingVariantRequest;
}): Promise<CatalogueCommandResponse<CreateVariantCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsed = createClothingVariantRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('Variant create request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, ...request });
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    await lockTenantQuotaScope(client, input.tenantId);
    const claim = await claimTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: CREATE_VARIANT_OPERATION, intentKey: input.idempotencyKey, payloadHash });
    const replay = replayOrThrow<CreateVariantCommandBody>(claim);
    if (replay) return replay;
    try {
      const product = await readProductForEdit(client, input.tenantId, input.productId);
      if (!product) throw new NotFoundError('The clothing item could not be found.');
      if (product.status === 'archived') throw new StateConflictError('Restore the clothing item before adding a variant.');
      if (product.sizing_mode === 'free_size' && request.size_label !== null) {
        throw new StateConflictError('Switch this clothing item to sized mode before adding a real size variant.');
      }
      if (product.sizing_mode === 'sized' && request.size_label === null) {
        throw new StateConflictError('Switch this clothing item to Free size mode before adding an unsized variant.');
      }
      if (request.size_label === null) {
        const existingFreeSize = await readPreservedFreeSizeVariant(client, input.tenantId, input.productId);
        if (existingFreeSize) {
          throw new StateConflictError('This clothing item already has a Free size variant. Use the sizing-mode command to change modes.');
        }
      }
      if (request.measurement_mode === 'default_guide' && request.measurement_guide_id) {
        const guides = await readMeasurementGuidesForCreate(client, input.tenantId, [request.measurement_guide_id]);
        if (!guides[0]) throw new NotFoundError('The selected measurement guide could not be found.');
        if (guides[0].status !== 'active') throw new InvalidMeasurementGuideError('The selected measurement guide is not active.');
      }
      await assertPhysicalAssetCapacity(client, input.tenantId, 1);
      const pricing = normalizePricingInput(request.pricing);
      const row = await createVariantForProduct(client, { tenantId: input.tenantId, productId: input.productId, request, ...pricing });
      const assetRequest = createPhysicalAssetRequest.parse({});
      const asset = await createPhysicalAssetForVariant(client, {
        tenantId: input.tenantId,
        branchId: input.branchId,
        variantId: row.id,
        request: assetRequest,
      });
      const data = createClothingVariantResponse.parse({ variant: {
        id: row.id, sku: row.sku, size_label: row.size_label, color_label: row.color_label,
        measurement_mode: row.measurement_mode, measurement_guide_id: row.measurement_guide_id,
        measurement_unit: row.measurement_unit, measurements: row.measurements,
        rental_price_minor: row.rental_price_minor.toString(), security_deposit_minor: row.security_deposit_minor.toString(), currency: row.currency,
        pricing_mode: row.pricing_mode, included_duration_minutes: row.included_duration_minutes,
        extra_day_price_minor: row.extra_day_price_minor.toString(), prep_minutes: row.prep_minutes, turnaround_minutes: row.turnaround_minutes,
        status: row.status, assets: [toPhysicalAssetSummary(asset)], created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
      } });
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, { tenantId: input.tenantId, actorKey: input.principalId, action: 'catalogue.clothing.variant_created', entityType: 'product_variant', entityId: row.id, redactedSummary: { product_id: input.productId, status: row.status, physical_piece_count: 1 }, requestId: input.requestId });
      await appendCatalogueAuditEvent(client, { tenantId: input.tenantId, actorKey: input.principalId, action: 'catalogue.asset.created', entityType: 'physical_asset', entityId: asset.id, redactedSummary: { product_id: input.productId, variant_id: row.id, source: 'v1_add_variant' }, requestId: input.requestId });
      await finalizeTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: CREATE_VARIANT_OPERATION, intentKey: input.idempotencyKey, payloadHash, status: 'succeeded', responseCode: 201, safeResponse: body });
      return { status: 201, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, CREATE_VARIANT_OPERATION, payloadHash, error);
    }
  });
}

export async function createPhysicalAsset(input: CommandContext & {
  productId: string;
  variantId: string;
  request: CreatePhysicalAssetRequest;
}): Promise<CatalogueCommandResponse<CreatePhysicalAssetCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsed = createPhysicalAssetRequest.safeParse(input.request);
  if (!parsed.success) throw new ValidationError('Physical piece create request is invalid.');
  const request = parsed.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, variant_id: input.variantId, ...request });
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    await lockTenantQuotaScope(client, input.tenantId);
    const claim = await claimTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: CREATE_PHYSICAL_ASSET_OPERATION, intentKey: input.idempotencyKey, payloadHash });
    const replay = replayOrThrow<CreatePhysicalAssetCommandBody>(claim);
    if (replay) return replay;
    try {
      const product = await readProductForEdit(client, input.tenantId, input.productId);
      if (!product) throw new NotFoundError('The clothing item could not be found.');
      if (product.status === 'archived') throw new StateConflictError('Restore the clothing item before adding a physical piece.');
      const variant = await readVariantForEdit(client, input.tenantId, input.productId, input.variantId);
      if (!variant) throw new NotFoundError('The clothing variant could not be found.');
      if (variant.status === 'archived') throw new StateConflictError('Restore or draft the variant before adding a physical piece.');
      await assertPhysicalAssetCapacity(client, input.tenantId, 1);
      const row = await createPhysicalAssetForVariant(client, { tenantId: input.tenantId, branchId: input.branchId, variantId: input.variantId, request });
      const data = createPhysicalAssetResponse.parse({ asset: toPhysicalAssetSummary(row) });
      const body = successBody(input.requestId, data);
      await appendCatalogueAuditEvent(client, { tenantId: input.tenantId, actorKey: input.principalId, action: 'catalogue.asset.created', entityType: 'physical_asset', entityId: row.id, redactedSummary: { product_id: input.productId, variant_id: input.variantId }, requestId: input.requestId });
      await finalizeTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: CREATE_PHYSICAL_ASSET_OPERATION, intentKey: input.idempotencyKey, payloadHash, status: 'succeeded', responseCode: 201, safeResponse: body });
      return { status: 201, body };
    } catch (error) {
      return finalizeKnownFailure(client, input, CREATE_PHYSICAL_ASSET_OPERATION, payloadHash, error);
    }
  });
}

export async function updatePhysicalAssetState(input: CommandContext & {
  assetId: string;
  request: UpdatePhysicalAssetStateRequest;
}): Promise<CatalogueCommandResponse<PhysicalAssetStateCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsedRequest = updatePhysicalAssetStateRequest.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new ValidationError('Physical asset state request is invalid.');
  }
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash({ asset_id: input.assetId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: UPDATE_PHYSICAL_ASSET_STATE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<PhysicalAssetStateCommandBody>(claim);
    if (replay) return replay;

    try {
      const current = await readPhysicalAssetForStateMutation(
        client,
        input.tenantId,
        input.branchId,
        input.assetId,
      );
      if (!current) throw new NotFoundError('The physical asset could not be found.');
      if (current.version !== request.expected_version) {
        throw new StaleVersionError(
          'This physical asset changed before your update. Refresh and try again.',
        );
      }

      const constraints = await readAssetOperationalConstraints(client, {
        tenantId: input.tenantId,
        branchId: input.branchId,
        assetId: input.assetId,
      });
      const requestedLifecycle = request.lifecycle_status ?? current.lifecycle_status;

      if (
        current.lifecycle_status !== 'active' &&
        requestedLifecycle !== current.lifecycle_status
      ) {
        throw new StateConflictError(
          'Retired or lost assets cannot be reactivated through a generic clothing edit.',
        );
      }
      if (
        current.lifecycle_status !== 'active' &&
        request.readiness !== undefined &&
        request.readiness !== current.readiness
      ) {
        throw new StateConflictError(
          'Readiness cannot be changed for a retired or lost asset through a generic clothing edit.',
        );
      }
      if (request.readiness === 'ready' && current.custody_kind !== 'at_branch') {
        throw new UnresolvedCustodyError(
          'An asset outside the branch cannot be marked ready through Clothing.',
        );
      }
      if (request.readiness === 'ready' && constraints.openMaintenanceCount > 0) {
        throw new StateConflictError(
          'Close required cleaning or maintenance work before marking this asset ready.',
        );
      }
      if (requestedLifecycle === 'retired' && current.lifecycle_status !== 'retired') {
        if (current.custody_kind !== 'at_branch') {
          throw new UnresolvedCustodyError(
            'Return or transfer custody must be resolved before this asset can be retired.',
          );
        }
        if (constraints.blockingAllocationCount > 0) {
          throw new StateConflictError(
            'This asset has blocking reservation or maintenance work and cannot be retired yet.',
          );
        }
        if (constraints.openMaintenanceCount > 0) {
          throw new StateConflictError(
            'Close required maintenance work before retiring this asset.',
          );
        }
      }

      const recoveryReleasedAt =
        request.readiness === 'ready' &&
        requestedLifecycle === 'active' &&
        current.recovery_managed_readiness
          ? await truncateRecoveryForReadyAsset(client, {
              tenantId: input.tenantId,
              branchId: input.branchId,
              assetId: input.assetId,
            })
          : null;
      const forcedReadiness =
        requestedLifecycle === 'retired' || requestedLifecycle === 'lost' ? 'unready' : undefined;
      const updated = await persistPhysicalAssetState(client, {
        tenantId: input.tenantId,
        assetId: input.assetId,
        expectedVersion: request.expected_version,
        current,
        request,
        ...(forcedReadiness ? { forcedReadiness } : {}),
      });

      const shouldCreateDisruption =
        updated.lifecycle_status === 'lost' || updated.readiness !== 'ready';
      const disruptionsCreated = shouldCreateDisruption
        ? await createDisruptionsForThreatenedReservations(client, {
            tenantId: input.tenantId,
            branchId: input.branchId,
            assetId: input.assetId,
            reason:
              updated.lifecycle_status === 'lost'
                ? 'Physical asset was marked lost while a future reservation remains allocated.'
                : `Physical asset readiness changed to ${updated.readiness} while a future reservation remains allocated.`,
          })
        : 0;
      const afterConstraints = await readAssetOperationalConstraints(client, {
        tenantId: input.tenantId,
        branchId: input.branchId,
        assetId: input.assetId,
      });
      const data = updatePhysicalAssetStateResponse.parse({
        asset: toPhysicalAssetSummary(updated),
        blocking_allocation_count: afterConstraints.blockingAllocationCount,
        disruptions_created: disruptionsCreated,
      });
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.asset.state_updated',
        entityType: 'physical_asset',
        entityId: updated.id,
        redactedSummary: {
          lifecycle_status: updated.lifecycle_status,
          readiness: updated.readiness,
          blocking_allocation_count: afterConstraints.blockingAllocationCount,
          disruptions_created: disruptionsCreated,
          recovery_released_early: recoveryReleasedAt !== null,
          version: updated.version,
        },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: UPDATE_PHYSICAL_ASSET_STATE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(
        client,
        input,
        UPDATE_PHYSICAL_ASSET_STATE_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

export async function createAssetMaintenanceBlock(input: CommandContext & {
  assetId: string;
  request: CreateAssetMaintenanceBlockRequest;
}): Promise<CatalogueCommandResponse<AssetMaintenanceBlockCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsedRequest = createAssetMaintenanceBlockRequest.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new ValidationError('Asset maintenance block request is invalid.');
  }
  const request = parsedRequest.data;
  if (new Date(request.period.end).getTime() <= Date.now()) {
    throw new ValidationError('Maintenance/manual blocks must end in the future.');
  }
  const payloadHash = canonicalRequestHash({ asset_id: input.assetId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: CREATE_ASSET_MAINTENANCE_BLOCK_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<AssetMaintenanceBlockCommandBody>(claim);
    if (replay) return replay;

    try {
      const asset = await readPhysicalAssetForStateMutation(
        client,
        input.tenantId,
        input.branchId,
        input.assetId,
      );
      if (!asset) throw new NotFoundError('The physical asset could not be found.');
      if (asset.lifecycle_status !== 'active') {
        throw new StateConflictError(
          'Maintenance or manual downtime can only be scheduled for an active physical asset.',
        );
      }

      const created = await createMaintenanceBlock(client, {
        tenantId: input.tenantId,
        branchId: input.branchId,
        assetId: input.assetId,
        request,
      });
      const data = createAssetMaintenanceBlockResponse.parse({
        work_order_id: created.workOrderId,
        allocation_id: created.allocationId,
        asset_id: created.assetId,
        branch_id: created.branchId,
        kind: created.kind,
        period: {
          start: created.startsAt.toISOString(),
          end: created.endsAt.toISOString(),
        },
        status: 'open',
        is_blocking: true,
        created_at: created.createdAt.toISOString(),
      });
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.asset.maintenance_block_created',
        entityType: 'physical_asset',
        entityId: asset.id,
        redactedSummary: {
          work_order_id: data.work_order_id,
          allocation_id: data.allocation_id,
          kind: data.kind,
          starts_at: data.period.start,
          ends_at: data.period.end,
        },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: CREATE_ASSET_MAINTENANCE_BLOCK_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 201,
        safeResponse: body,
      });
      return { status: 201, body };
    } catch (error) {
      return finalizeKnownFailure(
        client,
        input,
        CREATE_ASSET_MAINTENANCE_BLOCK_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

export async function archiveClothing(input: CommandContext & {
  productId: string;
  request: ArchiveClothingRequest;
}): Promise<CatalogueCommandResponse<ArchiveClothingCommandBody>> {
  assertCatalogueArchiveContext(input);
  const parsedRequest = archiveClothingRequest.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new ValidationError('Clothing archive request is invalid.');
  }
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: ARCHIVE_CLOTHING_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<ArchiveClothingCommandBody>(claim);
    if (replay) return replay;

    try {
      const current = await readProductForEdit(client, input.tenantId, input.productId);
      if (!current) throw new NotFoundError('The clothing item could not be found.');
      assertFreshCatalogueTimestamp(
        current.updated_at,
        request.expected_updated_at,
        'This clothing item changed before it could be archived. Refresh and try again.',
      );
      if (current.status === 'archived') {
        throw new StateConflictError('This clothing item is already archived.');
      }

      const assets = await readPhysicalAssetsForArchive(client, input.tenantId, input.productId);
      const retireAssetIds = assets
        .filter(
          (asset) =>
            asset.lifecycle_status === 'active' &&
            asset.readiness === 'ready' &&
            asset.custody_kind === 'at_branch' &&
            asset.blocking_allocation_count === 0 &&
            asset.open_maintenance_count === 0,
        )
        .map((asset) => asset.id);
      const retireAssetIdSet = new Set(retireAssetIds);
      const pendingAssetResolutionCount = assets.filter(
        (asset) =>
          asset.lifecycle_status === 'active' &&
          !retireAssetIdSet.has(asset.id),
      ).length;

      const archived = await archiveClothingGraph(client, {
        tenantId: input.tenantId,
        productId: input.productId,
        retireAssetIds,
      });
      const data = archiveClothingResponse.parse({
        product_id: archived.product.id,
        status: archived.product.status,
        archived_variant_count: archived.archivedVariantCount,
        retired_asset_count: archived.retiredAssetCount,
        pending_asset_resolution_count: pendingAssetResolutionCount,
        updated_at: archived.product.updated_at.toISOString(),
      });
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.clothing.archived',
        entityType: 'product',
        entityId: archived.product.id,
        redactedSummary: {
          archived_variant_count: archived.archivedVariantCount,
          retired_asset_count: archived.retiredAssetCount,
          pending_asset_resolution_count: pendingAssetResolutionCount,
        },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: ARCHIVE_CLOTHING_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(
        client,
        input,
        ARCHIVE_CLOTHING_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

export async function replaceClothingImages(input: CommandContext & {
  productId: string;
  request: ReplaceClothingImagesRequest;
}): Promise<CatalogueCommandResponse<ClothingImagesCommandBody>> {
  assertCatalogueWriteContext(input);
  const parsedRequest = replaceClothingImagesRequest.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new ValidationError('Clothing image request is invalid.');
  }
  const request = parsedRequest.data;
  const payloadHash = canonicalRequestHash({ product_id: input.productId, ...request });

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const product = await readProductForImageMutation(client, input.tenantId, input.productId);
    if (!product) throw new NotFoundError('The clothing item could not be found.');

    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: REPLACE_CLOTHING_IMAGES_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    const replay = replayOrThrow<ClothingImagesCommandBody>(claim);
    if (replay) return replay;

    try {
      await assertCatalogueImageFiles(client, input.tenantId, request.file_ids);
      const rows = await replaceProductImages(client, {
        tenantId: input.tenantId,
        productId: input.productId,
        fileIds: request.file_ids,
      });
      const data = replaceClothingImagesResponse.parse({
        images: rows.map((row) => ({
          file_id: row.file_id,
          display_order: row.display_order,
          image_url: null,
        })),
        cover_file_id: rows[0]?.file_id ?? null,
      });
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'catalogue.clothing.images_replaced',
        entityType: 'product',
        entityId: input.productId,
        redactedSummary: {
          image_count: rows.length,
          cover_file_id: rows[0]?.file_id ?? null,
        },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: REPLACE_CLOTHING_IMAGES_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      return finalizeKnownFailure(
        client,
        input,
        REPLACE_CLOTHING_IMAGES_OPERATION,
        payloadHash,
        error,
      );
    }
  });
}

async function assertCatalogueImageFiles(
  client: Parameters<typeof readCatalogueImageFiles>[0],
  tenantId: string,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return;
  const rows = await readCatalogueImageFiles(client, tenantId, fileIds);
  if (rows.length !== fileIds.length) {
    throw new NotFoundError('A selected clothing photo could not be found.');
  }
  if (rows.some((row) => !isAcceptedCatalogueImage(row))) {
    throw new ValidationError('One or more clothing photos are not accepted catalogue images.');
  }
}

function isAcceptedCatalogueImage(row: CatalogueFileRow): boolean {
  return (
    row.purpose === 'catalogue_image' &&
    (row.mime_type === 'image/jpeg' || row.mime_type === 'image/png' || row.mime_type === 'image/webp') &&
    row.byte_size > 0 &&
    row.byte_size <= 10 * 1024 * 1024 &&
    row.lifecycle_status === 'accepted' &&
    Boolean(row.frozen_at && (row.version_id || row.sha256))
  );
}

function assertCatalogueReadContext(input: CatalogueContext): void {
  if (input.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
  if (!input.permissionCodes.includes('assets.manage')) {
    throw new ForbiddenError('This branch does not grant clothing management access.');
  }
}

function assertCatalogueWriteContext(input: CatalogueContext): void {
  if (input.effectiveTenantStatus === 'restricted') {
    throw new TenantRestrictedError('This workspace is temporarily restricted.');
  }
  if (input.effectiveTenantStatus === 'cancelled') {
    throw new TenantCancelledError('This workspace is closed.');
  }
  if (!input.permissionCodes.includes('assets.manage')) {
    throw new ForbiddenError('This branch does not grant clothing management access.');
  }
}

function assertCatalogueArchiveContext(input: CatalogueContext): void {
  assertCatalogueWriteContext(input);
  if (!input.permissionCodes.includes('assets.archive')) {
    throw new ForbiddenError('This branch does not grant clothing archive access.');
  }
}

function toPhysicalAssetSummary(row: EditablePhysicalAssetRow): PhysicalAssetSummary {
  return physicalAssetSummary.parse({
    id: row.id,
    branch_id: row.branch_id,
    variant_id: row.variant_id,
    asset_code: row.asset_code,
    lifecycle_status: row.lifecycle_status,
    readiness: row.readiness,
    custody_kind: row.custody_kind,
    condition_note: row.condition_note,
    measurement_overrides: row.measurement_overrides,
    alteration_note: row.alteration_note,
    version: row.version,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

function normalizePricing(request: CreateClothingRequest): {
  rentalPriceMinor: number;
  securityDepositMinor: number;
  extraDayPriceMinor: number;
  includedDurationMinutes: number;
} {
  return normalizePricingInput(request.pricing);
}

function normalizePricingInput(pricing: ClothingPricingInput): {
  rentalPriceMinor: number;
  securityDepositMinor: number;
  extraDayPriceMinor: number;
  includedDurationMinutes: number;
} {
  const rentalPriceMinor = boundedDbMoney(pricing.rental_price_minor, 'Rental price');
  const securityDepositMinor = boundedDbMoney(
    pricing.security_deposit_minor,
    'Security deposit',
  );
  const extraDayPriceMinor =
    pricing.mode === 'daily'
      ? rentalPriceMinor
      : boundedDbMoney(pricing.extra_day_price_minor, 'Extra-day price');
  const includedDurationMinutes =
    pricing.mode === 'daily' ? 24 * 60 : pricing.included_days * 24 * 60;
  return {
    rentalPriceMinor,
    securityDepositMinor,
    extraDayPriceMinor,
    includedDurationMinutes,
  };
}

function assertFreshCatalogueTimestamp(actual: Date, expected: string, message: string): void {
  if (actual.getTime() !== new Date(expected).getTime()) {
    throw new StaleVersionError(message);
  }
}

function boundedDbMoney(value: string, label: string): number {
  const parsed = BigInt(value);
  if (parsed > BigInt(POSTGRES_INT_MAX)) {
    throw new ValidationError(`${label} is outside the supported amount range.`);
  }
  return Number(parsed);
}

async function measurementGuideImageUrl(
  client: Parameters<typeof readMeasurementGuideFileForView>[0],
  tenantId: string,
  fileId: string,
  storage: ObjectStorage,
): Promise<string | null> {
  const file = await readMeasurementGuideFileForView(client, tenantId, fileId);
  if (
    !file ||
    file.lifecycle_status !== 'accepted' ||
    !file.frozen_at ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.mime_type)
  ) {
    return null;
  }
  const authorization = await storage.authorizeRead({
    storageKey: file.storage_key,
    versionId: file.version_id,
    expiresInSeconds: MEASUREMENT_GUIDE_VIEW_EXPIRY_SECONDS,
  });
  return authorization.readUrl;
}

function toMeasurementGuide(row: MeasurementGuideRow, imageUrl: string | null = null): MeasurementGuide {
  return {
    id: row.id as MeasurementGuide['id'],
    file_id: row.file_id as MeasurementGuide['file_id'],
    image_url: imageUrl,
    name: row.name,
    status: row.status,
    is_default: row.is_default,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function replayOrThrow<TBody>(claim: Awaited<ReturnType<typeof claimTenantIdempotency>>):
  | CatalogueCommandResponse<TBody>
  | null {
  if (claim.kind === 'replayed') {
    return { status: claim.responseCode, body: claim.safeResponse as TBody };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical request is already being processed. Retry shortly.');
  }
  return null;
}

async function finalizeKnownFailure<TBody>(
  client: Parameters<typeof finalizeTenantIdempotency>[0],
  input: CommandContext,
  operation: string,
  payloadHash: string,
  error: unknown,
): Promise<CatalogueCommandResponse<TBody>> {
  if (!isAppError(error)) throw error;
  const body = failureBody(input.requestId, error.code, error.message);
  await finalizeTenantIdempotency(client, {
    tenantId: input.tenantId,
    principalKey: input.membershipId,
    operation,
    intentKey: input.idempotencyKey,
    payloadHash,
    status: 'failed',
    responseCode: error.status,
    safeResponse: body,
  });
  return { status: error.status, body: body as TBody };
}

function successBody<T>(requestId: string, data: T): SuccessEnvelope<T> {
  return { success: true, data, request_id: requestId };
}

function failureBody(
  requestId: string,
  code: FailureEnvelope['error']['code'],
  message: string,
): FailureEnvelope {
  return { success: false, error: { code, message }, request_id: requestId };
}
