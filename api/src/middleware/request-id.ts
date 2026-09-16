import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

/**
 * Every response — success or error — carries the same `request_id` (TRD §4 error envelope).
 * Generated once, first in the middleware chain, so it is available to every downstream
 * handler and to the error handler even when validation/auth fails before reaching a route.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
