import type { RequestHandler } from 'express';

import {
  customerListQuery,
  type CustomerListQuery,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    customerListQuery?: CustomerListQuery;
  }
}

export const requireCustomerReadPermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('Customer directory access requires reservation management permission.'));
    return;
  }
  next();
};

export const validateCustomerListQuery: RequestHandler = (req, _res, next): void => {
  const parsed = customerListQuery.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Customer list query is invalid.'));
    return;
  }
  req.customerListQuery = parsed.data;
  next();
};
