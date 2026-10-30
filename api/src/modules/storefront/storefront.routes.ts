import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';

import {
  catalogueQuery,
  fittingSlotsQuery,
  fileObjectId,
  productId,
  publicAvailabilityQuery,
} from '@drezivo/contracts';

import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess } from '../../shared/response.js';
import { streamFileResponse } from '../files/file-stream.js';
import { NotFoundError } from '../../shared/errors.js';
import { issueFileMediaGrant, verifyFileMediaGrant, verifyPreviewMediaSession } from '../files/media-access-grants.js';
import { verifyPreviewToken, type PreviewGrant } from './storefront-preview.js';
import { publicStorefrontService as service } from './storefront.service.js';

export const storefrontRouter = Router();

const slugParams = z.object({ slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/) }).strict();
const itemParams = slugParams.extend({ productId }).strict();
const mediaParams = slugParams.extend({ fileId: fileObjectId }).strict();
const mediaQuery = z.object({ w: z.enum(['320', '960', '1600']).optional() }).strict();

/** Anonymous reads are limited per client address; guests browsing normally stay far below this. */
const publicReadLimit = rateLimit({ windowMs: 60_000, max: 240, keyOf: (req) => `public-read:${req.ip ?? 'unknown'}` });

/**
 * Express 5 recomputes `req.query` on each access, so handlers re-parse it with the same contract
 * `validate()` already enforced; the parse is cheap and yields typed values with defaults.
 *
 * Catalogue data and referenced public media are cached briefly by browsers and longer by the CDN.
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

function parseWidth(value: string | undefined): 320 | 960 | 1600 | null {
  if (value === '320') return 320;
  if (value === '1600') return 1600;
  return value === '960' ? 960 : null;
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
  '/public/stores/:slug/media/:fileId',
  publicReadLimit,
  validate({ params: mediaParams, query: mediaQuery }),
  async (req, res, next) => {
    try {
      const params = mediaParams.parse(req.params);
      const accessHeader = req.get('X-Drezivo-Media-Access');
      const access = accessHeader
        ? verifyFileMediaGrant(accessHeader, { purpose: 'preview', fileId: params.fileId })
        : null;
      if (!access) throw new NotFoundError('This store image is not available.');
      const preview = {
        tenantId: access.tenantId,
        storefrontId: access.resourceId,
        expiresAt: access.expiresAt,
      };
      const result = await service.readMedia(
        params.slug,
        params.fileId,
        preview,
        parseWidth(mediaQuery.parse(req.query).w),
      );
      if (!result) throw new NotFoundError('This store image is not available.');
      res.setHeader('Vary', 'X-Drezivo-Media-Access');
      streamFileResponse(req, res, next, result, 'private, no-store', undefined, 'inline');
    } catch (error) {
      next(error);
    }
  },
);

storefrontRouter.post(
  '/public/stores/:slug/media/:fileId/grant',
  publicReadLimit,
  validate({ params: mediaParams }),
  async (req, res) => {
    const params = mediaParams.parse(req.params);
    const session = verifyPreviewMediaSession(req.get('X-Storefront-Media-Session'));
    if (!session?.expiresAt) throw new NotFoundError('This store image is not available.');
    const authorized = await service.authorizePreviewMedia(params.slug, params.fileId, {
      tenantId: session.tenantId,
      storefrontId: session.storefrontId,
      expiresAt: session.expiresAt,
    });
    if (!authorized) throw new NotFoundError('This store image is not available.');
    const grant = issueFileMediaGrant({
      purpose: 'preview',
      tenantId: authorized.tenantId,
      resourceId: authorized.storefrontId,
      fileId: params.fileId,
    }, new Date(), authorized.expiresAt);
    res.setHeader('Cache-Control', 'private, no-store');
    sendSuccess(req, res, { media_grant: grant.grant, expires_at: grant.expiresAt });
  },
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
