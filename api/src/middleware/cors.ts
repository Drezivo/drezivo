import type { NextFunction, Request, Response } from 'express';

import { config } from '../config/index.js';
import { ForbiddenError } from '../shared/errors.js';

const allowedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const allowedHeaders = ['authorization', 'content-type', 'idempotency-key', 'x-drezivo-branch-id', 'x-request-id'] as const;
const allowedHeaderSet = new Set<string>(allowedHeaders);
const allowedMethodsHeader = allowedMethods.join(', ');
const allowedHeadersHeader = allowedHeaders.map((header) => header.replace(/(^|-)([a-z])/g, (_, separator: string, character: string) => `${separator}${character.toUpperCase()}`)).join(', ');

function rejectOrigin(): ForbiddenError {
  return new ForbiddenError('This origin is not allowed.');
}

function hasOnlyAllowedHeaders(value: string): boolean {
  return value
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)
    .every((header) => allowedHeaderSet.has(header));
}

/**
 * Exact-match CORS for browser clients. Requests without an Origin header are
 * left untouched for server-to-server callers and health checks.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header('origin');
  if (!origin) {
    next();
    return;
  }

  res.vary('Origin');
  if (!config.CORS_ALLOWED_ORIGINS.includes(origin)) {
    next(rejectOrigin());
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');

  if (req.method !== 'OPTIONS') {
    next();
    return;
  }

  const requestedMethod = req.header('access-control-request-method');
  if (requestedMethod && !allowedMethods.includes(requestedMethod.toUpperCase() as (typeof allowedMethods)[number])) {
    next(rejectOrigin());
    return;
  }

  const requestedHeaders = req.header('access-control-request-headers');
  if (requestedHeaders && !hasOnlyAllowedHeaders(requestedHeaders)) {
    next(rejectOrigin());
    return;
  }

  res.setHeader('Access-Control-Allow-Methods', allowedMethodsHeader);
  res.setHeader('Access-Control-Allow-Headers', allowedHeadersHeader);
  res.setHeader('Access-Control-Max-Age', '600');
  res.status(204).end();
}
