import type { Request, Response } from 'express';

import { ForbiddenError, ValidationError } from '../../shared/errors.js';
import { changeTrialPlan } from './billing.service.js';
import type { ChangeSubscriptionPlanInput } from './billing.schemas.js';

export async function changeSubscriptionPlanController(req: Request, res: Response): Promise<void> {
  const tenantContext = req.tenantContext;
  const principalId = req.clerkPrincipal?.clerkUserId;
  const idempotencyKey = req.subscriptionIdempotencyKey;
  if (!tenantContext || !principalId) throw new ForbiddenError('Tenant context is required.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');

  const result = await changeTrialPlan({
    tenantId: tenantContext.tenantId,
    membershipId: tenantContext.membershipId,
    principalId,
    requestId: req.requestId,
    idempotencyKey,
    request: req.body as ChangeSubscriptionPlanInput,
  });
  res.status(result.status).json(result.body);
}
