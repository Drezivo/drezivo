import type { Request, Response } from 'express';

import type { ErrorCode, FieldError } from './errors.js';

/**
 * Shared response envelope (TRD §4, @drezivo/contracts `common/envelope`). Every route
 * handler in every module returns through these two helpers so success and failure shapes
 * never drift between features. One parse path for clients: discriminate on `success`.
 */

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  request_id: string;
}

export interface FailureEnvelope {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    fields?: FieldError[];
  };
  request_id: string;
}

/**
 * No-content mutations (archive, cancel, confirm...) pass `data: null` with HTTP 200 so the
 * envelope — and idempotent replays of it — stay uniform; there is no ad-hoc 204 branch.
 */
export function sendSuccess<T>(req: Request, res: Response, data: T, status = 200): void {
  const body: SuccessEnvelope<T> = { success: true, data, request_id: req.requestId };
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
  const body: FailureEnvelope = {
    success: false,
    error: fields ? { code, message, fields } : { code, message },
    request_id: requestId,
  };
  res.status(status).json(body);
}
