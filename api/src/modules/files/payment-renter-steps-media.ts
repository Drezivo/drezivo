import type { PoolClient } from 'pg';

import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';

const RENTER_STEPS_IMAGE_TTL_SECONDS = 300;

/** Sign only accepted, same-tenant payment-step images explicitly supplied by the caller. */
export async function signPaymentRenterStepsImages(
  client: PoolClient,
  tenantId: string,
  fileIds: ReadonlyArray<string | null>,
  storage: ObjectStorage = objectStorage,
): Promise<Map<string, string>> {
  const ids = [...new Set(fileIds.filter((id): id is string => id !== null))];
  const urls = new Map<string, string>();
  if (ids.length === 0) return urls;

  const rows = await client.query<{ id: string; storage_key: string; version_id: string | null }>(
    `SELECT id, storage_key, version_id
       FROM file_object
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
        AND purpose = 'payment_method_material'
        AND lifecycle_status = 'accepted'
        AND frozen_at IS NOT NULL
        AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
        AND byte_size BETWEEN 1 AND 10485760`,
    [tenantId, ids],
  );

  for (const row of rows.rows) {
    const { readUrl } = await storage.authorizeRead({
      storageKey: row.storage_key,
      versionId: row.version_id,
      expiresInSeconds: RENTER_STEPS_IMAGE_TTL_SECONDS,
    });
    urls.set(row.id, readUrl);
  }
  return urls;
}
