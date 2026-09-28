import { z } from 'zod';

/** Customer address used for reservation fulfilment and operational contact. */
export const customerAddress = z.string().trim().min(1).max(500);

/** Optional customer-provided social profile handle or URL. */
export const customerSocialMedia = z.string().trim().min(1).max(320);
