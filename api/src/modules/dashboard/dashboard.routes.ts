import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { getDashboardOverviewController } from './dashboard.controller.js';
import { requireDashboardReadPermission } from './dashboard.middleware.js';

export const dashboardRouter = Router();

const dashboardReadRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) =>
    req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

dashboardRouter.get(
  '/dashboard/overview',
  requireStaffAuth,
  requireTenantContext,
  dashboardReadRateLimit,
  requireTenantAction('existing_rental_read'),
  requireDashboardReadPermission,
  getDashboardOverviewController,
);
