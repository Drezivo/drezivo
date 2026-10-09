import { z } from 'zod';
import type { PoolClient } from 'pg';

import { withSystemTenantTransaction } from '../../db/client.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';
import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { DeferredOutboxError, PermanentOutboxError, type EventHandler } from '../../worker/runner.js';
import { markFileObjectDeleted, prepareFileObjectCleanup } from './file-object-cleanup.repository.js';

export const FILE_OBJECT_CLEANUP_EVENT_TYPE = 'file.object_cleanup.requested';

const cleanupPayload = z.object({ file_id: z.string().uuid() }).strict();

type SystemTenantTransaction = <T>(
  tenantId: string,
  systemKey: string,
  callback: (client: PoolClient) => Promise<T>,
) => Promise<T>;

/** Performs physical deletion only after the database reference barrier commits. */
export function createFileObjectCleanupHandler(
  storage: Pick<ObjectStorage, 'deleteObject'> = objectStorage,
  transaction: SystemTenantTransaction = withSystemTenantTransaction,
): EventHandler {
  return async (row) => {
    const parsed = cleanupPayload.safeParse(row.payload);
    if (!parsed.success) throw new PermanentOutboxError('Cleanup event payload is invalid.');
    const deleteObject = storage.deleteObject?.bind(storage);
    if (!deleteObject) {
      throw new DeferredOutboxError('Object storage provider does not support deletion; cleanup is deferred.', 60 * 60);
    }

    const prepared = await transaction(row.tenant_id, 'file-object-cleanup', (client) =>
      prepareFileObjectCleanup(client, row.tenant_id, parsed.data.file_id),
    );
    if (prepared.kind === 'complete') return;

    try {
      await deleteObject(prepared.storageKey);
    } catch {
      // Adapter errors can contain provider details. Keep the outbox diagnostic safe and stable.
      throw new Error('Object storage deletion failed.');
    }

    await transaction(row.tenant_id, 'file-object-cleanup', (client) =>
      markFileObjectDeleted(client, row.tenant_id, parsed.data.file_id),
    );
  };
}

export const handleFileObjectCleanup = createFileObjectCleanupHandler();
