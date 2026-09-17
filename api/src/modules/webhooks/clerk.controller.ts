import type { NextFunction, Request, Response } from 'express';

import { RateLimitedError, ValidationError } from '../../shared/errors.js';
import { sendError } from '../../shared/response.js';
import type { ClerkWebhookService } from './clerk.service.js';
import type { ClerkWebhookVerifier } from './clerk.verifier.js';

const genericRejectionMessage = 'Webhook request could not be accepted.';

export function createClerkWebhookController(
  service: ClerkWebhookService,
  verifier: ClerkWebhookVerifier,
  signingSecret: string,
) {
  return async function clerkWebhookController(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await service.accept({
        rawBody: req.body as Buffer,
        providerEventId: req.get('svix-id')?.trim() ?? '',
        verify: () => verifier(req, { signingSecret }),
      });
      res.status(204).end();
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(res, 422, 'VALIDATION_FAILED', genericRejectionMessage, req.requestId);
        return;
      }
      if (error instanceof RateLimitedError) {
        next(error);
        return;
      }
      next(error);
    }
  };
}
