import { Router } from 'express';

import { rateLimit } from '../../middleware/rate-limit.js';
import { readHandler } from '../../middleware/staff-command.js';
import { getPublicPlanCatalog } from './plans.service.js';

export const planCatalogRouter = Router();

planCatalogRouter.use(
  rateLimit({ windowMs: 60_000, max: 120, keyOf: (req) => req.ip ?? 'unknown' }),
  (_req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    next();
  },
);

planCatalogRouter.get(
  '/plans',
  readHandler(() => getPublicPlanCatalog()),
);
