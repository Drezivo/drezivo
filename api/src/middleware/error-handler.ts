import type { NextFunction, Request, Response } from 'express';

import { isAppError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { sendError } from '../shared/response.js';

/**
 * The ONLY place an error becomes an HTTP response (AGENTS.md: "Errors should be thrown and
 * handled by the global error handler ... Do not use repeated try/catch blocks in every
 * controller"). Mounted last in app.ts, after every route.
 *
 * Never forwards a raw error message for an unrecognized error: a driver/ORM error can leak
 * schema details or another tenant's identifiers in its message (TRD §4: "Never return raw
 * SQL errors or foreign-key information that identifies another tenant"). Only `AppError`
 * subclasses' messages — which are always hand-written by the code that threw them — are
 * considered safe to return verbatim.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error middleware by arity (4 params); `next` must stay in the signature even though it is unused.
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (isAppError(err)) {
    if (err.status >= 500) {
      logger.error({ err, requestId: req.requestId, route: req.originalUrl }, 'request failed');
    } else {
      logger.warn({ code: err.code, requestId: req.requestId, route: req.originalUrl }, err.message);
    }
    sendError(res, err.status, err.code, err.message, req.requestId, err.fields);
    return;
  }

  logger.error({ err, requestId: req.requestId, route: req.originalUrl }, 'unhandled error');
  sendError(res, 503, 'DEPENDENCY_UNAVAILABLE', 'Something went wrong. Please try again.', req.requestId);
}
