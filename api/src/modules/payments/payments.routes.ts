import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { getCentralPaymentsController } from './payments.controller.js';
import {
  requirePaymentsViewPermission,
  validateCentralPaymentsQuery,
} from './payments.middleware.js';

export const paymentsRouter = Router();

const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) =>
    req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

paymentsRouter.get(
  '/payments',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('settlement'),
  requirePaymentsViewPermission,
  validateCentralPaymentsQuery,
  getCentralPaymentsController,
);
