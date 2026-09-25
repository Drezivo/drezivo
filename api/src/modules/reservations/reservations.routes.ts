import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  attachReservationPaymentReceiptController,
  cancelReservationController,
  completeStaffReservationController,
  confirmReservationController,
  createPublicHoldController,
  createStaffReservationController,
  getReservationDetailController,
  getStaffReservationAvailabilityCalendarController,
  getStaffReservationAvailabilityCheckController,
  getStaffReservationIntakeOptionsController,
  listReservationsController,
  pickupReservationController,
  rejectReservationController,
  verifyReservationPaymentController,
  returnReservationController,
  inspectReturnedReservationController,
  completeRentalReservationController,
  submitReservationController,
} from './reservations.controller.js';
import {
  requireMerchantReservationReviewPermission,
  requireReservationCustodyPermission,
  requireReservationIdempotencyKey,
  requireReservationManagePermission,
  validateReservationCancel,
  validateReservationConfirm,
  validateReservationId,
  validateReservationPaymentReceiptAttach,
  validateReservationPaymentVerify,
  validateReservationListQuery,
  validateReservationPickup,
  validateReservationReject,
  validateReservationReturn,
  validateReservationInspection,
  validateReservationRentalComplete,
  validateReservationSubmit,
  validateStaffReservationAvailabilityCalendarQuery,
  validateStaffReservationAvailabilityCheckQuery,
  validateStaffReservationComplete,
  validateStaffReservationCreate,
  validateStaffReservationIntakeQuery,
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

reservationsRouter.get(
  '/reservations/availability-calendar',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('new_booking'),
  requireReservationManagePermission,
  validateStaffReservationAvailabilityCalendarQuery,
  getStaffReservationAvailabilityCalendarController,
);

reservationsRouter.get(
  '/reservations/availability-check',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('new_booking'),
  requireReservationManagePermission,
  validateStaffReservationAvailabilityCheckQuery,
  getStaffReservationAvailabilityCheckController,
);

reservationsRouter.get(
  '/reservations/intake-options',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('new_booking'),
  requireReservationManagePermission,
  validateStaffReservationIntakeQuery,
  getStaffReservationIntakeOptionsController,
);

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
  '/reservations/:reservationId/pickup',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('settlement'),
  requireReservationCustodyPermission,
  validateReservationId,
  validateReservationPickup,
  requireReservationIdempotencyKey,
  pickupReservationController,
);

reservationsRouter.post(
  '/reservations/:reservationId/return',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('return'),
  requireReservationCustodyPermission,
  validateReservationId,
  validateReservationReturn,
  requireReservationIdempotencyKey,
  returnReservationController,
);

reservationsRouter.post(
  '/reservations/:reservationId/inspection',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('return'),
  requireReservationCustodyPermission,
  validateReservationId,
  validateReservationInspection,
  requireReservationIdempotencyKey,
  inspectReturnedReservationController,
);

reservationsRouter.post(
  '/reservations/:reservationId/complete-rental',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('settlement'),
  requireReservationCustodyPermission,
  validateReservationId,
  validateReservationRentalComplete,
  requireReservationIdempotencyKey,
  completeRentalReservationController,
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
  '/reservations/:reservationId/payment-receipt',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('settlement'),
  requireReservationManagePermission,
  validateReservationId,
  validateReservationPaymentReceiptAttach,
  requireReservationIdempotencyKey,
  attachReservationPaymentReceiptController,
);

reservationsRouter.post(
  '/reservations/:reservationId/verify-payment',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('settlement'),
  requireMerchantReservationReviewPermission,
  validateReservationId,
  validateReservationPaymentVerify,
  requireReservationIdempotencyKey,
  verifyReservationPaymentController,
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
