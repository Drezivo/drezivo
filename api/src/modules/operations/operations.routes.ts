import { Router } from 'express';

import { requireStaffAuth, requireVerifiedStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  getDashboardFittingSummaryController,
  getClothingAvailabilityTimelineController,
  getOperationalCalendarController,
} from './operations.controller.js';
import {
  requireOperationsReadPermission,
  validateClothingAvailabilityTimelineQuery,
  validateOperationalCalendarQuery,
} from './operations.middleware.js';

export const operationsRouter = Router();

const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) =>
    req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

operationsRouter.get(
  '/calendar',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('existing_rental_read'),
  requireOperationsReadPermission,
  validateOperationalCalendarQuery,
  getOperationalCalendarController,
);

operationsRouter.get(
  '/calendar/availability',
  requireVerifiedStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('existing_rental_read'),
  requireOperationsReadPermission,
  validateClothingAvailabilityTimelineQuery,
  getClothingAvailabilityTimelineController,
);

operationsRouter.get(
  '/dashboard/fittings-summary',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('existing_rental_read'),
  requireOperationsReadPermission,
  getDashboardFittingSummaryController,
);
