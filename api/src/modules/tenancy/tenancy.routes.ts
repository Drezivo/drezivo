import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { getActorContextController, getWorkspacesController } from './tenancy.controller.js';
import { paginationQuerySchema } from './tenancy.schemas.js';

export const tenancyRouter = Router();

const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

tenancyRouter.get(
  '/workspaces',
  requireStaffAuth,
  readRateLimit,
  validate({ query: paginationQuerySchema }),
  getWorkspacesController,
);
tenancyRouter.get(
  '/actor-context',
  requireStaffAuth,
  readRateLimit,
  requireTenantContext,
  getActorContextController,
);
