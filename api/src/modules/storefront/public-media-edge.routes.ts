import { Router } from 'express';
import { z } from 'zod';

import { fileObjectId } from '@drezivo/contracts';
import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { NotFoundError } from '../../shared/errors.js';
import { streamFileResponse } from '../files/file-stream.js';
import { publicStorefrontService } from './storefront.service.js';

const paramsSchema = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  fileId: fileObjectId,
}).strict();
const querySchema = z.object({ w: z.enum(['320', '960', '1600']).optional() }).strict();

/** Direct API origin fallback for the public Cloudflare Worker route. */
export const publicMediaEdgeRouter = Router();
publicMediaEdgeRouter.get(
  '/api/media/public/stores/:slug/files/:fileId',
  rateLimit({ windowMs: 60_000, max: 240, keyOf: (req) => `public-media:${req.ip ?? 'unknown'}` }),
  validate({ params: paramsSchema, query: querySchema }),
  async (req, res, next) => {
    try {
      const params = paramsSchema.parse(req.params);
      const query = querySchema.parse(req.query);
      const width = query.w === '320' ? 320 : query.w === '1600' ? 1600 : 960;
      const media = await publicStorefrontService.readMedia(params.slug, params.fileId, null, width);
      if (!media || !media.mimeType.startsWith('image/')) {
        throw new NotFoundError('This store image is not available.');
      }
      res.setHeader('Cache-Tag', `tenant-${media.tenantId},media-${media.fileId}`);
      streamFileResponse(req, res, next, media, 'public, max-age=0, s-maxage=45');
    } catch (error) {
      next(error);
    }
  },
);
