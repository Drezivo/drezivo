import {
  catalogueCategoryList,
  createClothingResponse,
  measurementGuide,
  measurementGuideDefaultResponse,
  type CatalogueCategoryList,
  type CreateClothingRequest,
  type CreateClothingResponse,
  type MeasurementGuide,
  type MeasurementGuideDefaultResponse,
  type PermissionCode,
  type SaveMeasurementGuideRequest,
  type TenantStatus,
} from '@drezivo/contracts';

import { withTenantTransaction } from '../../db/client.js';
import { assertPhysicalAssetCapacity } from '../entitlements/entitlements.service.js';
import {
  ForbiddenError,
  IdempotencyKeyReusedError,
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
  appendCatalogueAuditEvent,
  categoryExists,
  createClothingGraph,
  listCategories,
  readDefaultMeasurementGuide,
  replaceDefaultMeasurementGuide,
  validateCatalogueImageFiles,
  validateMeasurementGuideFile,
  type MeasurementGuideRow,
} from './catalogue.repository.js';

const SAVE_GUIDE_OPERATION = 'catalogue.measurement_guide.save';
const CREATE_CLOTHING_OPERATION = 'catalogue.clothing.create';
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
  const payloadHash = canonicalRequestHash(input.request);

  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
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
      if (!(await categoryExists(client, input.tenantId, input.request.category_id))) {
        throw new NotFoundError('The selected clothing category could not be found.');
      }
      if (!(await validateCatalogueImageFiles(client, input.tenantId, input.request.image_file_ids))) {
        throw new ValidationError('One or more clothing photos are not accepted catalogue images.');
      }

      const usesDefaultGuide = input.request.sizes.some(
        (size) => size.measurement_mode === 'default_guide',
      );
      const defaultGuide = usesDefaultGuide
        ? await readDefaultMeasurementGuide(client, input.tenantId)
        : null;
      if (usesDefaultGuide && !defaultGuide) {
        throw new ValidationError(
          'Set a default measurement guide or choose custom/no measurements for every size.',
        );
      }

      await assertPhysicalAssetCapacity(client, input.tenantId, input.request.sizes.length);
      const money = normalizePricing(input.request);
      const graph = await createClothingGraph(client, {
        tenantId: input.tenantId,
        branchId: input.branchId,
        request: input.request,
        defaultGuideId: defaultGuide?.id ?? null,
        status: input.request.activate ? 'active' : 'draft',
        ...money,
      });
      const data = createClothingResponse.parse({
        product_id: graph.productId,
        code: graph.code,
        variant_count: graph.variantCount,
        physical_piece_count: graph.physicalPieceCount,
        status: input.request.activate ? 'active' : 'draft',
      });
      const body = successBody(input.requestId, data);

      await appendCatalogueAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: input.request.activate ? 'catalogue.clothing.created_active' : 'catalogue.clothing.created_draft',
        entityType: 'product',
        entityId: data.product_id,
        redactedSummary: {
          variant_count: data.variant_count,
          physical_piece_count: data.physical_piece_count,
          uses_default_measurement_guide: usesDefaultGuide,
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
