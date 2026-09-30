import { Router, type ErrorRequestHandler } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  attachFittingPaymentReceiptController,
  cancelFittingController,
  completeFittingController,
  confirmFittingController,
  createFittingController,
  createFittingPaymentController,
  getFittingController,
  getFittingIntakeController,
  getFittingSettingsController,
  listFittingsController,
  noShowFittingController,
  rejectFittingController,
  rescheduleFittingController,
  updateFittingGarmentsController,
  updateFittingNoteController,
  updateFittingSettingsController,
  verifyFittingPaymentController,
} from './fittings.controller.js';
import {
  requireFittingConfigurationOwner,
  requireFittingIdempotencyKey,
  requireFittingOperationalPermission,
  requireFittingPaymentVerificationPermission,
  validateFittingCancel,
  validateFittingComplete,
  validateFittingConfirm,
  validateFittingCreate,
  validateFittingGarmentPlanUpdate,
  validateFittingId,
  validateFittingIntakeQuery,
  validateFittingListQuery,
  validateFittingNoShow,
  validateFittingNoteUpdate,
  validateFittingPaymentIntentCreate,
  validateFittingPaymentReceiptAttach,
  validateFittingPaymentVerify,
  validateFittingReject,
  validateFittingReschedule,
  validateFittingSettingsUpdate,
} from './fittings.middleware.js';
import { recordFittingCommandFailure } from './fittings.observability.js';

export const fittingsRouter = Router();

const readRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) =>
    req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});
const writeRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyOf: (req) =>
    req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const staffRead = [
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireFittingOperationalPermission,
] as const;
const staffWrite = [
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireFittingOperationalPermission,
] as const;
const ownerWrite = [
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireFittingConfigurationOwner,
] as const;

fittingsRouter.get(
  '/fittings/intake-options',
  ...staffRead,
  validateFittingIntakeQuery,
  getFittingIntakeController,
);
fittingsRouter.get('/fittings/settings', ...staffRead, getFittingSettingsController);
fittingsRouter.get('/fittings', ...staffRead, validateFittingListQuery, listFittingsController);
fittingsRouter.get('/fittings/:id', ...staffRead, validateFittingId, getFittingController);

fittingsRouter.post(
  '/fittings',
  ...staffWrite,
  requireTenantAction('new_booking'),
  validateFittingCreate,
  requireFittingIdempotencyKey,
  createFittingController,
);
fittingsRouter.patch(
  '/fittings/:id/note',
  ...staffWrite,
  requireTenantAction('new_booking'),
  validateFittingId,
  validateFittingNoteUpdate,
  requireFittingIdempotencyKey,
  updateFittingNoteController,
);
fittingsRouter.put(
  '/fittings/:id/garments',
  ...staffWrite,
  requireTenantAction('new_booking'),
  validateFittingId,
  validateFittingGarmentPlanUpdate,
  requireFittingIdempotencyKey,
  updateFittingGarmentsController,
);
fittingsRouter.post(
  '/fittings/:id/reschedule',
  ...staffWrite,
  requireTenantAction('new_booking'),
  validateFittingId,
  validateFittingReschedule,
  requireFittingIdempotencyKey,
  rescheduleFittingController,
);

fittingsRouter.post(
  '/fittings/:id/confirm',
  ...staffWrite,
  requireTenantAction('new_booking'),
  validateFittingId,
  validateFittingConfirm,
  requireFittingIdempotencyKey,
  confirmFittingController,
);
fittingsRouter.post(
  '/fittings/:id/reject',
  ...staffWrite,
  requireTenantAction('settlement'),
  validateFittingId,
  validateFittingReject,
  requireFittingIdempotencyKey,
  rejectFittingController,
);
fittingsRouter.post(
  '/fittings/:id/cancel',
  ...staffWrite,
  requireTenantAction('settlement'),
  validateFittingId,
  validateFittingCancel,
  requireFittingIdempotencyKey,
  cancelFittingController,
);
fittingsRouter.post(
  '/fittings/:id/complete',
  ...staffWrite,
  requireTenantAction('settlement'),
  validateFittingId,
  validateFittingComplete,
  requireFittingIdempotencyKey,
  completeFittingController,
);
fittingsRouter.post(
  '/fittings/:id/no-show',
  ...staffWrite,
  requireTenantAction('settlement'),
  validateFittingId,
  validateFittingNoShow,
  requireFittingIdempotencyKey,
  noShowFittingController,
);

fittingsRouter.post(
  '/fittings/:id/payment',
  ...staffWrite,
  requireTenantAction('settlement'),
  validateFittingId,
  validateFittingPaymentIntentCreate,
  requireFittingIdempotencyKey,
  createFittingPaymentController,
);
fittingsRouter.post(
  '/fittings/:id/payment-receipt',
  ...staffWrite,
  requireTenantAction('settlement'),
  validateFittingId,
  validateFittingPaymentReceiptAttach,
  requireFittingIdempotencyKey,
  attachFittingPaymentReceiptController,
);
fittingsRouter.post(
  '/fittings/:id/verify-payment',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireFittingPaymentVerificationPermission,
  requireTenantAction('settlement'),
  validateFittingId,
  validateFittingPaymentVerify,
  requireFittingIdempotencyKey,
  verifyFittingPaymentController,
);

fittingsRouter.put(
  '/fittings/settings',
  ...ownerWrite,
  requireTenantAction('new_booking'),
  validateFittingSettingsUpdate,
  requireFittingIdempotencyKey,
  updateFittingSettingsController,
);

const FITTING_ROUTE_ID_PATTERN = /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;

const recordFittingBoundaryFailure: ErrorRequestHandler = (error, req, _res, next): void => {
  recordFittingCommandFailure({
    operation: `${req.method} ${req.path.replace(FITTING_ROUTE_ID_PATTERN, '/:id')}`,
    requestId: req.requestId,
    ...(req.tenantContext
      ? {
          tenantId: req.tenantContext.tenantId,
          branchId: req.tenantContext.activeBranchId,
        }
      : {}),
    ...(req.fittingId ? { fittingId: req.fittingId } : {}),
    error,
  });
  next(error);
};

fittingsRouter.use(recordFittingBoundaryFailure);
