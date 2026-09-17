import type { ErrorRequestHandler, RequestHandler } from 'express';

import { RateLimitedError } from '../../shared/errors.js';
import { sendError } from '../../shared/response.js';

const genericRejectionMessage = 'Webhook request could not be accepted.';

export const requireClerkJsonContentType: RequestHandler = (req, res, next): void => {
  if (!req.is('application/json')) {
    sendError(res, 422, 'VALIDATION_FAILED', genericRejectionMessage, req.requestId);
    return;
  }
  next();
};

/** Keeps raw-parser failures indistinguishable from signature and event validation failures. */
export const handleClerkRawBodyError: ErrorRequestHandler = (error, req, res, next): void => {
  if (error instanceof RateLimitedError) {
    next(error);
    return;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof (error as { type?: unknown }).type === 'string'
  ) {
    sendError(res, 422, 'VALIDATION_FAILED', genericRejectionMessage, req.requestId);
    return;
  }
  next(error);
};
