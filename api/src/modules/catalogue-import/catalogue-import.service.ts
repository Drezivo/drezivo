import type {
  BatchCreateClothingRequest,
  BatchItemResult,
  BatchUploadAuthorizationRequest,
  BatchUploadFinalizeRequest,
  CreateClothingRequest,
  PermissionCode,
  TenantStatus,
} from '@drezivo/contracts';

import { logger } from '../../shared/logger.js';
import { DependencyUnavailableError, isAppError } from '../../shared/errors.js';
import { createClothing } from '../catalogue/catalogue.service.js';
import { authorizeUpload, finalizeUpload } from '../files/files.service.js';

export interface ImportContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
  requestId: string;
}

type ItemCommand = (idempotencyKey: string) => Promise<{ status: number; body: unknown }>;

/** Finalizing reads object metadata from storage, so a few run at once; the rest are DB-bound. */
const FINALIZE_CONCURRENCY = 5;

/**
 * Runs one single-item command per row and reports every row's outcome, the way the single-item
 * endpoint would have answered it. A row's own failure (bad data, quota, duplicate code) stays on
 * that row. A dependency outage stops the batch: rows not yet attempted come back as 503 so the
 * client retries them with the same keys, and rows already done replay instead of repeating.
 */
async function runItems(
  items: Array<{ idempotency_key: string; run: ItemCommand }>,
  requestId: string,
  concurrency = 1,
): Promise<BatchItemResult[]> {
  const results: Array<BatchItemResult | undefined> = items.map(() => undefined);
  let halted = false;
  let next = 0;

  const notAttempted = (key: string): BatchItemResult => ({
    idempotency_key: key,
    status: 503,
    body: failure('DEPENDENCY_UNAVAILABLE', 'This item was not processed. Retry it.', requestId),
  });

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (!item) continue;
      if (halted) {
        results[index] = notAttempted(item.idempotency_key);
        continue;
      }
      try {
        const outcome = await item.run(item.idempotency_key);
        results[index] = { idempotency_key: item.idempotency_key, status: outcome.status, body: outcome.body };
      } catch (error) {
        if (isAppError(error) && !(error instanceof DependencyUnavailableError)) {
          results[index] = {
            idempotency_key: item.idempotency_key,
            status: error.status,
            body: failure(error.code, error.message, requestId, error.fields),
          };
          continue;
        }
        halted = true;
        if (!isAppError(error)) {
          logger.error({ err: error, requestId }, 'catalogue import item failed unexpectedly');
        }
        results[index] = notAttempted(item.idempotency_key);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results.map((result, index) => result ?? notAttempted(items[index]?.idempotency_key ?? ''));
}

function failure(code: string, message: string, requestId: string, fields?: unknown): unknown {
  return {
    success: false,
    error: fields ? { code, message, fields } : { code, message },
    request_id: requestId,
  };
}

export function authorizeImportUploads(
  context: ImportContext,
  request: BatchUploadAuthorizationRequest,
): Promise<BatchItemResult[]> {
  return runItems(
    request.items.map((item) => ({
      idempotency_key: item.idempotency_key,
      run: (idempotencyKey) =>
        authorizeUpload({
          ...context,
          idempotencyKey,
          request: {
            purpose: 'catalogue_image',
            content_type: item.content_type,
            byte_size: item.byte_size,
            sha256: item.sha256,
          },
        }),
    })),
    context.requestId,
  );
}

export function finalizeImportUploads(
  context: ImportContext,
  request: BatchUploadFinalizeRequest,
): Promise<BatchItemResult[]> {
  return runItems(
    request.items.map((item) => ({
      idempotency_key: item.idempotency_key,
      run: (idempotencyKey) => finalizeUpload({ ...context, idempotencyKey, fileId: item.file_id }),
    })),
    context.requestId,
    FINALIZE_CONCURRENCY,
  );
}

export function createImportClothing(
  context: ImportContext,
  request: BatchCreateClothingRequest,
): Promise<BatchItemResult[]> {
  // Sequential on purpose: each create locks the tenant's quota scope, so parallel rows would only
  // queue behind each other while holding pool connections.
  return runItems(
    request.items.map((item) => ({
      idempotency_key: item.idempotency_key,
      run: (idempotencyKey) =>
        createClothing({ ...context, idempotencyKey, request: item.request as CreateClothingRequest }),
    })),
    context.requestId,
  );
}
