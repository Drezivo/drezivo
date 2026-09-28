import { Router } from 'express';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireTenantContext } from '../../middleware/tenant-context.js';
import { listCustomersController } from './customers.controller.js';
import {
  requireCustomerReadPermission,
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

customersRouter.get('/customers', ...customerRead, validateCustomerListQuery, listCustomersController);
