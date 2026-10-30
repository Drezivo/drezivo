import type { PoolClient } from 'pg';

import { publicStorefrontMediaUrl, staffFileMediaUrl } from '../files/file-media-url.js';

// `payment_method_material` is published only when an active online method references it.
const DISPLAYABLE_PURPOSES = ['storefront_asset', 'catalogue_image', 'measurement_guide', 'payment_method_material'];

export type MediaAudience =
  | { kind: 'staff'; branchId: string }
  | { kind: 'public'; slug: string; preview?: boolean };

/**
 * Maps accepted, same-tenant file ids to application routes. The route rechecks authorization on
 * cache misses and privately fetches from R2; this helper never signs an R2 read URL.
 */
export class StorefrontMediaUrlMapper {
  async map(
    client: PoolClient,
    tenantId: string,
    fileIds: ReadonlyArray<string | null>,
    audience: MediaAudience,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(fileIds.filter((id): id is string => id !== null))];
    const urls = new Map<string, string>();
    if (ids.length === 0) return urls;

    const rows = await client.query<{ id: string; mime_type: string }>(
      `SELECT id, mime_type
         FROM file_object
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
          AND lifecycle_status = 'accepted'
          AND frozen_at IS NOT NULL
          AND purpose = ANY($3::text[])
          AND mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')`,
      [tenantId, ids, DISPLAYABLE_PURPOSES],
    );
    for (const row of rows.rows) {
      urls.set(
        row.id,
        audience.kind === 'public'
          ? publicStorefrontMediaUrl(audience.slug, row.id, audience.preview ?? false, row.mime_type)
          : staffFileMediaUrl(row.id, audience.branchId, row.mime_type),
      );
    }
    return urls;
  }
}

export const storefrontMediaUrlMapper = new StorefrontMediaUrlMapper();
