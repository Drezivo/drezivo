import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  createPublicHoldController,
  listReservationsController,
} from './reservations.controller.js';
import {
  requireReservationManagePermission,
  validateReservationListQuery,
} from './reservations.middleware.js';

export const reservationsRouter = Router();

const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) => req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

reservationsRouter.get(
  '/reservations',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('existing_rental_read'),
  requireReservationManagePermission,
  validateReservationListQuery,
  listReservationsController,
);

reservationsRouter.post('/public/stores/:slug/holds', createPublicHoldController);
