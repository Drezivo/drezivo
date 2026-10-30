import { timingSafeEqual } from 'node:crypto';

import { fileObjectId } from '@drezivo/contracts';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { config } from '../../config/index.js';
import { validate } from '../../middleware/validate.js';
import { DependencyUnavailableError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { sendSuccess } from '../../shared/response.js';
import { publicStorefrontService } from '../storefront/storefront.service.js';
import { verifyPreviewToken } from '../storefront/storefront-preview.js';

const slug = z.string().regex(/^[a-z0-9-]{1,80}$/);
const widthQuery = z.object({ w: z.enum(['320', '960', '1600']).optional() }).strict();
const publicGrantParams = z.object({ slug, fileId: fileObjectId }).strict();

export const internalMediaRouter = Router();

internalMediaRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

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
