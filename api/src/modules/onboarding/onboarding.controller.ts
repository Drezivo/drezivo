import type { Request, Response } from 'express';

import { sendSuccess } from '../../shared/response.js';
import { ValidationError } from '../../shared/errors.js';
import {
  abandonOwnerOnboarding,
  getCurrentOwnerOnboardingContext,
  selectOnboardingPlan,
  startOwnerOnboarding,
} from './onboarding.service.js';
import { bootstrapOwnerTenant as bootstrapOwnerTenantCommand } from './tenant-bootstrap.service.js';
import type {
  AbandonOwnerOnboardingInput,
  BootstrapTenantInput,
  ChooseOnboardingPlanInput,
  CreateOwnerOnboardingInput,
  OwnerOnboardingIdParams,
} from './onboarding.schemas.js';

export async function getCurrentOnboardingController(req: Request, res: Response): Promise<void> {
  const principalId = readPrincipalId(req);
  const context = await getCurrentOwnerOnboardingContext({ principalId });
  sendSuccess(req, res, context);
}

export async function createOnboardingController(req: Request, res: Response): Promise<void> {
  const principalId = readPrincipalId(req);
  const idempotencyKey = readIdempotencyKey(req);
  const result = await startOwnerOnboarding({
    principalId,
    requestId: req.requestId,
    idempotencyKey,
    request: req.body as CreateOwnerOnboardingInput,
  });
  res.status(result.status).json(result.body);
}

export async function selectOnboardingPlanController(req: Request, res: Response): Promise<void> {
  const principalId = readPrincipalId(req);
  const idempotencyKey = readIdempotencyKey(req);
  const params = req.params as unknown as OwnerOnboardingIdParams;
  const result = await selectOnboardingPlan({
    principalId,
    requestId: req.requestId,
    idempotencyKey,
    onboardingId: params.onboardingId,
    request: req.body as ChooseOnboardingPlanInput,
  });
  res.status(result.status).json(result.body);
}

export async function abandonOnboardingController(req: Request, res: Response): Promise<void> {
  const principalId = readPrincipalId(req);
  const idempotencyKey = readIdempotencyKey(req);
  const params = req.params as unknown as OwnerOnboardingIdParams;
  const request = req.body as AbandonOwnerOnboardingInput;
  const result = await abandonOwnerOnboarding({
    principalId,
    requestId: req.requestId,
    idempotencyKey,
    onboardingId: params.onboardingId,
    request,
  });
  res.status(result.status).json(result.body);
}

export async function bootstrapTenantController(req: Request, res: Response): Promise<void> {
  const principalId = readPrincipalId(req);
  const idempotencyKey = readIdempotencyKey(req);
  const result = await bootstrapOwnerTenantCommand({
    principalId,
    clerkOrgId: req.clerkPrincipal?.clerkOrgId ?? null,
    requestId: req.requestId,
    idempotencyKey,
    onboardingId: readOnboardingId(req),
    request: req.body as BootstrapTenantInput,
  });
  res.status(result.status).json(result.body);
}

/**
 * POST /onboarding/:id/start-trial — the single onboarding step now that there is one plan
 * (Standard, internal code `starter`): select it, then create the workspace with its 14-day trial.
 * Each step is the existing idempotent command with a key derived from this request's key, so a
 * retry or double-click replays both steps instead of acting twice.
 */
export async function startTrialController(req: Request, res: Response): Promise<void> {
  const principalId = readPrincipalId(req);
  const idempotencyKey = readIdempotencyKey(req);
  const onboardingId = readOnboardingId(req);
  const plan = await selectOnboardingPlan({
    principalId,
    requestId: req.requestId,
    idempotencyKey: `${idempotencyKey}:plan`,
    onboardingId,
    request: { plan_code: 'starter' },
  });
  // A trial already used by this account leaves the onboarding waiting for payment; report that as is.
  const planData = (plan.body as { data?: { status?: string } }).data;
  if (plan.status >= 400 || planData?.status !== 'incomplete') {
    res.status(plan.status).json(plan.body);
    return;
  }
  const result = await bootstrapOwnerTenantCommand({
    principalId,
    clerkOrgId: req.clerkPrincipal?.clerkOrgId ?? null,
    requestId: req.requestId,
    idempotencyKey: `${idempotencyKey}:bootstrap`,
    onboardingId,
    request: {},
  });
  res.status(result.status).json(result.body);
}

function readOnboardingId(req: Request): string {
  const value = req.params.onboardingId;
  if (typeof value !== 'string') {
    throw new ValidationError('Onboarding ID is required.');
  }
  return value;
}

function readPrincipalId(req: Request): string {
  const principalId = req.clerkPrincipal?.clerkUserId;
  if (!principalId) {
    throw new ValidationError('Verified principal is required.');
  }
  return principalId;
}

function readIdempotencyKey(req: Request): string {
  const idempotencyKey = req.onboardingIdempotencyKey;
  if (!idempotencyKey) {
    throw new ValidationError('A valid Idempotency-Key header is required.');
  }
  return idempotencyKey;
}
