import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import {
  requireSubscriptionContext,
  requireSubscriptionIdempotencyKey,
  requireTenantOwner,
  validateChangeSubscriptionPlan,
} from './billing.middleware.js';
import { changeSubscriptionPlanController } from './billing.controller.js';

export const billingRouter = Router();

billingRouter.post(
  '/subscription/plan',
  requireStaffAuth,
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  requireTenantContext,
  requireSubscriptionContext,
  requireTenantOwner,
  validateChangeSubscriptionPlan,
  requireSubscriptionIdempotencyKey,
  changeSubscriptionPlanController,
);
