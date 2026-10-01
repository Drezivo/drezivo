import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { archivePaymentMethodRequest, createPaymentMethodRequest } from '@drezivo/contracts';

import { validate } from '../../middleware/validate.js';
import {
  archivePaymentMethodController,
  createPaymentMethodController,
  listPaymentMethodSettingsController,
  updatePaymentMethodSettingsController,
} from './payment-methods.controller.js';
import {
  requirePaymentManagePermission,
  requirePaymentMethodSettingsIdempotencyKey,
  validatePaymentMethodSettingsId,
  validateUpdatePaymentMethodSettings,
} from './payment-methods.middleware.js';

export const paymentMethodsRouter = Router();

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

paymentMethodsRouter.get(
  '/payment-methods',
  requireStaffAuth,
  requireTenantContext,
  readRateLimit,
  requireTenantAction('context_read'),
  requirePaymentManagePermission,
  listPaymentMethodSettingsController,
);

paymentMethodsRouter.patch(
  '/payment-methods/:paymentMethodId',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('publish'),
  requirePaymentManagePermission,
  validatePaymentMethodSettingsId,
  validateUpdatePaymentMethodSettings,
  requirePaymentMethodSettingsIdempotencyKey,
  updatePaymentMethodSettingsController,
);

paymentMethodsRouter.post(
  '/payment-methods',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('publish'),
  requirePaymentManagePermission,
  validate({ body: createPaymentMethodRequest }),
  requirePaymentMethodSettingsIdempotencyKey,
  createPaymentMethodController,
);

paymentMethodsRouter.post(
  '/payment-methods/:paymentMethodId/archive',
  requireStaffAuth,
  requireTenantContext,
  writeRateLimit,
  requireTenantAction('publish'),
  requirePaymentManagePermission,
  validatePaymentMethodSettingsId,
  validate({ body: archivePaymentMethodRequest }),
  requirePaymentMethodSettingsIdempotencyKey,
  archivePaymentMethodController,
);
