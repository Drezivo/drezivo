import { randomUUID, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

import {
  catalogueBackupImportCommitResponse,
  catalogueBackupImportPreview,
  type CatalogueBackupImportCommitResponse,
  type CatalogueBackupImportPreview,
} from '@drezivo/contracts';

import { config } from '../../config/index.js';
import { withTenantTransaction } from '../../db/client.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import type { ObjectStorage, StoredObjectRead } from '../../integrations/storage/object-storage.js';
import { DependencyUnavailableError, ForbiddenError, IdempotencyKeyReusedError, NotFoundError, StateConflictError, TenantCancelledError, TenantRestrictedError, ValidationError } from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import { claimTenantIdempotency, finalizeTenantIdempotency } from '../../shared/tenant-idempotency.js';
import { staffUploadStorageKey } from '../files/files.storage-keys.js';
import { enqueueAcceptedFileImageVariants } from '../files/file-image-variants.js';
import type { FileObjectRow } from '../files/files.repository.js';
import { parseCatalogueBackup, type BackupMedia, type ParsedBackup } from './catalogue-backup.bundle.js';
import type { CatalogueBackupContext } from './catalogue-backup.service.js';

interface RestoreState {
  existing: Record<'categories' | 'products' | 'variants' | 'pieces' | 'guides' | 'images', Set<string>>;
  counts: CatalogueBackupImportPreview['counts'];
  conflicts: CatalogueBackupImportPreview['conflicts'];
  conflictsTruncated: boolean;
}

export async function previewCatalogueBackupImport(
  input: CatalogueBackupContext & { fileId: string; idempotencyKey: string },
  storage: ObjectStorage = objectStorage,
): Promise<CatalogueBackupImportPreview> {
  assertWriteContext(input);
  const { file, backup } = await readUploadedBackup(input, input.fileId, storage);
  const result = await withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const payloadHash = canonicalRequestHash({ file_id: input.fileId, branch_id: input.branchId });
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: 'catalogue.backup.import.preview',
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    if (claim.kind === 'replayed') return catalogueBackupImportPreview.parse(claim.safeResponse);
    if (claim.kind === 'key_reused') throw new IdempotencyKeyReusedError('This preview idempotency key was already used for a different request.');
    if (claim.kind === 'in_progress') throw new StateConflictError('This backup preview is still being processed.');

    const state = await readRestoreState(client, input.tenantId, input.branchId, backup);
    const importId = randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const preview = catalogueBackupImportPreview.parse({
      import_id: importId,
      branch_id: input.branchId,
      counts: state.counts,
      conflicts: state.conflicts,
      conflicts_truncated: state.conflictsTruncated,
      expires_at: expiresAt.toISOString(),
    });
    await client.query(
      `INSERT INTO import_job (id, tenant_id, branch_id, requested_by, file_id, status, content_hash, intent_key, result_summary)
       VALUES ($1, $2, $3, $4, $5, 'previewed', $6, $7, $8::jsonb)`,
      [importId, input.tenantId, input.branchId, input.membershipId, input.fileId, file.sha256, `${input.membershipId}:${input.idempotencyKey}`, JSON.stringify({ preview })],
    );
    await appendAudit(client, input, 'catalogue.backup.import_previewed', importId, {
      branch_id: input.branchId,
      conflicts: state.conflicts.length,
      products: backup.rows.products.length,
      pieces: backup.rows.pieces.length,
    });
    await finalizeTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: 'catalogue.backup.import.preview',
      intentKey: input.idempotencyKey,
      payloadHash,
      status: 'succeeded',
      responseCode: 200,
      safeResponse: preview,
    });
    return preview;
  });
  return result;
}

export async function commitCatalogueBackupImport(
  input: CatalogueBackupContext & { importId: string; idempotencyKey: string },
  storage: ObjectStorage = objectStorage,
): Promise<CatalogueBackupImportCommitResponse> {
  assertWriteContext(input);
  const jobInfo = await withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const result = await client.query<{ id: string; branch_id: string | null; file_id: string; status: string; content_hash: string; result_summary: unknown; created_at: Date }>(
      `SELECT id, branch_id, file_id, status, content_hash, result_summary, created_at FROM import_job
        WHERE tenant_id = $1 AND id = $2 AND branch_id = $3 LIMIT 1`,
      [input.tenantId, input.importId, input.branchId],
    );
    return result.rows[0] ?? null;
  });
  if (!jobInfo) throw new NotFoundError('The catalogue backup preview could not be found.');
  if (jobInfo.status === 'committed') {
    const saved = (jobInfo.result_summary as { commit?: unknown } | null)?.commit;
    if (!saved) throw new StateConflictError('The completed restore summary is unavailable.');
    return catalogueBackupImportCommitResponse.parse(saved);
  }
  if (jobInfo.status !== 'previewed' || Date.now() - jobInfo.created_at.getTime() >= 24 * 60 * 60 * 1000) throw new StateConflictError('This backup preview has expired. Preview the archive again.');
  const { file, backup } = await readUploadedBackup(input, jobInfo.file_id, storage);
  if (file.sha256 !== jobInfo.content_hash) throw new StateConflictError('The uploaded backup changed after preview.');
  const uploadedStorageKeys: string[] = [];
  try {
    return await withTenantTransaction(input.tenantId, input.principalId, async (client) => {
      const payloadHash = canonicalRequestHash({ import_id: input.importId });
      const claim = await claimTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: 'catalogue.backup.import.commit',
        intentKey: input.idempotencyKey,
        payloadHash,
      });
      if (claim.kind === 'replayed') return catalogueBackupImportCommitResponse.parse(claim.safeResponse);
      if (claim.kind === 'key_reused') throw new IdempotencyKeyReusedError('This restore idempotency key was already used for a different request.');
      if (claim.kind === 'in_progress') throw new StateConflictError('This restore request is still being processed.');

      const job = await client.query<{ status: 'previewed' | 'committed' | 'failed'; file_id: string; content_hash: string; result_summary: unknown; created_at: Date }>(
        `SELECT status, file_id, content_hash, result_summary, created_at FROM import_job
          WHERE tenant_id = $1 AND id = $2 AND branch_id = $3 FOR UPDATE`,
        [input.tenantId, input.importId, input.branchId],
      );
      const row = job.rows[0];
      if (!row) throw new NotFoundError('The catalogue backup preview could not be found.');
      if (row.status === 'committed') {
        const saved = (row.result_summary as { commit?: unknown } | null)?.commit;
        if (!saved) throw new StateConflictError('The completed restore summary is unavailable.');
        const response = catalogueBackupImportCommitResponse.parse(saved);
        await saveCommitIdempotency(client, input, payloadHash, response);
        return response;
      }
      if (row.status !== 'previewed' || Date.now() - row.created_at.getTime() >= 24 * 60 * 60 * 1000) throw new StateConflictError('This backup preview has expired. Preview the archive again.');
      if (row.file_id !== file.id || file.sha256 !== row.content_hash) throw new StateConflictError('The uploaded backup changed after preview.');

      const state = await readRestoreState(client, input.tenantId, input.branchId, backup);
      if (state.conflicts.length > 0 || state.conflictsTruncated) throw new StateConflictError('The catalogue changed after preview and now conflicts with this backup. Preview it again to review the current conflicts.');
      const created = await applyRestore(client, input, backup, state, storage, uploadedStorageKeys);
      const response = catalogueBackupImportCommitResponse.parse({ import_id: input.importId, status: 'committed', created });
      await client.query(
        `UPDATE import_job SET status = 'committed', result_summary = $3::jsonb, completed_at = statement_timestamp(), updated_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2 AND status = 'previewed'`,
        [input.tenantId, input.importId, JSON.stringify({ preview: (row.result_summary as { preview?: unknown } | null)?.preview, commit: response })],
      );
      if (config.FILE_OBJECT_CLEANUP_ENABLED) await enqueueBackupCleanup(client, input.tenantId, file.id);
      await appendAudit(client, input, 'catalogue.backup.import_committed', input.importId, { branch_id: input.branchId, created });
      await saveCommitIdempotency(client, input, payloadHash, response);
      return response;
    });
  } catch (error) {
    await deleteUnreferencedStorageObjects(input, storage, uploadedStorageKeys);
    throw error;
  }
}

async function deleteUnreferencedStorageObjects(
  input: CatalogueBackupContext,
  storage: ObjectStorage,
  storageKeys: string[],
): Promise<void> {
  if (!storage.deleteObject || storageKeys.length === 0) return;
  let referencedKeys: Set<string>;
  try {
    referencedKeys = await withTenantTransaction(input.tenantId, input.principalId, async (client) => {
      const result = await client.query<{ storage_key: string }>(
        `SELECT storage_key FROM file_object WHERE tenant_id = $1 AND storage_key = ANY($2::text[])`,
        [input.tenantId, storageKeys],
      );
      return new Set(result.rows.map((row) => row.storage_key));
    });
  } catch {
    // A lost commit acknowledgement or database outage is ambiguous; preserve objects until safe to check.
    return;
  }
  for (const key of storageKeys) {
    if (referencedKeys.has(key)) continue;
    try { await storage.deleteObject(key); } catch { /* Preserve the restore failure; storage cleanup is retryable. */ }
  }
}

async function readUploadedBackup(
  input: CatalogueBackupContext,
  fileId: string,
  storage: ObjectStorage,
): Promise<{ file: FileObjectRow; backup: ParsedBackup }> {
  if (!storage.readObject) throw new DependencyUnavailableError('Private file storage is unavailable.');
  const file = await withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const result = await client.query<FileObjectRow>(
      `SELECT id, tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
              lifecycle_status, upload_expires_at, frozen_at
         FROM file_object WHERE tenant_id = $1 AND id = $2 AND purpose = 'catalogue_backup'
           AND mime_type = 'application/zip' AND lifecycle_status = 'accepted'
           AND is_private = true AND frozen_at IS NOT NULL
         LIMIT 1`,
      [input.tenantId, fileId],
    );
    return result.rows[0] ?? null;
  });
  if (!file || !file.sha256) throw new NotFoundError('The uploaded inventory backup could not be found.');
  if (!Number.isSafeInteger(file.byte_size) || file.byte_size < 1 || file.byte_size > 64 * 1024 * 1024) throw new ValidationError('The backup archive exceeds the supported size limit.');
  const object = await storage.readObject({ storageKey: file.storage_key, versionId: file.version_id });
  if (!object || (object.contentLength !== null && object.contentLength !== file.byte_size)) throw new DependencyUnavailableError('The uploaded inventory backup is temporarily unavailable.');
  const bytes = await readObjectBytes(object, file.byte_size);
  if (createHash('sha256').update(bytes).digest('base64') !== file.sha256) throw new ValidationError('The uploaded inventory backup did not pass its checksum check.');
  let backup: ParsedBackup;
  try { backup = parseCatalogueBackup(bytes); } catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'The inventory backup is invalid.'); }
  if (backup.manifest.tenant_id !== input.tenantId || backup.manifest.branch_id !== input.branchId) throw new NotFoundError('This inventory backup belongs to another business or branch.');
  return { file, backup };
}

async function readObjectBytes(object: StoredObjectRead, expected: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of object.body) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > expected - size) throw new ValidationError('The backup archive exceeds its verified size.');
    chunks.push(chunk); size += chunk.byteLength;
  }
  if (size !== expected) throw new ValidationError('The backup archive size does not match its upload record.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readRestoreState(client: PoolClient, tenantId: string, branchId: string, backup: ParsedBackup): Promise<RestoreState> {
  const conflicts: CatalogueBackupImportPreview['conflicts'][number][] = [];
  let conflictsTruncated = false;
  const addConflict = (entity: CatalogueBackupImportPreview['conflicts'][number]['entity'], id: string, reason: string): void => {
    if (conflicts.length < 100) conflicts.push({ entity, id, reason });
    else conflictsTruncated = true;
  };
  const existing = { categories: new Set<string>(), products: new Set<string>(), variants: new Set<string>(), pieces: new Set<string>(), guides: new Set<string>(), images: new Set<string>() };
  const { rows } = backup;

  const categories = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM category WHERE tenant_id = $1 AND (id = ANY($2::uuid[]) OR lower(btrim(name)) = ANY($3::text[]))`,
    [tenantId, ids(rows.categories), rows.categories.map((row) => row['name']?.trim().toLowerCase()).filter(Boolean)],
  );
  for (const row of rows.categories) {
    const match = categories.rows.find((current) => current.id === row['id']);
    if (match) existing.categories.add(match.id);
    else if (categories.rows.some((current) => current.id !== row['id'] && current.name.trim().toLowerCase() === row['name']?.trim().toLowerCase())) addConflict('category', row['id'] ?? '', 'Another category uses this name.');
  }

  const products = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM product WHERE tenant_id = $1 AND (id = ANY($2::uuid[]) OR lower(code) = ANY($3::text[]))`,
    [tenantId, ids(rows.products), rows.products.map((row) => row['code']?.toLowerCase()).filter(Boolean)],
  );
  for (const row of rows.products) {
    const match = products.rows.find((current) => current.id === row['id']);
    if (match) existing.products.add(match.id);
    else if (products.rows.some((current) => current.id !== row['id'] && current.code.toLowerCase() === row['code']?.toLowerCase())) addConflict('product', row['id'] ?? '', 'Another clothing style uses this code.');
  }

  const variants = await client.query<{ id: string; sku: string; product_id: string; measurement_guide_id: string | null }>(
    `SELECT id, sku, product_id, measurement_guide_id FROM product_variant WHERE tenant_id = $1 AND (id = ANY($2::uuid[]) OR lower(btrim(sku)) = ANY($3::text[]))`,
    [tenantId, ids(rows.variants), rows.variants.map((row) => row['sku']?.trim().toLowerCase()).filter(Boolean)],
  );
  for (const row of rows.variants) {
    const match = variants.rows.find((current) => current.id === row['id']);
    if (match) {
      existing.variants.add(match.id);
      if (match.product_id !== row['product_id'] || match.measurement_guide_id !== (row['measurement_guide_id'] || null)) addConflict('variant', row['id'] ?? '', 'This variant ID is already linked to different inventory records.');
    }
    else if (variants.rows.some((current) => current.id !== row['id'] && current.sku.trim().toLowerCase() === row['sku']?.trim().toLowerCase())) addConflict('variant', row['id'] ?? '', 'Another variant uses this SKU.');
  }

  const pieces = await client.query<{ id: string; branch_id: string; variant_id: string; asset_code: string }>(
    `SELECT id, branch_id, variant_id, asset_code FROM physical_asset WHERE tenant_id = $1 AND (id = ANY($2::uuid[]) OR lower(btrim(asset_code)) = ANY($3::text[]))`,
    [tenantId, ids(rows.pieces), rows.pieces.map((row) => row['asset_code']?.trim().toLowerCase()).filter(Boolean)],
  );
  for (const row of rows.pieces) {
    const match = pieces.rows.find((current) => current.id === row['id']);
    if (match) {
      existing.pieces.add(match.id);
      if (match.branch_id !== branchId) addConflict('piece', row['id'] ?? '', 'This piece belongs to a different branch.');
      else if (match.variant_id !== row['variant_id']) addConflict('piece', row['id'] ?? '', 'This piece ID is already linked to a different variant.');
    } else if (pieces.rows.some((current) => current.id !== row['id'] && current.asset_code.trim().toLowerCase() === row['asset_code']?.trim().toLowerCase())) addConflict('piece', row['id'] ?? '', 'Another piece uses this asset code.');
  }

  const guides = await client.query<{ id: string; is_default: boolean; status: string }>(
    `SELECT id, is_default, status FROM measurement_guide WHERE tenant_id = $1 AND (id = ANY($2::uuid[]) OR (is_default = true AND status = 'active'))`,
    [tenantId, ids(rows.guides)],
  );
  for (const row of rows.guides) {
    const match = guides.rows.find((current) => current.id === row['id']);
    if (match) existing.guides.add(match.id);
    else if (row['is_default'] === 'true' && row['status'] === 'active' && guides.rows.some((current) => current.is_default && current.status === 'active')) addConflict('measurement_guide', row['id'] ?? '', 'A different active measurement guide is already the default.');
  }

  const images = await client.query<{ id: string; product_id: string; display_order: number }>(
    `SELECT id, product_id, display_order FROM product_image WHERE tenant_id = $1 AND (id = ANY($2::uuid[]) OR product_id = ANY($3::uuid[]))`,
    [tenantId, ids(rows.images), [...new Set(rows.images.map((row) => row['product_id']).filter(Boolean))]],
  );
  for (const row of rows.images) {
    const match = images.rows.find((current) => current.id === row['id']);
    if (match) {
      existing.images.add(match.id);
      if (match.product_id !== row['product_id']) addConflict('image', row['id'] ?? '', 'This image link belongs to a different product.');
    } else if (images.rows.some((current) => current.product_id === row['product_id'] && current.display_order === Number(row['display_order']))) addConflict('image', row['id'] ?? '', 'This product already has an image at this position.');
  }

  return {
    existing,
    counts: {
      categories_to_create: rows.categories.filter((row) => !existing.categories.has(row['id'] ?? '')).length,
      products_to_create: rows.products.filter((row) => !existing.products.has(row['id'] ?? '')).length,
      variants_to_create: rows.variants.filter((row) => !existing.variants.has(row['id'] ?? '')).length,
      pieces_to_create: rows.pieces.filter((row) => !existing.pieces.has(row['id'] ?? '')).length,
      guides_to_create: rows.guides.filter((row) => !existing.guides.has(row['id'] ?? '')).length,
      images_to_restore: rows.images.filter((row) => !existing.images.has(row['id'] ?? '')).length,
    },
    conflicts,
    conflictsTruncated,
  };
}

async function applyRestore(
  client: PoolClient,
  input: CatalogueBackupContext,
  backup: ParsedBackup,
  state: RestoreState,
  storage: ObjectStorage,
  uploadedStorageKeys: string[],
): Promise<CatalogueBackupImportPreview['counts']> {
  if (!storage.putObject || !storage.deleteObject) throw new DependencyUnavailableError('Private file storage is unavailable for restore.');
  const guideFileIds = new Map<string, string>();
  const imageFileIds = new Map<string, string>();
  for (const guide of backup.rows.guides) {
    if (state.existing.guides.has(guide['id'] ?? '')) continue;
    const media = getMedia(backup, guide['media_path']);
    guideFileIds.set(guide['id'] ?? '', await restoreMedia(client, input, media, 'measurement_guide', storage, uploadedStorageKeys));
  }
  for (const image of backup.rows.images) {
    if (state.existing.images.has(image['id'] ?? '')) continue;
    const media = getMedia(backup, image['media_path']);
    imageFileIds.set(image['id'] ?? '', await restoreMedia(client, input, media, 'catalogue_image', storage, uploadedStorageKeys));
  }

  for (const row of backup.rows.categories) if (!state.existing.categories.has(row['id'] ?? '')) {
    await client.query(`INSERT INTO category (id, tenant_id, name, status, display_order, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [row['id'], input.tenantId, row['name'], row['status'], row['display_order'], row['created_at'], row['updated_at']]);
  }
  for (const row of backup.rows.products) if (!state.existing.products.has(row['id'] ?? '')) {
    await client.query(`INSERT INTO product (id, tenant_id, category_id, code, name, description, subcategory, sizing_mode, status, created_at, updated_at) VALUES ($1,$2,NULLIF($3,'')::uuid,$4,$5,NULLIF($6,''),NULLIF($7,''),$8,$9,$10,$11)`, [row['id'], input.tenantId, row['category_id'], row['code'], row['name'], row['description'], row['subcategory'], row['sizing_mode'], row['status'], row['created_at'], row['updated_at']]);
  }
  for (const row of backup.rows.guides) if (!state.existing.guides.has(row['id'] ?? '')) {
    const fileId = guideFileIds.get(row['id'] ?? '');
    if (!fileId) throw new ValidationError('A measurement guide image is missing from the backup.');
    await client.query(`INSERT INTO measurement_guide (id, tenant_id, file_id, name, status, is_default, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6::boolean,$7,$8)`, [row['id'], input.tenantId, fileId, row['name'], row['status'], row['is_default'], row['created_at'], row['updated_at']]);
  }
  for (const row of backup.rows.variants) if (!state.existing.variants.has(row['id'] ?? '')) {
    await client.query(`INSERT INTO product_variant (id, tenant_id, product_id, sku, size_label, color_label, measurements, fit_range, measurement_unit, measurement_mode, measurement_guide_id, rental_price_minor, security_deposit_minor, currency, pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes, turnaround_minutes, status, created_at, updated_at) VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7::jsonb,NULLIF($8,''),$9,$10,NULLIF($11,'')::uuid,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, [row['id'], input.tenantId, row['product_id'], row['sku'], row['size_label'], row['color_label'], row['measurements'], row['fit_range'], row['measurement_unit'], row['measurement_mode'], row['measurement_guide_id'], row['rental_price_minor'], row['security_deposit_minor'], row['currency'], row['pricing_mode'], row['included_duration_minutes'], row['extra_day_price_minor'], row['prep_minutes'], row['turnaround_minutes'], row['status'], row['created_at'], row['updated_at']]);
  }
  for (const row of backup.rows.pieces) if (!state.existing.pieces.has(row['id'] ?? '')) {
    await client.query(`INSERT INTO physical_asset (id, tenant_id, branch_id, variant_id, asset_code, lifecycle_status, retired_by_product_archive, readiness, recovery_managed_readiness, custody_kind, condition_note, measurement_overrides, alteration_note, version, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::boolean,$8,$9::boolean,$10,NULLIF($11,''),NULLIF($12,'')::jsonb,NULLIF($13,''),$14,$15,$16)`, [row['id'], input.tenantId, input.branchId, row['variant_id'], row['asset_code'], row['lifecycle_status'], row['retired_by_product_archive'], row['readiness'], row['recovery_managed_readiness'], row['custody_kind'], row['condition_note'], row['measurement_overrides'], row['alteration_note'], row['version'], row['created_at'], row['updated_at']]);
  }
  for (const row of backup.rows.images) if (!state.existing.images.has(row['id'] ?? '')) {
    const fileId = imageFileIds.get(row['id'] ?? '');
    if (!fileId) throw new ValidationError('A product image is missing from the backup.');
    await client.query(`INSERT INTO product_image (id, tenant_id, product_id, file_id, display_order, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [row['id'], input.tenantId, row['product_id'], fileId, row['display_order'], row['created_at']]);
  }
  return state.counts;
}

async function restoreMedia(
  client: PoolClient,
  input: CatalogueBackupContext,
  media: BackupMedia,
  purpose: 'catalogue_image' | 'measurement_guide',
  storage: ObjectStorage,
  uploadedStorageKeys: string[],
): Promise<string> {
  const fileId = randomUUID();
  if (!storage.putObject) throw new DependencyUnavailableError('Private file storage is unavailable for restore.');
  const storageKey = staffUploadStorageKey(input.tenantId, purpose, fileId);
  await storage.putObject({ storageKey, contentType: media.contentType, body: media.bytes });
  uploadedStorageKeys.push(storageKey);
  const inserted = await client.query<FileObjectRow>(
    `INSERT INTO file_object (id, tenant_id, purpose, storage_key, sha256, mime_type, byte_size,
         lifecycle_status, is_private, upload_expires_at, frozen_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'accepted',true,statement_timestamp(),statement_timestamp(),statement_timestamp())
     RETURNING id, tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
               lifecycle_status, upload_expires_at, frozen_at`,
    [fileId, input.tenantId, purpose, storageKey, createHash('sha256').update(media.bytes).digest('base64'), media.contentType, media.bytes.byteLength],
  );
  const file = inserted.rows[0];
  if (!file) throw new Error('The restored catalogue image record was not created.');
  await enqueueAcceptedFileImageVariants(client, file);
  return fileId;
}

function getMedia(backup: ParsedBackup, path: string | undefined): BackupMedia {
  const media = path ? backup.media.get(path) : undefined;
  if (!media) throw new ValidationError('The inventory backup is missing a required image.');
  return media;
}

function ids(rows: Array<Record<string, string>>): string[] { return rows.map((row) => row['id']).filter((id): id is string => Boolean(id)); }

async function appendAudit(client: PoolClient, input: CatalogueBackupContext, action: string, entityId: string, summary: Record<string, unknown>): Promise<void> {
  await client.query(
    `INSERT INTO audit_event (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, 'catalogue_backup', $4, $5::jsonb, $6, statement_timestamp(), 'succeeded')`,
    [input.tenantId, input.principalId, action, entityId, JSON.stringify(summary), input.requestId],
  );
}

async function enqueueBackupCleanup(client: PoolClient, tenantId: string, fileId: string): Promise<void> {
  await client.query(
    `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
     VALUES ($1, $2, 'file.object_cleanup.requested', $3::jsonb) ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [tenantId, `file-object-cleanup:${fileId}`, JSON.stringify({ file_id: fileId })],
  );
}

async function saveCommitIdempotency(client: PoolClient, input: CatalogueBackupContext & { importId: string; idempotencyKey: string }, payloadHash: string, response: CatalogueBackupImportCommitResponse): Promise<void> {
  await finalizeTenantIdempotency(client, { tenantId: input.tenantId, principalKey: input.membershipId, operation: 'catalogue.backup.import.commit', intentKey: input.idempotencyKey, payloadHash, status: 'succeeded', responseCode: 200, safeResponse: response });
}

function assertWriteContext(input: CatalogueBackupContext): void {
  if (!input.permissionCodes.includes('assets.manage')) throw new ForbiddenError('This branch does not grant clothing management access.');
  if (input.effectiveTenantStatus === 'restricted') throw new TenantRestrictedError('This workspace is temporarily restricted.');
  if (input.effectiveTenantStatus === 'cancelled') throw new TenantCancelledError('This workspace is closed.');
}
