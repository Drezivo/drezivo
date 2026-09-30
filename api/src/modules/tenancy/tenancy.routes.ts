import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { getActorContextController, getWorkspacesController } from './tenancy.controller.js';
import { paginationQuerySchema } from './tenancy.schemas.js';

export const tenancyRouter = Router();

// Every full dashboard load reads workspaces and actor context several times, and both routes
// share this bucket. 30 a minute locked owners out after about seven reloads or a few open tabs;
// 120 still caps abuse of these cheap signed-in reads.
const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 120,
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
