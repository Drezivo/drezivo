import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import {
  catalogueBackupExportStatus,
  type CatalogueBackupExportStatus,
  type PermissionCode,
  type TenantStatus,
} from '@drezivo/contracts';

import { withSystemTenantTransaction, withTenantTransaction } from '../../db/client.js';
import { db } from '../../db/client.js';
import { tenant } from '../../db/schema/tenancy.js';
import { config } from '../../config/index.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import type { ObjectStorage, StoredObjectRead } from '../../integrations/storage/object-storage.js';
import { DependencyUnavailableError, ForbiddenError, IdempotencyKeyReusedError, NotFoundError, StateConflictError, TenantCancelledError, TenantRestrictedError } from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import { claimTenantIdempotency, finalizeTenantIdempotency } from '../../shared/tenant-idempotency.js';
import { DeferredOutboxError, PermanentOutboxError, type EventHandler } from '../../worker/runner.js';
import { staffUploadStorageKey } from '../files/files.storage-keys.js';
import { FILE_OBJECT_CLEANUP_EVENT_TYPE } from '../files/file-object-cleanup.js';
import type { FileObjectRow } from '../files/files.repository.js';
import {
  createCatalogueBackup,
  MAX_BACKUP_BYTES,
  sha256Hex,
  type BackupManifest,
  type BackupMedia,
  type BackupRows,
} from './catalogue-backup.bundle.js';

export const CATALOGUE_BACKUP_EXPORT_EVENT = 'catalogue.backup.export_requested';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const exportEventPayload = z.object({ job_id: z.string().uuid() }).strict();

export interface CatalogueBackupContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  principalId: string;
  permissionCodes: PermissionCode[];
  effectiveTenantStatus: TenantStatus;
  requestId: string;
}

interface ExportJobRow {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  expires_at: Date;
  completed_at: Date | null;
  outbox_status?: string | null;
}

export interface BackupDownload {
  body: AsyncIterable<Uint8Array>;
  byteSize: number;
  filename: string;
}

export async function startCatalogueBackupExport(
  input: CatalogueBackupContext & { idempotencyKey: string },
): Promise<CatalogueBackupExportStatus> {
  assertBackupWriteContext(input);
  return withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const payloadHash = canonicalRequestHash({ branch_id: input.branchId });
    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: 'catalogue.backup.export.start',
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    if (claim.kind === 'replayed') return catalogueBackupExportStatus.parse(claim.safeResponse);
    if (claim.kind === 'key_reused') throw new IdempotencyKeyReusedError('This export idempotency key was already used for a different request.');
    if (claim.kind === 'in_progress') throw new StateConflictError('This export request is still being processed.');

    const branch = await client.query<{ id: string }>(
      'SELECT id FROM branch WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [input.tenantId, input.branchId],
    );
    if (!branch.rows[0]) throw new NotFoundError('The active branch could not be found.');

    const pending = await client.query<ExportJobRow>(
      `SELECT ej.id, ej.status, ej.expires_at, ej.completed_at, oe.status AS outbox_status
         FROM export_job ej
         LEFT JOIN outbox_event oe ON oe.tenant_id = ej.tenant_id
          AND oe.dedupe_key = 'catalogue-backup-export:' || ej.id::text
        WHERE ej.tenant_id = $1 AND ej.scope_snapshot ->> 'branch_id' = $2
          AND ej.status IN ('pending', 'running')
        ORDER BY ej.created_at DESC LIMIT 1`,
      [input.tenantId, input.branchId],
    );
    const pendingJob = pending.rows[0];
    if (pendingJob && !['dead', 'succeeded'].includes(pendingJob.outbox_status ?? '')) {
      const response = statusFor(pendingJob, null);
      await saveIdempotency(client, input, payloadHash, response, 200);
      return response;
    }
    if (pendingJob) {
      await client.query(`UPDATE export_job SET status = 'failed' WHERE tenant_id = $1 AND id = $2`, [input.tenantId, pendingJob.id]);
    }

    const completed = await client.query<ExportJobRow>(
      `SELECT id, status, expires_at, completed_at
         FROM export_job
        WHERE tenant_id = $1 AND scope_snapshot ->> 'branch_id' = $2
          AND status = 'completed' AND completed_at > statement_timestamp() - interval '7 days'
        ORDER BY completed_at DESC LIMIT 1`,
      [input.tenantId, input.branchId],
    );
    const recentSuccess = completed.rows[0];
    if (recentSuccess) {
      if (!recentSuccess.completed_at) throw new Error('A completed export is missing its completion time.');
      const response = statusFor(recentSuccess, new Date(recentSuccess.completed_at.getTime() + WEEK_MS));
      await saveIdempotency(client, input, payloadHash, response, 200);
      return response;
    }

    const id = randomUUID();
    const inserted = await client.query<ExportJobRow>(
      `INSERT INTO export_job (id, tenant_id, requested_by, scope_snapshot, status, expires_at)
       VALUES ($1, $2, $3, jsonb_build_object('branch_id', $4::text), 'pending', statement_timestamp() + interval '24 hours')
       RETURNING id, status, expires_at, completed_at`,
      [id, input.tenantId, input.membershipId, input.branchId],
    );
    const job = inserted.rows[0];
    if (!job) throw new Error('The catalogue backup job was not created.');
    await client.query(
      `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [input.tenantId, `catalogue-backup-export:${id}`, CATALOGUE_BACKUP_EXPORT_EVENT, JSON.stringify({ job_id: id })],
    );
    await appendBackupAudit(client, input, 'catalogue.backup.export_requested', id, { branch_id: input.branchId });
    const response = statusFor(job, null);
    await saveIdempotency(client, input, payloadHash, response, 200);
    return response;
  });
}

export async function readCatalogueBackupExportStatus(
  input: CatalogueBackupContext & { jobId: string },
): Promise<CatalogueBackupExportStatus> {
  assertBackupReadContext(input);
  const result = await withTenantTransaction(input.tenantId, input.principalId, (client) => client.query<ExportJobRow & { available_at: Date | null }>(
    `SELECT ej.id,
            CASE WHEN ej.status IN ('pending', 'running') AND oe.status IN ('dead', 'succeeded') THEN 'failed' ELSE ej.status END AS status,
            ej.expires_at, ej.completed_at,
            (SELECT CASE WHEN completed_at + interval '7 days' > statement_timestamp()
                         THEN completed_at + interval '7 days' ELSE NULL END
               FROM export_job recent
              WHERE recent.tenant_id = ej.tenant_id
                AND recent.scope_snapshot ->> 'branch_id' = $3
                AND recent.status = 'completed'
              ORDER BY completed_at DESC LIMIT 1) AS available_at
       FROM export_job ej
       LEFT JOIN outbox_event oe ON oe.tenant_id = ej.tenant_id
        AND oe.dedupe_key = 'catalogue-backup-export:' || ej.id::text
      WHERE ej.tenant_id = $1 AND ej.id = $2
        AND ej.scope_snapshot ->> 'branch_id' = $3
      LIMIT 1`,
    [input.tenantId, input.jobId, input.branchId],
  ));
  const row = result.rows[0];
  if (!row) throw new NotFoundError('The catalogue backup export could not be found.');
  return statusFor(row, row.available_at);
}

export async function readCatalogueBackupExport(
  input: CatalogueBackupContext & { jobId: string },
  storage: ObjectStorage = objectStorage,
): Promise<BackupDownload> {
  assertBackupReadContext(input);
  const file = await withTenantTransaction(input.tenantId, input.principalId, async (client) => {
    const result = await client.query<FileObjectRow & { completed_at: Date; expires_at: Date }>(
      `SELECT f.id, f.tenant_id, f.purpose, f.storage_key, f.version_id, f.sha256, f.mime_type,
              f.byte_size, f.lifecycle_status, f.upload_expires_at, f.frozen_at,
              ej.completed_at, ej.expires_at
         FROM export_job ej
         JOIN file_object f ON f.tenant_id = ej.tenant_id AND f.id = ej.result_file_id
        WHERE ej.tenant_id = $1 AND ej.id = $2
          AND ej.scope_snapshot ->> 'branch_id' = $3
          AND ej.status = 'completed' AND ej.expires_at > statement_timestamp()
          AND f.purpose = 'catalogue_backup' AND f.lifecycle_status = 'accepted'
          AND f.is_private = true AND f.frozen_at IS NOT NULL
        LIMIT 1`,
      [input.tenantId, input.jobId, input.branchId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('This export is not ready or has expired.');
    await appendBackupAudit(client, input, 'catalogue.backup.downloaded', input.jobId, { file_id: row.id });
    return row;
  });
  const object = await storage.readObject({ storageKey: file.storage_key, versionId: file.version_id });
  if (!object || (object.contentLength !== null && object.contentLength !== file.byte_size)) throw new DependencyUnavailableError('The catalogue backup is temporarily unavailable.');
  const body = boundObject(object, file.byte_size, MAX_BACKUP_BYTES);
  return { body, byteSize: file.byte_size, filename: `drezivo-inventory-${file.completed_at.toISOString().slice(0, 10)}.zip` };
}

export function createCatalogueBackupExportHandler(storage: ObjectStorage = objectStorage): EventHandler {
  return async (event) => {
    const parsed = exportEventPayload.safeParse(event.payload);
    if (!parsed.success) throw new PermanentOutboxError('Catalogue backup event payload is invalid.');
    const claim = await withSystemTenantTransaction(event.tenant_id, 'catalogue-backup-export', async (client) => {
      const result = await client.query<{ id: string; branch_id: string }>(
        `UPDATE export_job SET status = 'running', updated_at = statement_timestamp()
          WHERE tenant_id = $1 AND id = $2
            AND (status = 'pending' OR (status = 'running' AND updated_at < statement_timestamp() - interval '1 hour'))
        RETURNING id, scope_snapshot ->> 'branch_id' AS branch_id`,
        [event.tenant_id, parsed.data.job_id],
      );
      if (result.rows[0]?.branch_id) return { job: result.rows[0], running: false };
      const current = await client.query<{ status: string }>(
        `SELECT status FROM export_job WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [event.tenant_id, parsed.data.job_id],
      );
      return { job: null, running: current.rows[0]?.status === 'running' };
    });
    if (claim.running) throw new DeferredOutboxError('The catalogue backup is already running.', 60);
    const job = claim.job;
    if (!job?.branch_id) return;
    let storageKey: string | null = null;
    let objectCreated = false;
    try {
      const snapshot = await readExportSnapshot(event.tenant_id, job.branch_id, storage);
      if (!storage.putObject) throw new Error('Object storage cannot create catalogue backups.');
      const fileId = job.id;
      storageKey = staffUploadStorageKey(event.tenant_id, 'catalogue_backup', fileId);
      let zip: Uint8Array;
      try {
        zip = createCatalogueBackup(snapshot);
      } catch {
        await withSystemTenantTransaction(event.tenant_id, 'catalogue-backup-export', (client) =>
          client.query(`UPDATE export_job SET status = 'failed', updated_at = statement_timestamp() WHERE tenant_id = $1 AND id = $2 AND status = 'running'`, [event.tenant_id, job.id]).then(() => undefined),
        );
        throw new PermanentOutboxError('The inventory exceeds the supported backup size or contains invalid catalogue media.');
      }
      const sha256 = createHash('sha256').update(zip).digest('base64');
      await storage.putObject({ storageKey, contentType: 'application/zip', body: zip });
      objectCreated = true;
      const completed = await withSystemTenantTransaction(event.tenant_id, 'catalogue-backup-export', async (client) => {
        const locked = await client.query<{ id: string }>(
          `SELECT id FROM export_job WHERE tenant_id = $1 AND id = $2 AND status = 'running' FOR UPDATE`,
          [event.tenant_id, job.id],
        );
        if (!locked.rows[0]) return false;
        await client.query(
          `INSERT INTO file_object
             (id, tenant_id, purpose, storage_key, sha256, mime_type, byte_size,
              lifecycle_status, is_private, upload_expires_at, frozen_at, created_at)
           VALUES ($1, $2, 'catalogue_backup', $3, $4, 'application/zip', $5,
                   'accepted', true, statement_timestamp() + interval '7 days', statement_timestamp(), statement_timestamp())`,
          [fileId, event.tenant_id, storageKey, sha256, zip.byteLength],
        );
        const updated = await client.query(
          `UPDATE export_job SET status = 'completed', result_file_id = $3,
                 expires_at = statement_timestamp() + interval '7 days', completed_at = statement_timestamp(), updated_at = statement_timestamp()
            WHERE tenant_id = $1 AND id = $2 AND status = 'running'`,
          [event.tenant_id, job.id, fileId],
        );
        if (updated.rowCount !== 1) throw new Error('The catalogue backup job changed before completion.');
        await client.query(
          `INSERT INTO audit_event (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
           VALUES ($1, 'system', 'catalogue-backup-export', 'catalogue.backup.exported', 'export_job', $2,
                   $3::jsonb, $4, statement_timestamp(), 'succeeded')`,
          [event.tenant_id, job.id, JSON.stringify({ branch_id: job.branch_id, byte_size: zip.byteLength, sha256: sha256Hex(zip), counts: snapshot.manifest.counts }), 'worker'],
        );
        return true;
      });
      if (!completed) {
        await storage.deleteObject?.(storageKey).catch(() => undefined);
        objectCreated = false;
      }
    } catch (error) {
      const reset = await withSystemTenantTransaction(event.tenant_id, 'catalogue-backup-export', (client) =>
        client.query(`UPDATE export_job SET status = 'pending', updated_at = statement_timestamp() WHERE tenant_id = $1 AND id = $2 AND status = 'running' RETURNING id`, [event.tenant_id, job.id]),
      ).catch(() => ({ rowCount: 0 }));
      // A lost COMMIT acknowledgement must not delete the ZIP a completed job now references.
      if (reset.rowCount && objectCreated && storageKey) await storage.deleteObject?.(storageKey).catch(() => undefined);
      throw error;
    }
  };
}

/** Expires restore previews and queues private backup objects only after their reference window ends. */
export async function sweepCatalogueBackupArtifactsForAllTenants(): Promise<{ expiredPreviews: number; failedExports: number; cleanupQueued: number }> {
  const tenants = await db.select({ id: tenant.id }).from(tenant);
  const totals = { expiredPreviews: 0, failedExports: 0, cleanupQueued: 0 };
  for (const { id: tenantId } of tenants) {
    const result = await withSystemTenantTransaction(tenantId, 'catalogue-backup-cleanup', async (client) => {
      const previews = await client.query(
        `UPDATE import_job SET status = 'failed', completed_at = COALESCE(completed_at, statement_timestamp()), updated_at = statement_timestamp()
          WHERE tenant_id = $1 AND status = 'previewed' AND created_at <= statement_timestamp() - interval '24 hours'`,
        [tenantId],
      );
      const exports = await client.query(
        `UPDATE export_job ej SET status = 'failed', updated_at = statement_timestamp()
          WHERE ej.tenant_id = $1 AND ej.status IN ('pending', 'running')
            AND (ej.expires_at <= statement_timestamp() OR EXISTS (
              SELECT 1 FROM outbox_event oe WHERE oe.tenant_id = ej.tenant_id
                AND oe.dedupe_key = 'catalogue-backup-export:' || ej.id::text AND oe.status = 'dead'
            ))`,
        [tenantId],
      );
      if (!config.FILE_OBJECT_CLEANUP_ENABLED) return { previews: previews.rowCount ?? 0, exports: exports.rowCount ?? 0, queued: 0 };
      const cleanup = await client.query(
        `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
         SELECT f.tenant_id, 'file-object-cleanup:' || f.id::text, $2, jsonb_build_object('file_id', f.id)
           FROM file_object f
          WHERE f.tenant_id = $1 AND f.purpose = 'catalogue_backup'
            AND f.lifecycle_status = 'accepted' AND f.created_at <= statement_timestamp() - interval '24 hours'
            AND NOT EXISTS (
              SELECT 1 FROM import_job ij WHERE ij.tenant_id = f.tenant_id AND ij.file_id = f.id
                AND ij.status = 'previewed' AND ij.created_at > statement_timestamp() - interval '24 hours'
            )
            AND NOT EXISTS (
              SELECT 1 FROM export_job ej WHERE ej.tenant_id = f.tenant_id AND ej.result_file_id = f.id
                AND ej.status = 'completed' AND ej.expires_at > statement_timestamp()
            )
         ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
        [tenantId, FILE_OBJECT_CLEANUP_EVENT_TYPE],
      );
      return { previews: previews.rowCount ?? 0, exports: exports.rowCount ?? 0, queued: cleanup.rowCount ?? 0 };
    });
    totals.expiredPreviews += result.previews;
    totals.failedExports += result.exports;
    totals.cleanupQueued += result.queued;
  }
  return totals;
}

async function readExportSnapshot(
  tenantId: string,
  branchId: string,
  storage: ObjectStorage,
): Promise<{ manifest: BackupManifest; rows: BackupRows; media: BackupMedia[] }> {
  const data = await withSystemTenantTransaction(tenantId, 'catalogue-backup-export', async (client) => {
    const [pieces, products, categories] = await Promise.all([
      client.query<Record<string, string>>(`SELECT pa.id, pa.branch_id, pa.variant_id, pa.asset_code, pa.lifecycle_status,
                           pa.retired_by_product_archive, pa.readiness, pa.recovery_managed_readiness,
                           pa.custody_kind, pa.condition_note, pa.measurement_overrides, pa.alteration_note,
                           pa.version, pa.created_at, pa.updated_at
                      FROM physical_asset pa
                      JOIN product_variant pv ON pv.tenant_id = pa.tenant_id AND pv.id = pa.variant_id
                     WHERE pa.tenant_id = $1 AND pa.branch_id = $2 ORDER BY pa.id`, [tenantId, branchId]),
      client.query<Record<string, string>>(`SELECT DISTINCT p.id, p.category_id, p.code, p.name, p.description, p.subcategory,
                           p.sizing_mode, p.status, p.created_at, p.updated_at
                      FROM product p JOIN product_variant pv ON pv.tenant_id = p.tenant_id AND pv.product_id = p.id
                      JOIN physical_asset pa ON pa.tenant_id = pv.tenant_id AND pa.variant_id = pv.id
                     WHERE pa.tenant_id = $1 AND pa.branch_id = $2 ORDER BY p.id`, [tenantId, branchId]),
      client.query<Record<string, string>>(`SELECT DISTINCT c.id, c.name, c.status, c.display_order, c.created_at, c.updated_at
                      FROM category c JOIN product p ON p.tenant_id = c.tenant_id AND p.category_id = c.id
                      JOIN product_variant pv ON pv.tenant_id = p.tenant_id AND pv.product_id = p.id
                      JOIN physical_asset pa ON pa.tenant_id = pv.tenant_id AND pa.variant_id = pv.id
                     WHERE pa.tenant_id = $1 AND pa.branch_id = $2 ORDER BY c.id`, [tenantId, branchId]),
    ]);
    const productIds = products.rows.map((row) => row.id);
    const allVariants = await client.query<Record<string, string>>(
      `SELECT id, product_id, sku, size_label, color_label, measurements, fit_range, measurement_unit,
              measurement_mode, measurement_guide_id, rental_price_minor, security_deposit_minor,
              currency, pricing_mode, included_duration_minutes, extra_day_price_minor, prep_minutes,
              turnaround_minutes, status, created_at, updated_at
         FROM product_variant WHERE tenant_id = $1 AND product_id = ANY($2::uuid[]) ORDER BY id`, [tenantId, productIds]);
    const guideIds = [...new Set(allVariants.rows.map((row) => row.measurement_guide_id).filter((id): id is string => typeof id === 'string'))];
    const allGuides = await client.query<Record<string, string>>(
      `SELECT mg.id, mg.name, mg.status, mg.is_default, mg.created_at, mg.updated_at, mg.file_id,
              f.storage_key, f.version_id, f.mime_type, f.byte_size, f.sha256, f.lifecycle_status, f.frozen_at, f.is_private
         FROM measurement_guide mg LEFT JOIN file_object f ON f.tenant_id = mg.tenant_id AND f.id = mg.file_id
        WHERE mg.tenant_id = $1 AND mg.id = ANY($2::uuid[]) ORDER BY mg.id`, [tenantId, guideIds]);
    const allImages = await client.query<Record<string, string>>(
      `SELECT pi.id, pi.product_id, pi.display_order, pi.created_at, pi.file_id,
              f.storage_key, f.version_id, f.mime_type, f.byte_size, f.sha256, f.lifecycle_status, f.frozen_at, f.is_private
         FROM product_image pi LEFT JOIN file_object f ON f.tenant_id = pi.tenant_id AND f.id = pi.file_id
        WHERE pi.tenant_id = $1 AND pi.product_id = ANY($2::uuid[])
        ORDER BY pi.product_id, pi.display_order`, [tenantId, productIds]);
    return { pieces: pieces.rows, products: products.rows, variants: allVariants.rows, categories: categories.rows, guides: allGuides.rows, images: allImages.rows };
  });
  const media: BackupMedia[] = [];
  const guideRows: Array<Record<string, unknown>> = [];
  for (const row of data.guides) {
    const bytes = await readVerifiedMedia(storage, row);
    const path = mediaPath('measurement-guides', String(row.id), String(row.mime_type));
    media.push({ path, contentType: row.mime_type as BackupMedia['contentType'], sha256: sha256Hex(bytes), bytes });
    guideRows.push({ id: row.id, name: row.name, status: row.status, is_default: row.is_default, created_at: row.created_at, updated_at: row.updated_at, media_path: path, media_content_type: row.mime_type, media_sha256: sha256Hex(bytes) });
  }
  const imageRows: Array<Record<string, unknown>> = [];
  for (const row of data.images) {
    const bytes = await readVerifiedMedia(storage, row);
    const path = mediaPath('product-images', String(row.id), String(row.mime_type));
    media.push({ path, contentType: row.mime_type as BackupMedia['contentType'], sha256: sha256Hex(bytes), bytes });
    imageRows.push({ id: row.id, product_id: row.product_id, display_order: row.display_order, created_at: row.created_at, media_path: path, media_content_type: row.mime_type, media_sha256: sha256Hex(bytes) });
  }
  if (media.reduce((total, item) => total + item.bytes.byteLength, 0) > MAX_BACKUP_BYTES) throw new Error('Catalogue backup exceeds the supported media size limit.');
  const rows: BackupRows = {
    categories: data.categories,
    products: data.products,
    variants: data.variants,
    pieces: data.pieces,
    guides: guideRows as Array<Record<string, string>>,
    images: imageRows as Array<Record<string, string>>,
  };
  const counts = { categories: rows.categories.length, products: rows.products.length, variants: rows.variants.length, pieces: rows.pieces.length, measurement_guides: rows.guides.length, product_images: rows.images.length };
  return {
    manifest: { format: 'drezivo-inventory-backup' as const, version: 1 as const, tenant_id: tenantId, branch_id: branchId, exported_at: new Date().toISOString(), counts },
    rows,
    media,
  };
}

async function readVerifiedMedia(storage: ObjectStorage, row: Record<string, unknown>): Promise<Uint8Array> {
  if (!storage.readObject || row['lifecycle_status'] !== 'accepted' || row['is_private'] !== true || !row['frozen_at'] || !isImageType(row['mime_type']) || typeof row['byte_size'] !== 'number' || row['byte_size'] > 10 * 1024 * 1024 || typeof row['sha256'] !== 'string' || typeof row['storage_key'] !== 'string') throw new Error('Catalogue media metadata is invalid.');
  const object = await storage.readObject({ storageKey: String(row['storage_key']), versionId: typeof row['version_id'] === 'string' ? row['version_id'] : null });
  if (!object || (object.contentLength !== null && object.contentLength !== row['byte_size'])) throw new Error('Catalogue media is unavailable.');
  const bytes = await readBounded(object, row['byte_size'], 10 * 1024 * 1024);
  if (createHash('sha256').update(bytes).digest('base64') !== row['sha256']) throw new Error('Catalogue media checksum verification failed.');
  return bytes;
}

function mediaPath(folder: 'product-images' | 'measurement-guides', id: string, contentType: string): string {
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : null;
  if (!extension) throw new Error('Catalogue media type is invalid.');
  return `media/${folder}/${id}.${extension}`;
}

function isImageType(value: unknown): value is BackupMedia['contentType'] { return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'; }

async function readBounded(object: StoredObjectRead, expected: number, maximum: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > maximum) throw new Error('Stored catalogue media size is invalid.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of object.body) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > expected - total) throw new Error('Stored catalogue media exceeded its verified size.');
    chunks.push(chunk); total += chunk.byteLength;
  }
  if (total !== expected) throw new Error('Stored catalogue media size did not match its record.');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function boundObject(object: StoredObjectRead, expected: number, maximum: number): AsyncIterable<Uint8Array> {
  return (async function* () {
    if (!Number.isSafeInteger(expected) || expected < 1 || expected > maximum) throw new DependencyUnavailableError('Stored catalogue backup metadata is invalid.');
    let total = 0;
    for await (const chunk of object.body) { if (!(chunk instanceof Uint8Array) || chunk.byteLength > expected - total) throw new Error('Stored catalogue backup exceeded its verified size.'); total += chunk.byteLength; yield chunk; }
    if (total !== expected) throw new Error('Stored catalogue backup size did not match its record.');
  })();
}

function statusFor(row: ExportJobRow, availableAt: Date | null): CatalogueBackupExportStatus {
  return catalogueBackupExportStatus.parse({
    job_id: row.id,
    status: ['dead', 'succeeded'].includes(row.outbox_status ?? '') && (row.status === 'pending' || row.status === 'running') ? 'failed' : row.status,
    available_at: availableAt?.toISOString() ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
  });
}

async function saveIdempotency(client: PoolClient, input: CatalogueBackupContext & { idempotencyKey: string }, payloadHash: string, response: CatalogueBackupExportStatus, responseCode: number): Promise<void> {
  await finalizeTenantIdempotency(client, {
    tenantId: input.tenantId, principalKey: input.membershipId, operation: 'catalogue.backup.export.start',
    intentKey: input.idempotencyKey, payloadHash, status: 'succeeded', responseCode, safeResponse: response,
  });
}

function assertBackupWriteContext(input: CatalogueBackupContext): void {
  assertBackupReadContext(input);
  if (input.effectiveTenantStatus === 'restricted') throw new TenantRestrictedError('This workspace is temporarily restricted.');
  if (input.effectiveTenantStatus === 'cancelled') throw new TenantCancelledError('This workspace is closed.');
}

function assertBackupReadContext(input: CatalogueBackupContext): void {
  if (!input.permissionCodes.includes('assets.manage')) throw new ForbiddenError('This branch does not grant clothing management access.');
}

async function appendBackupAudit(client: PoolClient, input: CatalogueBackupContext, action: string, entityId: string, summary: Record<string, unknown>): Promise<void> {
  await client.query(
    `INSERT INTO audit_event (tenant_id, actor_kind, actor_key, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, 'catalogue_backup', $4, $5::jsonb, $6, statement_timestamp(), 'succeeded')`,
    [input.tenantId, input.principalId, action, entityId, JSON.stringify(summary), input.requestId],
  );
}
