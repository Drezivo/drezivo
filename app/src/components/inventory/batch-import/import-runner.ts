import {
  MAX_IMPORT_BATCH_ITEMS,
  createClothingResponse,
  fileObjectId,
  uploadAuthorizationResponse,
  uploadFinalizeResponse,
  type BatchItemResult,
  type ExtractedClothingFields,
} from "@drezivo/contracts";
import { uploadAuthorizedFile } from "@/lib/authorized-file-upload";
import type { createDrezivoApiClient } from "@/lib/drezivo-api";
import { DrezivoApiError } from "@/lib/drezivo-api";

import { newKey, type ImportDefaults, type ImportRow, sameCategory, toCreateRequest } from "./import-model";

type Api = ReturnType<typeof createDrezivoApiClient>;
export type RowUpdate = (id: string, patch: Partial<ImportRow>) => void;

/** Direct-to-storage PUTs and SHA-256 hashing run a few at a time so a phone stays responsive. */
const FILE_CONCURRENCY = 4;
const READ_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 20_000;
const TRANSIENT_WAIT_MS = 3_000;
/** Keep sustained photo reads below the strict free-provider limits instead of bursting into 429s. */
const READ_INTERVAL_MS = 2_100;
/** A throttled batch is retried as-is: every row keeps its key, so finished rows only replay. */
const BATCH_ATTEMPTS = 5;

type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withThrottleRetry<T>(call: () => Promise<T>, wait: Wait): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof DrezivoApiError && error.status === 429) || attempt >= BATCH_ATTEMPTS) throw error;
      await wait(RATE_LIMIT_WAIT_MS);
    }
  }
}

type Schema<T> = { safeParse: (value: unknown) => { success: true; data: T } | { success: false } };

/** The data of a row's success envelope, validated by the contract schema; null otherwise. */
function successData<T>(result: BatchItemResult | undefined, schema: Schema<T>): T | null {
  const body = result?.body as { success?: unknown; data?: unknown } | undefined;
  if (body?.success !== true) return null;
  const parsed = schema.safeParse(body.data);
  return parsed.success ? parsed.data : null;
}

export function chunk<T>(items: T[], size = MAX_IMPORT_BATCH_ITEMS): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/** Runs `work` over every item with at most `limit` in flight; failures stay with their item. */
export async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function rowMessage(result: BatchItemResult | undefined, fallback: string): string {
  const body = result?.body as { success?: unknown; error?: { message?: unknown } } | undefined;
  return body?.success === false && typeof body.error?.message === "string" ? body.error.message : fallback;
}

function byKey(results: BatchItemResult[]): Map<string, BatchItemResult> {
  return new Map(results.map((result) => [result.idempotency_key, result]));
}

async function sha256Base64(file: File): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  digest.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

/**
 * Uploads every row's photo that is not stored yet: authorize 25 at a time, PUT straight to
 * storage, then finalize 25 at a time. Returns the rows' new file ids by row id.
 */
export async function uploadPhotos(api: Api, rows: ImportRow[], update: RowUpdate, wait: Wait = sleep): Promise<Map<string, string>> {
  const uploaded = new Map<string, string>();
  const pending = rows.flatMap((row) => (row.photo && !row.fileId ? [{ row, photo: row.photo }] : []));
  for (const entries of chunk(pending)) {
    const group = entries.map((entry) => entry.row);
    group.forEach((row) => update(row.id, { status: "uploading", message: null }));
    const hashes = new Map<string, string>();
    await eachLimited(entries, FILE_CONCURRENCY, async ({ row, photo }) => {
      hashes.set(row.id, await sha256Base64(photo));
    });

    const authorized = byKey(
      (
        await withThrottleRetry(
          () =>
            api.authorizeImportUploads({
              items: entries.map(({ row, photo }) => ({
                idempotency_key: row.uploadKey,
                content_type: photo.type as "image/jpeg" | "image/png" | "image/webp",
                byte_size: photo.size,
                sha256: hashes.get(row.id) ?? "",
              })),
            }),
          wait
        )
      ).data.results
    );

    const put: Array<{ row: ImportRow; fileId: string }> = [];
    await eachLimited(entries, FILE_CONCURRENCY, async ({ row, photo }) => {
      const result = authorized.get(row.uploadKey);
      const authorization = successData(result, uploadAuthorizationResponse);
      if (!authorization) {
        update(row.id, { status: "error", message: rowMessage(result, "The photo could not be prepared for upload.") });
        return;
      }
      try {
        await uploadAuthorizedFile(authorization, photo, "The photo upload did not finish.");
        put.push({ row, fileId: authorization.file_id });
      } catch (error) {
        update(row.id, { status: "error", message: error instanceof Error ? error.message : "The photo upload did not finish." });
      }
    });
    if (put.length === 0) continue;

    const finalized = byKey(
      (
        await withThrottleRetry(
          () =>
            api.finalizeImportUploads({
              items: put.map(({ row, fileId }) => ({ idempotency_key: row.finalizeKey, file_id: fileObjectId.parse(fileId) })),
            }),
          wait
        )
      ).data.results
    );
    for (const { row } of put) {
      const result = finalized.get(row.finalizeKey);
      const finalizedFile = successData(result, uploadFinalizeResponse);
      if (finalizedFile) {
        uploaded.set(row.id, finalizedFile.file.file_id);
        update(row.id, { status: "draft", fileId: finalizedFile.file.file_id, message: null });
      } else {
        update(row.id, { status: "error", message: rowMessage(result, "The photo was not accepted.") });
      }
    }
  }
  return uploaded;
}

/**
 * Reads the printed details of every uploaded, not-yet-read photo. A rate limit pauses and retries
 * the same photo; any other failure leaves the row for the owner to fill in by hand.
 */
export async function readPhotos(
  api: Api,
  rows: Array<{ id: string; fileId: string }>,
  onRead: (id: string, fields: ExtractedClothingFields | null, message: string | null) => void,
  wait: Wait = sleep
): Promise<void> {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;
    if (index > 0) await wait(READ_INTERVAL_MS);
    for (let attempt = 1; attempt <= READ_RETRIES; attempt += 1) {
      try {
        const result = await api.extractClothingPhoto(row.fileId);
        onRead(row.id, result.data.fields, null);
        break;
      } catch (error) {
        if (error instanceof DrezivoApiError && attempt < READ_RETRIES) {
          if (error.status === 429) {
            await wait(RATE_LIMIT_WAIT_MS);
            continue;
          }
          if (error.status === 503) {
            await wait(TRANSIENT_WAIT_MS);
            continue;
          }
        }
        onRead(
          row.id,
          null,
          error instanceof DrezivoApiError ? error.message : "Could not read this photo. Fill it in by hand."
        );
        break;
      }
    }
  }
}

/** Finds or creates each category the rows use; names match case-insensitively. */
export async function ensureCategories(
  api: Api,
  names: string[],
  existing: Array<{ id: string; name: string }>
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const unique = names.filter((name, index) => names.findIndex((other) => sameCategory(other, name)) === index);
  for (const name of unique) {
    const match = existing.find((category) => sameCategory(category.name, name));
    if (match) {
      ids.set(name.trim().toLocaleLowerCase(), match.id);
      continue;
    }
    const created = await api.createCatalogueCategory({ name: name.trim(), display_order: 0 }, newKey("category"));
    ids.set(name.trim().toLocaleLowerCase(), created.data.id);
  }
  return ids;
}

/** Creates the rows 25 at a time; each row keeps its own result. */
export async function createRows(
  api: Api,
  rows: ImportRow[],
  defaults: ImportDefaults,
  categoryIds: Map<string, string>,
  defaultGuideId: string | null,
  activate: boolean,
  update: RowUpdate,
  wait: Wait = sleep
): Promise<number> {
  let created = 0;
  for (const group of chunk(rows)) {
    group.forEach((row) => update(row.id, { status: "saving", message: null }));
    const results = byKey(
      (
        await withThrottleRetry(
          () =>
            api.createImportClothing({
              items: group.map((row) => ({
                idempotency_key: row.createKey,
                request: toCreateRequest(
                  row,
                  defaults,
                  categoryIds.get(row.category.trim().toLocaleLowerCase()) ?? "",
                  activate,
                  defaultGuideId
                ),
              })),
            }),
          wait
        )
      ).data.results
    );
    for (const row of group) {
      const result = results.get(row.createKey);
      // A 2xx success means the product exists. The id is read strictly when possible, but a
      // response shape change must never turn a created row back into a retryable failure.
      const product = successData(result, createClothingResponse);
      const succeeded = result !== undefined && result.status < 300 && (result.body as { success?: unknown }).success === true;
      if (succeeded) {
        created += 1;
        update(row.id, { status: "created", productId: product?.product_id ?? null, message: null });
      } else {
        update(row.id, { status: "error", message: rowMessage(result, "This item could not be created.") });
      }
    }
  }
  return created;
}
