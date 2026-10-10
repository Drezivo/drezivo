/**
 * Batch import for the clothing catalogue: an owner with hundreds of garments adds them in one
 * sitting instead of one form at a time.
 *
 * The batch endpoints wrap the existing single-item commands (upload authorize/finalize and create
 * clothing). Each item carries its own idempotency key, generated once per row by the client, so a
 * retried batch replays the rows that already succeeded and only re-runs the rest. Item requests
 * are validated by the single-item command, not here, so one bad row fails alone instead of
 * rejecting the whole batch.
 */
import { z } from 'zod';

import { fileObjectId } from '../common/ids';
import { idempotencyKey } from '../common/idempotency';
import { nonNegativeMoneyString } from '../common/money';
import { MAX_UPLOAD_BYTES, sha256Base64, uploadContentType } from '../files/uploads';
import { measurementUnit, variantFitRange, variantMeasurementMap } from './admin';

/** Rows per batch request. The client splits larger imports into consecutive batches. */
export const MAX_IMPORT_BATCH_ITEMS = 25;

function uniqueKeys<T extends { idempotency_key: string }>(items: T[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.idempotency_key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'idempotency_key'],
        message: 'Each item in a batch needs its own idempotency key.',
      });
    }
    seen.add(item.idempotency_key);
  });
}

/** POST /catalogue/import/uploads: authorize up to 25 catalogue photo uploads. */
export const batchUploadAuthorizationRequest = z
  .object({
    items: z
      .array(
        z
          .object({
            idempotency_key: idempotencyKey,
            content_type: uploadContentType,
            byte_size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
            sha256: sha256Base64,
          })
          .strict(),
      )
      .min(1)
      .max(MAX_IMPORT_BATCH_ITEMS),
  })
  .strict()
  .superRefine((value, ctx) => uniqueKeys(value.items, ctx));
export type BatchUploadAuthorizationRequest = z.infer<typeof batchUploadAuthorizationRequest>;

/** POST /catalogue/import/uploads/finalize: finalize up to 25 uploaded catalogue photos. */
export const batchUploadFinalizeRequest = z
  .object({
    items: z
      .array(z.object({ idempotency_key: idempotencyKey, file_id: fileObjectId }).strict())
      .min(1)
      .max(MAX_IMPORT_BATCH_ITEMS),
  })
  .strict()
  .superRefine((value, ctx) => uniqueKeys(value.items, ctx));
export type BatchUploadFinalizeRequest = z.infer<typeof batchUploadFinalizeRequest>;

/** POST /catalogue/import/clothing: create up to 25 clothing products (drafts unless activated). */
export const batchCreateClothingRequest = z
  .object({
    items: z
      .array(
        z
          .object({
            idempotency_key: idempotencyKey,
            /** A createClothingRequest; validated per item by the create command. */
            request: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_IMPORT_BATCH_ITEMS),
  })
  .strict()
  .superRefine((value, ctx) => uniqueKeys(value.items, ctx));
export type BatchCreateClothingRequest = z.infer<typeof batchCreateClothingRequest>;

/**
 * One row's outcome: the HTTP status and response envelope the single-item endpoint would have
 * returned for it. The batch itself answers 200 once every row has an outcome.
 */
export const batchItemResult = z.object({
  idempotency_key: idempotencyKey,
  status: z.number().int().min(100).max(599),
  body: z.unknown(),
});
export type BatchItemResult = z.infer<typeof batchItemResult>;

export const batchResponse = z.object({ results: z.array(batchItemResult) });
export type BatchResponse = z.infer<typeof batchResponse>;

/** GET /catalogue/import/capabilities: what this deployment can do for an import. */
export const catalogueImportCapabilities = z.object({
  /** Whether a vision model is configured to read garment details printed on photos. */
  photo_extraction: z.boolean(),
  max_batch_items: z.number().int().positive(),
});
export type CatalogueImportCapabilities = z.infer<typeof catalogueImportCapabilities>;

/** POST /catalogue/import/extract: read the details printed on one accepted catalogue photo. */
export const clothingPhotoExtractRequest = z.object({ file_id: fileObjectId }).strict();
export type ClothingPhotoExtractRequest = z.infer<typeof clothingPhotoExtractRequest>;

/**
 * Suggestions only: every field is nullable because a photo may not show it, and the owner reviews
 * each row before anything is created.
 */
export const extractedClothingFields = z.object({
  name: z.string().trim().min(1).max(200).nullable(),
  rental_price_minor: nonNegativeMoneyString.nullable(),
  /** Printed size such as "S", "Medium" or "Small-XL"; null when none is shown. */
  size_label: z.string().trim().min(1).max(40).nullable(),
  /** Explicit overall fit range, e.g. "Small–XL"; never inferred from a generic FS label. */
  fit_range: variantFitRange.nullable().optional(),
  /** True when the photo says the piece is free size (e.g. "FS", "Freesize"). */
  free_size: z.boolean(),
  measurement_unit: measurementUnit.nullable(),
  /** Exact numeric measurements or explicit dimension-specific fit notes keyed by label. */
  measurements: variantMeasurementMap,
  color_label: z.string().trim().min(1).max(80).nullable(),
}).superRefine((value, ctx) => {
  if (value.fit_range != null && !value.free_size) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fit_range'], message: 'Fit range is only supported for a flexible-fit variant.' });
  }
});
export type ExtractedClothingFields = z.infer<typeof extractedClothingFields>;

export const clothingPhotoExtractResponse = z.object({ fields: extractedClothingFields });
export type ClothingPhotoExtractResponse = z.infer<typeof clothingPhotoExtractResponse>;
