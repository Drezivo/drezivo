import type { RequestHandler } from 'express';

import {
  customerHistoryQuery,
  customerListQuery,
  customerParams,
  type CustomerHistoryQuery,
  type CustomerListQuery,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    customerListQuery?: CustomerListQuery;
    customerHistoryQuery?: CustomerHistoryQuery;
    customerId?: string;
  }
}

export const requireCustomerReadPermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('Customer directory access requires reservation management permission.'));
    return;
  }
  next();
};

export const validateCustomerId: RequestHandler = (req, _res, next): void => {
  const parsed = customerParams.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Customer id is invalid.'));
    return;
  }
  req.customerId = parsed.data.customerId;
  next();
};

export const validateCustomerHistoryQuery: RequestHandler = (req, _res, next): void => {
  const parsed = customerHistoryQuery.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Customer history query is invalid.'));
    return;
  }
  req.customerHistoryQuery = parsed.data;
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
