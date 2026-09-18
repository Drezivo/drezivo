import type { RequestHandler } from 'express';

import { idempotencyKey } from '@drezivo/contracts';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';
import { requireTenantAction } from '../tenancy/tenancy.service.js';
import { changeSubscriptionPlanRequest } from './billing.schemas.js';

declare module 'express-serve-static-core' {
  interface Request {
    subscriptionIdempotencyKey?: string;
  }
}

export const requireSubscriptionIdempotencyKey: RequestHandler = (req, _res, next): void => {
  const parsed = idempotencyKey.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.subscriptionIdempotencyKey = parsed.data;
  next();
};

export const validateChangeSubscriptionPlan: RequestHandler = (req, _res, next): void => {
  try {
    req.body = changeSubscriptionPlanRequest.parse(req.body);
    next();
  } catch {
    next(new ValidationError('Subscription plan request is invalid.'));
  }
};

export const requireTenantOwner: RequestHandler = (req, _res, next): void => {
  if (req.tenantContext?.role !== 'owner') {
    next(new ForbiddenError('Only the tenant owner can perform this action.'));
    return;
  }
  next();
};

export const requireSubscriptionContext = requireTenantAction('context_read');
