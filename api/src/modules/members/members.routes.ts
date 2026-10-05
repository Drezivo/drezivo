import { Router, type RequestHandler } from 'express';

import { requireVerifiedStaffAuth } from '../../middleware/auth.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { ForbiddenError } from '../../shared/errors.js';
import { listTenantMembersController } from './members.controller.js';

export const membersRouter = Router();

const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const requireOwner: RequestHandler = (req, _res, next): void => {
  if (req.tenantContext?.role !== 'owner') {
    next(new ForbiddenError('Only the active tenant owner can view workspace members.'));
    return;
  }
  next();
};

membersRouter.get(
  '/members',
  requireVerifiedStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireOwner,
  listTenantMembersController,
);
