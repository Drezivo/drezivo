import type { RequestHandler } from 'express';

import {
  customerArchiveRequest,
  customerEditRequest,
  customerHistoryQuery,
  customerListQuery,
  customerParams,
  type CustomerArchiveRequest,
  type CustomerEditRequest,
  type CustomerHistoryQuery,
  type CustomerListQuery,
} from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    customerListQuery?: CustomerListQuery;
    customerHistoryQuery?: CustomerHistoryQuery;
    customerId?: string;
    customerEditRequest?: CustomerEditRequest;
    customerArchiveRequest?: CustomerArchiveRequest;
    customerIdempotencyKey?: string;
  }
}

export const requireCustomerReadPermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('Customer directory access requires reservation management permission.'));
    return;
  }
  next();
};

export const requireCustomerWritePermission: RequestHandler = (req, _res, next): void => {
  if (!req.tenantContext?.permissionCodes.includes('reservations.manage')) {
    next(new ForbiddenError('Customer profile management requires reservation management permission.'));
    return;
  }
  next();
};

export const requireCustomerIdempotencyKey: RequestHandler = (req, _res, next): void => {
  const key = req.header('Idempotency-Key')?.trim();
  if (!key || key.length < 8 || key.length > 255) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.customerIdempotencyKey = key;
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

export const validateCustomerEditRequest: RequestHandler = (req, _res, next): void => {
  const parsed = customerEditRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Customer edit request is invalid.'));
    return;
  }
  req.customerEditRequest = parsed.data;
  next();
};

export const validateCustomerArchiveRequest: RequestHandler = (req, _res, next): void => {
  const parsed = customerArchiveRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Customer archive request is invalid.'));
    return;
  }
  req.customerArchiveRequest = parsed.data;
  next();
};
