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
  lifecycle_status: 'pending_upload' | 'uploaded' | 'scanning' | 'accepted' | 'rejected' | 'deleted';
  upload_expires_at: Date;
  frozen_at: Date | null;
}

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
