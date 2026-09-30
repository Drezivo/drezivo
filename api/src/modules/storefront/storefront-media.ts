import type { PoolClient } from 'pg';

import type { ObjectStorage } from '../../integrations/storage/object-storage.js';
import { objectStorage } from '../../integrations/storage/s3-compatible-object-storage.js';

/** Signed image URLs outlive the public cache (`s-maxage` 300 s) with a wide margin. */
export const STOREFRONT_IMAGE_URL_TTL_SECONDS = 3600;

// `payment_method_material` is a business's own payment instructions, shown to its renters at checkout.
const DISPLAYABLE_PURPOSES = ['storefront_asset', 'catalogue_image', 'measurement_guide', 'payment_method_material'];

/**
 * Turns accepted file ids into short-lived signed read URLs in one query. Unknown, foreign,
 * unaccepted, or receipt files are simply absent from the result, so a caller can never be tricked
 * into signing a private document by referencing its id.
 */
export class StorefrontMediaSigner {
  constructor(
    private readonly storage: ObjectStorage = objectStorage,
    private readonly ttlSeconds = STOREFRONT_IMAGE_URL_TTL_SECONDS,
  ) {}

  async sign(client: PoolClient, tenantId: string, fileIds: ReadonlyArray<string | null>): Promise<Map<string, string>> {
    const ids = [...new Set(fileIds.filter((id): id is string => id !== null))];
    const urls = new Map<string, string>();
    if (ids.length === 0) return urls;

    const rows = await client.query<{ id: string; storage_key: string; version_id: string | null }>(
      `SELECT id, storage_key, version_id
         FROM file_object
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
          AND lifecycle_status = 'accepted'
          AND purpose = ANY($3::text[])`,
      [tenantId, ids, DISPLAYABLE_PURPOSES],
    );
    for (const row of rows.rows) {
      const { readUrl } = await this.storage.authorizeRead({
        storageKey: row.storage_key,
        versionId: row.version_id,
        expiresInSeconds: this.ttlSeconds,
      });
      urls.set(row.id, readUrl);
    }
    return urls;
  }
}

export const storefrontMediaSigner = new StorefrontMediaSigner();
