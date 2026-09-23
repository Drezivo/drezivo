import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  createPublicHoldController,
  createStaffReservationController,
  getReservationDetailController,
  listReservationsController,
} from './reservations.controller.js';
import {
  requireReservationIdempotencyKey,
  requireReservationManagePermission,
  validateReservationId,
  validateReservationListQuery,
  validateStaffReservationCreate,
} from './reservations.middleware.js';

export const reservationsRouter = Router();

const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) => req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const writeRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyOf: (req) => req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

reservationsRouter.post(
  '/reservations',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('new_booking'),
  requireReservationManagePermission,
  validateStaffReservationCreate,
  requireReservationIdempotencyKey,
  createStaffReservationController,
);

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

reservationsRouter.get(
  '/reservations/:reservationId',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('existing_rental_read'),
  requireReservationManagePermission,
  validateReservationId,
  getReservationDetailController,
);

reservationsRouter.post('/public/stores/:slug/holds', createPublicHoldController);
