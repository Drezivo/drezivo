import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { fileObjectId } from '@drezivo/contracts';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { config } from '../../config/index.js';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { DependencyUnavailableError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import { publicStorefrontService } from '../storefront/storefront.service.js';
import { checkPublicCacheReferences } from '../storefront/storefront-cache-gate.js';
import { verifyPreviewToken } from '../storefront/storefront-preview.js';

const slug = z.string().regex(/^[a-z0-9-]{1,80}$/);
const widthQuery = z.object({ w: z.enum(['320', '960', '1600']).optional() }).strict();
const publicGrantParams = z.object({ slug, fileId: fileObjectId }).strict();
const cacheReferences = z.object({
  scope: z.enum(['store', 'catalogue', 'item']),
  products: z.array(z.string().uuid()).max(48),
  images: z.array(z.object({ product_id: z.string().uuid(), file_id: z.string().uuid() }).strict()).max(240),
  variants: z.array(z.object({ product_id: z.string().uuid(), variant_id: z.string().uuid(), guide_file_id: z.string().uuid().nullable() }).strict()).max(200),
  store_images: z.array(z.object({ slot: z.enum(['logo', 'cover', 'hero', 'about', 'policy']), file_id: z.string().uuid() }).strict()).max(24),
}).strict().superRefine((value, ctx) => {
  const products = new Set(value.products);
  if ((value.scope !== 'store' && value.store_images.length > 0) ||
      (value.scope === 'item' && products.size !== 1) ||
      value.images.some((image) => !products.has(image.product_id)) ||
      value.variants.some((variant) => !products.has(variant.product_id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid public cache references.' });
  }
});

export const internalMediaRouter = Router();

// A cache hit bypasses the public-read middleware, so retain an equivalent per-client limit.
// The address is trusted only after the Worker has authenticated with the grant secret.
const cacheGateLimit = rateLimit({ windowMs: 60_000, max: 240, keyOf: (req) => {
  const address = req.get('X-Drezivo-Client-Address') ?? '';
  return `public-cache-gate:${isIP(address) ? address : 'unknown'}`;
} });

internalMediaRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

internalMediaRouter.post(
  '/internal/media/v1/public/stores/:slug/cache-gate',
  requireMediaGrantSecret,
  cacheGateLimit,
  validate({ params: z.object({ slug }).strict(), body: cacheReferences }),
  async (req, res) => {
    const params = z.object({ slug }).strict().parse(req.params);
    sendSuccess(req, res, await checkPublicCacheReferences(params.slug, cacheReferences.parse(req.body)));
  },
);

internalMediaRouter.post(
  '/internal/media/v1/public/stores/:slug/files/:fileId/grant',
  requireMediaGrantSecret,
  validate({ params: publicGrantParams, query: widthQuery }),
  async (req, res) => {
    const params = publicGrantParams.parse(req.params);
    const query = widthQuery.parse(req.query);
    const previewHeader = req.get('X-Storefront-Preview');
    const preview = verifyPreviewToken(previewHeader);
    if (previewHeader && !preview) throw new NotFoundError('This store image is not available.');
    const grant = await publicStorefrontService.authorizeMediaRead(
      params.slug,
      params.fileId,
      parseWidth(query.w),
      preview,
    );
    if (!grant) throw new NotFoundError('This store image is not available.');
    sendSuccess(req, res, grant);
  },
);

function requireMediaGrantSecret(req: Request, _res: Response, next: NextFunction): void {
  const expected = config.MEDIA_READ_GRANT_SECRET;
  if (!expected) {
    next(new DependencyUnavailableError('Media delivery is temporarily unavailable.'));
    return;
  }
  const provided = req.get('X-Drezivo-Media-Grant');
  if (!provided) {
    next(new ForbiddenError('Media grant authorization is required.'));
    return;
  }
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    next(new ForbiddenError('Media grant authorization is required.'));
    return;
  }
  next();
}

function parseWidth(value: string | undefined): 320 | 960 | 1600 {
  if (value === '320') return 320;
  if (value === '1600') return 1600;
  return 960;
}
