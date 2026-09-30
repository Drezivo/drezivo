import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';

import {
  catalogueQuery,
  fittingSlotsQuery,
  productId,
  publicAvailabilityQuery,
} from '@drezivo/contracts';

import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess } from '../../shared/response.js';
import { verifyPreviewToken, type PreviewGrant } from './storefront-preview.js';
import { publicStorefrontService as service } from './storefront.service.js';

export const storefrontRouter = Router();

const slugParams = z.object({ slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/) }).strict();
const itemParams = slugParams.extend({ productId }).strict();

/** Anonymous reads are limited per client address; guests browsing normally stay far below this. */
const publicReadLimit = rateLimit({ windowMs: 60_000, max: 240, keyOf: (req) => `public-read:${req.ip ?? 'unknown'}` });

/**
 * Express 5 recomputes `req.query` on each access, so handlers re-parse it with the same contract
 * `validate()` already enforced; the parse is cheap and yields typed values with defaults.
 *
 * Catalogue data is cached briefly by browsers and longer by the CDN. Signed image URLs live for an
 * hour, which comfortably outlasts `s-maxage` plus `stale-while-revalidate`.
 */
const CATALOGUE_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
const LIVE_CACHE = 'public, max-age=15, s-maxage=30';
const PREVIEW_HEADER = 'X-Storefront-Preview';

/**
 * An owner preview (see storefront-preview.ts) is read through the same handlers. A missing or
 * invalid preview header falls back to the ordinary public read. Preview responses are never
 * stored anywhere, and `Vary` keeps a shared cache from serving one kind of response for the other.
 */
function publicRead<T>(cacheControl: string, read: (req: Request, preview: PreviewGrant | null) => Promise<T>): RequestHandler {
  return async (req: Request, res: Response) => {
    const preview = verifyPreviewToken(req.get(PREVIEW_HEADER));
    const data = await read(req, preview);
    res.setHeader('Cache-Control', preview ? 'private, no-store' : cacheControl);
    res.setHeader('Vary', PREVIEW_HEADER);
    sendSuccess(req, res, data);
  };
}

const slugOf = (req: Request): string => (req.params as { slug: string }).slug;

storefrontRouter.get(
  '/public/stores/:slug',
  publicReadLimit,
  validate({ params: slugParams }),
  publicRead(CATALOGUE_CACHE, (req, preview) => service.getStorefront(slugOf(req), preview)),
);

storefrontRouter.get(
  '/public/stores/:slug/catalogue',
  publicReadLimit,
  validate({ params: slugParams, query: catalogueQuery }),
  publicRead(CATALOGUE_CACHE, (req, preview) => service.getCatalogue(slugOf(req), catalogueQuery.parse(req.query), preview)),
);

storefrontRouter.get(
  '/public/stores/:slug/products/:productId',
  publicReadLimit,
  validate({ params: itemParams }),
  publicRead(CATALOGUE_CACHE, (req, preview) => service.getItem(slugOf(req), (req.params as { productId: string }).productId, preview)),
);

storefrontRouter.get(
  '/public/stores/:slug/availability',
  publicReadLimit,
  validate({ params: slugParams, query: publicAvailabilityQuery }),
  publicRead(LIVE_CACHE, (req, preview) => service.getAvailability(slugOf(req), publicAvailabilityQuery.parse(req.query), preview)),
);

storefrontRouter.get(
  '/public/stores/:slug/fitting-slots',
  publicReadLimit,
  validate({ params: slugParams, query: fittingSlotsQuery }),
  publicRead(LIVE_CACHE, (req, preview) => service.getFittingSlots(slugOf(req), fittingSlotsQuery.parse(req.query).date, preview)),
);
