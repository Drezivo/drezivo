import type { RequestHandler } from 'express';

import { idempotencyKey as idempotencyKeySchema } from '@drezivo/contracts';

import { ValidationError } from '../../shared/errors.js';
import {
  abandonOwnerOnboardingRequest,
  bootstrapTenantRequest,
  chooseOnboardingPlanRequest,
  createOwnerOnboardingRequest,
  ownerOnboardingIdParams,
} from './onboarding.schemas.js';

declare module 'express-serve-static-core' {
  interface Request {
    onboardingIdempotencyKey?: string;
  }
}

/** Reads the idempotency key once at the HTTP boundary and exposes only the validated value. */
export const requireOnboardingIdempotencyKey: RequestHandler = (req, _res, next): void => {
  const parsed = idempotencyKeySchema.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) {
    next(new ValidationError('A valid Idempotency-Key header is required.'));
    return;
  }
  req.onboardingIdempotencyKey = parsed.data;
  next();
};

export const validateCreateOwnerOnboarding: RequestHandler = (req, _res, next): void => {
  const parsed = createOwnerOnboardingRequest.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Onboarding request is invalid.'));
    return;
  }
  req.body = parsed.data;
  next();
};

export const validateAbandonOwnerOnboarding: RequestHandler = (req, _res, next): void => {
  const params = ownerOnboardingIdParams.safeParse(req.params);
  if (!params.success) {
    next(new ValidationError('Onboarding ID is invalid.'));
    return;
  }
  const body = abandonOwnerOnboardingRequest.safeParse(req.body);
  if (!body.success) {
    next(new ValidationError('Abandon request is invalid.'));
    return;
  }
  req.params = params.data;
  req.body = body.data;
  next();
};

export const validateChooseOnboardingPlan: RequestHandler = (req, _res, next): void => {
  const params = ownerOnboardingIdParams.safeParse(req.params);
  if (!params.success) {
    next(new ValidationError('Onboarding ID is invalid.'));
    return;
  }
  const body = chooseOnboardingPlanRequest.safeParse(req.body);
  if (!body.success) {
    next(new ValidationError('Plan selection request is invalid.'));
    return;
  }
  req.params = params.data;
  req.body = body.data;
  next();
};

export const validateBootstrapTenant: RequestHandler = (req, _res, next): void => {
  const params = ownerOnboardingIdParams.safeParse(req.params);
  if (!params.success) {
    next(new ValidationError('Onboarding ID is invalid.'));
    return;
  }
  const body = bootstrapTenantRequest.safeParse(req.body);
  if (!body.success) {
    next(new ValidationError('Bootstrap request is invalid.'));
    return;
  }
  req.params = params.data;
  req.body = body.data;
  next();
};
