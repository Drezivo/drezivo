import type { Request, Response } from 'express';

import { termsAcceptanceRequest } from '@drezivo/contracts';

import { sendSuccess } from '../../shared/response.js';
import { ValidationError } from '../../shared/errors.js';
import { acceptCurrentAccountTerms } from './terms-acceptance.service.js';

export async function acceptAccountTermsController(req: Request, res: Response): Promise<void> {
  const principalId = req.clerkPrincipal?.clerkUserId;
  const idempotencyKey = req.accountTermsIdempotencyKey;
  if (!principalId) throw new ValidationError('Verified principal is required.');
  if (!idempotencyKey) throw new ValidationError('A valid Idempotency-Key header is required.');
  const response = await acceptCurrentAccountTerms({
    principalId,
    requestId: req.requestId,
    idempotencyKey,
    request: termsAcceptanceRequest.parse(req.body),
  });
  sendSuccess(req, res, response.data);
}
