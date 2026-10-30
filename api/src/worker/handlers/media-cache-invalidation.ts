import { z } from 'zod';

import { config } from '../../config/index.js';
import type { EventHandler } from '../runner.js';

export const MEDIA_CACHE_INVALIDATION_EVENT_TYPE = 'media.cache.invalidate_requested';

const payloadSchema = z.object({}).strict();
const purgeResponse = z.object({ success: z.boolean() }).passthrough();

/** Invalidates every Cloudflare cached response tagged for this tenant. */
export const handleMediaCacheInvalidation: EventHandler = async (event) => {
  if (!payloadSchema.safeParse(event.payload).success || !/^[0-9a-f-]{36}$/i.test(event.tenant_id)) {
    throw new Error('Media cache invalidation event is invalid.');
  }
  if (!config.CLOUDFLARE_MEDIA_ZONE_ID || !config.CLOUDFLARE_MEDIA_PURGE_TOKEN) {
    throw new Error('Cloudflare media cache purge is not configured.');
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.CLOUDFLARE_MEDIA_ZONE_ID}/purge_cache`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.CLOUDFLARE_MEDIA_PURGE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags: [`tenant-${event.tenant_id}`] }),
        signal: AbortSignal.timeout(10_000),
        redirect: 'manual',
      },
    );
  } catch {
    throw new Error('Cloudflare media cache purge request failed.');
  }
  const parsed = purgeResponse.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success || !parsed.data.success) {
    throw new Error('Cloudflare rejected the media cache purge request.');
  }
};
