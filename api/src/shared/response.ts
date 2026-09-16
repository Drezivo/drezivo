import type { Response } from 'express';

import type { ErrorCode, FieldError } from './errors.js';

/**
 * Shared response envelope (TRD §4). Every route handler in every module returns through
 * these two helpers so success and error shapes never drift between features.
 */

export interface SuccessEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
    fields?: FieldError[];
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  status = 200,
  meta?: Record<string, unknown>,
): void {
  const body: SuccessEnvelope<T> = meta ? { data, meta } : { data };
  res.status(status).json(body);
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
  fields?: FieldError[],
): void {
  const body: ErrorEnvelope = {
    error: fields ? { code, message, request_id: requestId, fields } : { code, message, request_id: requestId },
  };
  res.status(status).json(body);
}
