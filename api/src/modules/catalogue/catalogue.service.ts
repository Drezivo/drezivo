import {
  catalogueCategory,
  catalogueCategoryList,
  clothingDetail,
  clothingListResponse,
  createClothingRequest,
  createClothingResponse,
  measurementGuide,
  measurementGuideDefaultResponse,
  type CatalogueCategory,
  type CatalogueCategoryList,
  type ClothingDetail,
  type ClothingListQuery,
  type ClothingListResponse,
  type CreateClothingRequest,
  type CreateClothingResponse,
  type MeasurementGuide,
  type MeasurementGuideDefaultResponse,
  type PermissionCode,
  type SaveMeasurementGuideRequest,
  type TenantStatus,
  type UpdateCatalogueCategoryStatusRequest,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
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
  TenantCancelledError,
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
  listClothingReadModel,
  readClothingDetailModel,
} from './catalogue.read.repository.js';
import {
  appendCatalogueAuditEvent,
  createClothingGraph,
  listCategories,
  readCategoryForCreate,
  readDefaultMeasurementGuide,
  readMeasurementGuidesForCreate,
  updateCategoryStatus,
  replaceDefaultMeasurementGuide,
  validateCatalogueImageFiles,
  validateMeasurementGuideFile,
  type MeasurementGuideRow,
} from './catalogue.repository.js';

const SAVE_GUIDE_OPERATION = 'catalogue.measurement_guide.save';
const CREATE_CLOTHING_OPERATION = 'catalogue.clothing.create';
const UPDATE_CATEGORY_STATUS_OPERATION = 'catalogue.category.status.update';
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
type CategoryCommandBody = SuccessEnvelope<CatalogueCategory> | FailureEnvelope;

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
): Promise<ClothingListResponse> {
  assertCatalogueReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const page = await listClothingReadModel(client, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      query,
    });
    return clothingListResponse.parse({
      items: page.rows.map((row) => ({
        product_id: row.product_id,
        code: row.code,
        name: row.name,
        category:
          row.category_id && row.category_name
            ? { id: row.category_id, name: row.category_name }
            : null,
        product_status: row.product_status,
        size_labels: row.size_labels,
        price_from_minor: row.price_from_minor.toString(),
        currency: row.currency,
        primary_image_url: null,
        readiness: {
          active_assets: row.active_assets,
          ready: row.ready,
          needs_cleaning: row.needs_cleaning,
          needs_repair: row.needs_repair,
          unready: row.unready,
        },
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      })),
      page_meta: {
        next_cursor: page.nextCursor,
        has_more: page.hasMore,
      },
    });
  });
}

export async function getCatalogueClothingDetail(
  input: CatalogueContext,
  productId: string,
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

    return clothingDetail.parse({
      product_id: model.product.product_id,
      code: model.product.code,
      name: model.product.name,
      description: model.product.description ?? '',
      category:
        model.product.category_id && model.product.category_name
          ? { id: model.product.category_id, name: model.product.category_name }
          : null,
      status: model.product.product_status,
      images: model.images.map((image) => ({
        file_id: image.file_id,
        display_order: image.display_order,
        image_url: null,
      })),
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
): Promise<MeasurementGuideDefaultResponse> {
  assertCatalogueReadContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const row = await readDefaultMeasurementGuide(client, input.tenantId);
    return measurementGuideDefaultResponse.parse({ guide: row ? toMeasurementGuide(row) : null });
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

      if (!(await validateCatalogueImageFiles(client, input.tenantId, request.image_file_ids))) {
        throw new ValidationError('One or more clothing photos are not accepted catalogue images.');
      }

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

function normalizePricing(request: CreateClothingRequest): {
  rentalPriceMinor: number;
  securityDepositMinor: number;
  extraDayPriceMinor: number;
  includedDurationMinutes: number;
} {
  const rentalPriceMinor = boundedDbMoney(request.pricing.rental_price_minor, 'Rental price');
  const securityDepositMinor = boundedDbMoney(
    request.pricing.security_deposit_minor,
    'Security deposit',
  );
  const extraDayPriceMinor =
    request.pricing.mode === 'daily'
      ? rentalPriceMinor
      : boundedDbMoney(request.pricing.extra_day_price_minor, 'Extra-day price');
  const includedDurationMinutes =
    request.pricing.mode === 'daily' ? 24 * 60 : request.pricing.included_days * 24 * 60;
  return {
    rentalPriceMinor,
    securityDepositMinor,
    extraDayPriceMinor,
    includedDurationMinutes,
  };
}

function boundedDbMoney(value: string, label: string): number {
  const parsed = BigInt(value);
  if (parsed > BigInt(POSTGRES_INT_MAX)) {
    throw new ValidationError(`${label} is outside the supported amount range.`);
  }
  return Number(parsed);
}

function toMeasurementGuide(row: MeasurementGuideRow): MeasurementGuide {
  return {
    id: row.id as MeasurementGuide['id'],
    file_id: row.file_id as MeasurementGuide['file_id'],
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
