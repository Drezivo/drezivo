import { Router } from 'express';

import { requireVerifiedStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import {
  abandonOnboardingController,
  bootstrapTenantController,
  createOnboardingController,
  getCurrentOnboardingController,
  selectOnboardingPlanController,
} from './onboarding.controller.js';
import {
  requireOnboardingIdempotencyKey,
  validateAbandonOwnerOnboarding,
  validateBootstrapTenant,
  validateChooseOnboardingPlan,
  validateCreateOwnerOnboarding,
} from './onboarding.middleware.js';

export const onboardingRouter = Router();

onboardingRouter.get(
  '/onboarding/current',
  requireVerifiedStaffAuth,
  rateLimit({
    windowMs: 60_000,
    max: 30,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  getCurrentOnboardingController,
);

onboardingRouter.post(
  '/onboarding',
  requireVerifiedStaffAuth,
  rateLimit({
    windowMs: 60_000,
    max: 5,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  validateCreateOwnerOnboarding,
  requireOnboardingIdempotencyKey,
  createOnboardingController,
);

onboardingRouter.post(
  '/onboarding/:onboardingId/plan',
  requireVerifiedStaffAuth,
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  validateChooseOnboardingPlan,
  requireOnboardingIdempotencyKey,
  selectOnboardingPlanController,
);

onboardingRouter.post(
  '/onboarding/:onboardingId/abandon',
  requireVerifiedStaffAuth,
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  validateAbandonOwnerOnboarding,
  requireOnboardingIdempotencyKey,
  abandonOnboardingController,
);

onboardingRouter.post(
  '/onboarding/:onboardingId/bootstrap',
  requireVerifiedStaffAuth,
  rateLimit({
    windowMs: 60_000,
    max: 5,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  validateBootstrapTenant,
  requireOnboardingIdempotencyKey,
  bootstrapTenantController,
);
