import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import {
  getCustomerDetailController,
  getCustomerSummaryController,
  listCustomerFittingsController,
  listCustomerReservationsController,
  listCustomersController,
} from './customers.controller.js';
import {
  requireCustomerReadPermission,
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
