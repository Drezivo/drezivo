import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  cancelReservationController,
  completeStaffReservationController,
  confirmReservationController,
  createPublicHoldController,
  createStaffReservationController,
  getReservationDetailController,
  listReservationsController,
  rejectReservationController,
  submitReservationController,
} from './reservations.controller.js';
import {
  requireMerchantReservationReviewPermission,
  requireReservationIdempotencyKey,
  requireReservationManagePermission,
  validateReservationCancel,
  validateReservationConfirm,
  validateReservationId,
  validateReservationListQuery,
  validateReservationReject,
  validateReservationSubmit,
  validateStaffReservationComplete,
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

reservationsRouter.post(
  '/reservations/:reservationId/complete-booking',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('settlement'),
  requireReservationManagePermission,
  validateReservationId,
  validateStaffReservationComplete,
  requireReservationIdempotencyKey,
  completeStaffReservationController,
);

reservationsRouter.post(
  '/reservations/:reservationId/cancel',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('settlement'),
  requireReservationManagePermission,
  validateReservationId,
  validateReservationCancel,
  requireReservationIdempotencyKey,
  cancelReservationController,
);

reservationsRouter.post(
  '/reservations/:reservationId/submit',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('settlement'),
  requireReservationManagePermission,
  validateReservationId,
  validateReservationSubmit,
  requireReservationIdempotencyKey,
  submitReservationController,
);

reservationsRouter.post(
  '/reservations/:reservationId/confirm',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('settlement'),
  requireMerchantReservationReviewPermission,
  validateReservationId,
  validateReservationConfirm,
  requireReservationIdempotencyKey,
  confirmReservationController,
);

reservationsRouter.post(
  '/reservations/:reservationId/reject',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('settlement'),
  requireMerchantReservationReviewPermission,
  validateReservationId,
  validateReservationReject,
  requireReservationIdempotencyKey,
  rejectReservationController,
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
