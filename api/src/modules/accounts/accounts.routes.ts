import { Router } from 'express';

import { idempotencyKey as idempotencyKeySchema, termsAcceptanceRequest } from '@drezivo/contracts';

import { requireVerifiedStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { ValidationError } from '../../shared/errors.js';
import { acceptAccountTermsController } from './accounts.controller.js';

declare module 'express-serve-static-core' {
  interface Request {
    accountTermsIdempotencyKey?: string;
  }
}

export const accountsRouter = Router();

accountsRouter.post(
  '/account/terms-acceptance',
  requireVerifiedStaffAuth,
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  validate({ body: termsAcceptanceRequest }),
  (req, _res, next) => {
    const parsed = idempotencyKeySchema.safeParse(req.header('Idempotency-Key')?.trim());
    if (!parsed.success) {
      next(new ValidationError('A valid Idempotency-Key header is required.'));
      return;
    }
    req.accountTermsIdempotencyKey = parsed.data;
    next();
  },
  acceptAccountTermsController,
);
