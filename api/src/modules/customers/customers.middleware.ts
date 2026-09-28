import type { RequestHandler } from 'express';

import {
  customerArchiveRequest,
  customerHistoryQuery,
  customerListQuery,
  customerParams,
  idempotencyKey,
  type CustomerHistoryQuery,
  type CustomerListQuery,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    customerIdempotencyKey?: string;
    customerListQuery?: CustomerListQuery;
    customerHistoryQuery?: CustomerHistoryQuery;
    customerId?: string;
  }
}

export const requireCustomerIdempotencyKey: RequestHandler = (req, _res, next): void => {
  const parsed = idempotencyKey.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.customerIdempotencyKey = parsed.data;
  next();
};

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

export const validateCustomerArchive: RequestHandler = (req, _res, next): void => {
  const parsed = customerArchiveRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Customer archive request is invalid.'));
    return;
  }
  req.body = parsed.data;
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
