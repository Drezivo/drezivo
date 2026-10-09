import type { PoolClient } from 'pg';

import { PermanentOutboxError, DeferredOutboxError } from '../../worker/runner.js';

export interface FileObjectCleanupTarget {
  storage_key: string;
  lifecycle_status: 'accepted' | 'deletion_pending' | 'deleted';
}

export type FileObjectCleanupPreparation =
  | { kind: 'delete'; storageKey: string }
  | { kind: 'complete' };

const REFERENCED_RETRY_SECONDS = 24 * 60 * 60;

/** Queues only assets displaced by a replacement; a clear-only edit is intentionally ignored. */
export async function enqueueReplacedFileObjectCleanup(
  client: PoolClient,
  tenantId: string,
  previousFileId: string | null,
  replacementFileId: string | null,
): Promise<void> {
  if (!previousFileId || !replacementFileId || previousFileId === replacementFileId) return;
  await enqueueFileObjectCleanupCandidates(client, tenantId, [previousFileId]);
}

/** For set replacements, do nothing when the request only removes or reorders existing files. */
export async function enqueueReplacedFileObjectSetCleanup(
  client: PoolClient,
  tenantId: string,
  previousFileIds: readonly string[],
  replacementFileIds: readonly string[],
): Promise<void> {
  const previous = new Set(previousFileIds);
  const replacement = new Set(replacementFileIds);
  if (![...replacement].some((fileId) => !previous.has(fileId))) return;
  await enqueueFileObjectCleanupCandidates(
    client,
    tenantId,
    [...previous].filter((fileId) => !replacement.has(fileId)),
  );
}

async function enqueueFileObjectCleanupCandidates(
  client: PoolClient,
  tenantId: string,
  fileIds: readonly string[],
): Promise<void> {
  for (const fileId of fileIds) {
    await client.query(
      `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
       VALUES ($1, $2, 'file.object_cleanup.requested', $3::jsonb)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      [tenantId, `file-object-cleanup:${fileId}`, JSON.stringify({ file_id: fileId })],
    );
  }
}

/** Locks the file across reference validation and the deletion-pending transition. */
export async function prepareFileObjectCleanup(
  client: PoolClient,
  tenantId: string,
  fileId: string,
): Promise<FileObjectCleanupPreparation> {
  const target = await client.query<FileObjectCleanupTarget & {
    legal_hold: boolean;
    retention_seconds: number;
  }>(
    `SELECT storage_key, lifecycle_status, legal_hold,
            CASE WHEN retention_until > statement_timestamp()
              THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (retention_until - statement_timestamp()))))::int
              ELSE 0
            END AS retention_seconds
       FROM file_object
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1
      FOR UPDATE`,
    [tenantId, fileId],
  );
  const row = target.rows[0];
  if (!row) throw new PermanentOutboxError('Cleanup target file is unavailable.');
  if (row.lifecycle_status === 'deleted') return { kind: 'complete' };
  if (row.lifecycle_status !== 'accepted' && row.lifecycle_status !== 'deletion_pending') {
    throw new PermanentOutboxError('Cleanup target file is not in a deletable state.');
  }

  const referenceCheck = await client.query<{ has_references: boolean }>(
    'SELECT public.file_object_has_references($1::uuid, $2::uuid) AS has_references',
    [tenantId, fileId],
  );
  if (referenceCheck.rows[0]?.has_references !== false) {
    throw new DeferredOutboxError('File remains referenced; cleanup is deferred.', REFERENCED_RETRY_SECONDS);
  }
  if (row.legal_hold) {
    throw new DeferredOutboxError('File is protected by a legal hold; cleanup is deferred.', REFERENCED_RETRY_SECONDS);
  }
  if (row.retention_seconds > 0) {
    throw new DeferredOutboxError('File retention is still active; cleanup is deferred.', row.retention_seconds);
  }

  if (row.lifecycle_status === 'accepted') {
    const transition = await client.query<{ storage_key: string }>(
      `UPDATE file_object
          SET lifecycle_status = 'deletion_pending'
        WHERE tenant_id = $1 AND id = $2 AND lifecycle_status = 'accepted'
        RETURNING storage_key`,
      [tenantId, fileId],
    );
    const transitioned = transition.rows[0];
    if (!transitioned) throw new Error('File cleanup state changed before deletion was prepared.');
    return { kind: 'delete', storageKey: transitioned.storage_key };
  }

  return { kind: 'delete', storageKey: row.storage_key };
}

/** Completes the tombstone only after object storage confirms deletion or absence. */
export async function markFileObjectDeleted(
  client: PoolClient,
  tenantId: string,
  fileId: string,
): Promise<void> {
  const result = await client.query(
    `UPDATE file_object
        SET lifecycle_status = 'deleted', deleted_at = COALESCE(deleted_at, now())
      WHERE tenant_id = $1 AND id = $2 AND lifecycle_status = 'deletion_pending'`,
    [tenantId, fileId],
  );
  if (result.rowCount !== 1) throw new Error('File cleanup tombstone could not be finalized.');
}
