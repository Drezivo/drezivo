import type { PoolClient } from 'pg';

export interface FileObjectRow {
  id: string;
  tenant_id: string;
  purpose:
    | 'catalogue_image'
    | 'measurement_guide'
    | 'payment_receipt'
    | 'verification_document'
    | 'storefront_asset'
    | 'export_result'
    | 'subscription_payment_proof'
    | 'payment_method_material';
  storage_key: string;
  version_id: string | null;
  sha256: string | null;
  mime_type: string;
  byte_size: number;
  lifecycle_status: 'pending_upload' | 'uploaded' | 'scanning' | 'accepted' | 'rejected' | 'deletion_pending' | 'deleted';
  upload_expires_at: Date;
  frozen_at: Date | null;
}

export type ImageVariantSourceRow = Pick<
  FileObjectRow,
  | 'id'
  | 'tenant_id'
  | 'purpose'
  | 'storage_key'
  | 'version_id'
  | 'sha256'
  | 'mime_type'
  | 'byte_size'
  | 'lifecycle_status'
  | 'frozen_at'
>;

export type StaffReadableFileObjectRow = FileObjectRow;

export async function insertPendingFile(
  client: PoolClient,
  input: {
    id: string;
    tenantId: string;
    purpose: FileObjectRow['purpose'];
    storageKey: string;
    sha256: string;
    mimeType: string;
    byteSize: number;
    uploadExpiresAt: Date;
  },
): Promise<FileObjectRow> {
  const result = await client.query<FileObjectRow>(
    `INSERT INTO file_object
       (id, tenant_id, purpose, storage_key, sha256, mime_type, byte_size,
        lifecycle_status, is_private, upload_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_upload', true, $8, now())
     RETURNING id, tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
               lifecycle_status, upload_expires_at, frozen_at`,
    [
      input.id,
      input.tenantId,
      input.purpose,
      input.storageKey,
      input.sha256,
      input.mimeType,
      input.byteSize,
      input.uploadExpiresAt,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('File authorization insert did not return a row.');
  return row;
}

export async function readFileObject(
  client: PoolClient,
  tenantId: string,
  fileId: string,
  options?: { forUpdate?: boolean },
): Promise<FileObjectRow | null> {
  const result = await client.query<FileObjectRow>(
    `SELECT id, tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, upload_expires_at, frozen_at
       FROM file_object
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1${options?.forUpdate ? ' FOR UPDATE' : ''}`,
    [tenantId, fileId],
  );
  return result.rows[0] ?? null;
}

/** Worker-only, tenant-scoped source lookup; optional row lock serializes derivative writes with cleanup. */
export async function readAcceptedImageVariantSource(
  client: PoolClient,
  tenantId: string,
  fileId: string,
  forUpdate = false,
): Promise<ImageVariantSourceRow | null> {
  const result = await client.query<ImageVariantSourceRow>(
    `SELECT id, tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
            lifecycle_status, frozen_at
       FROM file_object
      WHERE tenant_id = $1 AND id = $2::uuid
        AND lifecycle_status = 'accepted' AND frozen_at IS NOT NULL
        AND purpose IN ('catalogue_image', 'measurement_guide', 'storefront_asset', 'payment_method_material')
        AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [tenantId, fileId],
  );
  return result.rows[0] ?? null;
}

/** Purpose, current relationship, tenant, and branch checks are part of this single read query. */
export async function readStaffFileObject(
  client: PoolClient,
  input: { tenantId: string; branchId: string; fileId: string; permissionCodes: string[] },
): Promise<StaffReadableFileObjectRow | null> {
  const result = await client.query<StaffReadableFileObjectRow>(
    `SELECT f.id, f.tenant_id, f.purpose, f.storage_key, f.version_id, f.sha256, f.mime_type, f.byte_size,
            f.lifecycle_status, f.upload_expires_at, f.frozen_at
       FROM file_object f
      WHERE f.tenant_id = $1 AND f.id = $2::uuid
        AND f.lifecycle_status = 'accepted' AND f.frozen_at IS NOT NULL
        AND CASE f.purpose
          WHEN 'catalogue_image' THEN
            $4::text[] && ARRAY['assets.manage', 'reservations.manage']::text[]
            AND EXISTS (SELECT 1 FROM product_image pi WHERE pi.tenant_id = f.tenant_id AND pi.file_id = f.id)
          WHEN 'measurement_guide' THEN
            $4::text[] @> ARRAY['assets.manage']::text[]
            AND EXISTS (
              SELECT 1 FROM measurement_guide mg
               WHERE mg.tenant_id = f.tenant_id AND mg.file_id = f.id AND mg.status = 'active'
            )
          WHEN 'storefront_asset' THEN
            (
              $4::text[] @> ARRAY['policies.manage']::text[]
              AND (
                EXISTS (
                  SELECT 1 FROM storefront s
                   WHERE s.tenant_id = f.tenant_id
                     AND (
                       s.branding ->> 'logo_file_id' = f.id::text
                       OR s.branding ->> 'cover_file_id' = f.id::text
                       OR s.content #>> '{hero,image_file_id}' = f.id::text
                       OR s.content #>> '{about,image_file_id}' = f.id::text
                     )
                )
                OR EXISTS (
                  SELECT 1 FROM policy_snapshot ps
                   WHERE ps.tenant_id = f.tenant_id
                     AND ps.effective_at <= statement_timestamp()
                     AND ps.rental_rules ->> 'format' = 'images'
                     AND coalesce(ps.rental_rules -> 'image_file_ids', '[]'::jsonb) ? f.id::text
                     AND ps.version = (
                       SELECT max(current_ps.version) FROM policy_snapshot current_ps
                        WHERE current_ps.tenant_id = ps.tenant_id
                          AND current_ps.storefront_id = ps.storefront_id
                          AND current_ps.effective_at <= statement_timestamp()
                     )
                )
              )
            )
            OR (
              $4::text[] @> ARRAY['payments.manage']::text[]
              AND EXISTS (SELECT 1 FROM payment_method pm WHERE pm.tenant_id = f.tenant_id AND pm.qr_file_id = f.id)
            )
          WHEN 'payment_method_material' THEN
            $4::text[] @> ARRAY['payments.manage']::text[]
            AND EXISTS (
              SELECT 1 FROM payment_method pm
               WHERE pm.tenant_id = f.tenant_id AND pm.material_file_id = f.id
            )
          WHEN 'payment_receipt' THEN
            $4::text[] @> ARRAY['reservations.manage', 'payments.manage', 'evidence.verify']::text[]
            AND EXISTS (
              SELECT 1 FROM payment_receipt pr
                JOIN payment p ON p.tenant_id = pr.tenant_id AND p.id = pr.payment_id
                JOIN reservation r ON r.tenant_id = p.tenant_id AND r.id = p.reservation_id
               WHERE pr.tenant_id = f.tenant_id AND pr.file_id = f.id
                 AND r.branch_id = $3::uuid
            )
          ELSE FALSE
        END
      LIMIT 1`,
    [input.tenantId, input.fileId, input.branchId, input.permissionCodes],
  );
  return result.rows[0] ?? null;
}

export async function acceptFileObject(
  client: PoolClient,
  input: {
    tenantId: string;
    fileId: string;
    versionId: string | null;
  },
): Promise<FileObjectRow | null> {
  const result = await client.query<FileObjectRow>(
    `UPDATE file_object
        SET lifecycle_status = 'accepted',
            version_id = COALESCE($3, version_id),
            frozen_at = now()
      WHERE tenant_id = $1 AND id = $2
        AND lifecycle_status IN ('pending_upload', 'uploaded', 'scanning')
      RETURNING id, tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
                lifecycle_status, upload_expires_at, frozen_at`,
    [input.tenantId, input.fileId, input.versionId],
  );
  return result.rows[0] ?? null;
}

export async function rejectFileObject(
  client: PoolClient,
  tenantId: string,
  fileId: string,
): Promise<FileObjectRow | null> {
  const result = await client.query<FileObjectRow>(
    `UPDATE file_object
        SET lifecycle_status = 'rejected'
      WHERE tenant_id = $1 AND id = $2
        AND lifecycle_status IN ('pending_upload', 'uploaded', 'scanning')
      RETURNING id, tenant_id, purpose, storage_key, version_id, sha256, mime_type, byte_size,
                lifecycle_status, upload_expires_at, frozen_at`,
    [tenantId, fileId],
  );
  return result.rows[0] ?? null;
}

export async function appendFileAuditEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action: string;
    fileId: string;
    redactedSummary: Record<string, unknown>;
    requestId: string;
    outcome?: 'succeeded' | 'failed';
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, 'file_object', $4, $5::jsonb, $6, now(), $7)`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      input.fileId,
      JSON.stringify(input.redactedSummary),
      input.requestId,
      input.outcome ?? 'succeeded',
    ],
  );
}
