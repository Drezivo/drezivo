import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import {
  archiveCustomerController,
  getCustomerDetailController,
  getCustomerSummaryController,
  listCustomerFittingsController,
  listCustomerReservationsController,
  listCustomersController,
  updateCustomerController,
} from './customers.controller.js';
import {
  requireCustomerIdempotencyKey,
  requireCustomerReadPermission,
  requireCustomerWritePermission,
  validateCustomerArchiveRequest,
  validateCustomerEditRequest,
  validateCustomerHistoryQuery,
  validateCustomerId,
  validateCustomerListQuery,
} from './customers.middleware.js';

export const customersRouter = Router();

const customerReadRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyOf: (req) =>
    req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const customerRead = [
  requireStaffAuth,
  requireTenantContext,
  customerReadRateLimit,
  requireCustomerReadPermission,
] as const;

const customerMutationRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyOf: (req) =>
    req.tenantContext?.tenantId ?? req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
});

const customerWrite = [
  requireStaffAuth,
  requireTenantContext,
  customerMutationRateLimit,
  requireCustomerWritePermission,
] as const;

customersRouter.get('/customers/summary', ...customerRead, getCustomerSummaryController);
customersRouter.get('/customers', ...customerRead, validateCustomerListQuery, listCustomersController);
customersRouter.get('/customers/:customerId', ...customerRead, validateCustomerId, getCustomerDetailController);
customersRouter.get(
  '/customers/:customerId/reservations',
  ...customerRead,
  validateCustomerId,
  validateCustomerHistoryQuery,
  listCustomerReservationsController,
);
customersRouter.get(
  '/customers/:customerId/fittings',
  ...customerRead,
  validateCustomerId,
  validateCustomerHistoryQuery,
  listCustomerFittingsController,
);

customersRouter.patch(
  '/customers/:customerId',
  ...customerWrite,
  requireTenantAction('new_booking'),
  validateCustomerId,
  validateCustomerEditRequest,
  requireCustomerIdempotencyKey,
  updateCustomerController,
);

customersRouter.post(
  '/customers/:customerId/archive',
  ...customerWrite,
  requireTenantAction('new_booking'),
  validateCustomerId,
  validateCustomerArchiveRequest,
  requireCustomerIdempotencyKey,
  archiveCustomerController,
);
