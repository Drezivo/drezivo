import { z } from 'zod';

import { config } from '../../config/index.js';
import { logger } from '../../shared/logger.js';
import type { EventHandler } from '../runner.js';

export const MEDIA_CACHE_INVALIDATION_EVENT_TYPE = 'media.cache.invalidate_requested';

const payloadSchema = z.object({}).strict();

/** Invalidates all Vercel-cached public media for a tenant after visibility changes commit. */
export const handleMediaCacheInvalidation: EventHandler = async (event) => {
  if (!payloadSchema.safeParse(event.payload).success) {
    throw new Error('Media cache invalidation event payload is invalid.');
  }

  if (!config.STOREFRONT_WEB_URL || !config.MEDIA_READ_GRANT_SECRET) {
    logger.warn('media cache invalidation skipped because its endpoint is not configured');
    return;
  }

  const endpoint = new URL('/api/media/invalidate', config.STOREFRONT_WEB_URL);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Drezivo-Media-Grant': config.MEDIA_READ_GRANT_SECRET,
      },
      body: JSON.stringify({ tenant_id: event.tenant_id }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });
  } catch {
    throw new Error('Storefront media cache invalidation request failed.');
  }
  if (!response.ok) throw new Error('Storefront media cache invalidation was rejected.');
};
