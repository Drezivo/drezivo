/**
 * Typed error hierarchy mapped to the contract envelope:
 *   { success: false, error: { code, message, fields? }, request_id }
 * and the fixed status set: 401 / 403 / 404 / 409 / 422 / 429 / 503.
 *
 * `error-handler.ts` middleware is the ONLY place that turns these into an HTTP response.
 * Throw these from services/repositories; never throw a raw `Error` or a string, and never
 * let a raw database/driver error escape to the client (it can leak schema or other-tenant
 * identifiers). A foreign-tenant object must be raised as NotFoundError, never
 * ForbiddenError — the TRD is explicit that tenant isolation fails closed by concealment,
 * not by a 403 that confirms the object exists.
 */

import type { ErrorCode, ErrorField } from '@drezivo/contracts';

export type { ErrorCode, ErrorField } from '@drezivo/contracts';

/** Backward-compatible API-local name; the contract package owns the shape. */
export type FieldError = ErrorField;

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: ErrorCode;
  readonly fields: FieldError[] | undefined;

  constructor(message: string, fields?: FieldError[]) {
    super(message);
    this.name = new.target.name;
    this.fields = fields;
  }
}

/** 401 — no valid, verified principal. Never redirect; REST always returns JSON. */
export class UnauthenticatedError extends AppError {
  readonly status = 401;
  readonly code: ErrorCode = 'UNAUTHENTICATED';
}

/** 403 — principal is known but the action itself is not permitted (not an object-existence leak). */
export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code: ErrorCode = 'FORBIDDEN';
}

/** 404 — also used for any object that exists but belongs to a different tenant. */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code: ErrorCode = 'NOT_FOUND';
}

/** 409 — another caller took the last capacity for the requested interval. */
export class CapacityConflictError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'CAPACITY_CONFLICT';
}

/** 409 — illegal state transition, a stale `version` on a conditional update, or lost claim contention. */
export class StateConflictError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'STATE_CONFLICT';
}

/** 409 — same idempotency key replayed with a different canonical request hash. */
export class IdempotencyKeyReusedError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'IDEMPOTENCY_KEY_REUSED';
}

/** 422 — well-formed request, semantically invalid input (Zod boundary failures land here). */
export class ValidationError extends AppError {
  readonly status = 422;
  readonly code: ErrorCode = 'VALIDATION_FAILED';
}

/** 429 — throttled; caller should back off. `retryAfterSeconds` is emitted as the Retry-After header. */
export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code: ErrorCode = 'RATE_LIMITED';
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 503 — a required downstream dependency (DB, Clerk, S3) is unavailable. Never expose internals. */
export class DependencyUnavailableError extends AppError {
  readonly status = 503;
  readonly code: ErrorCode = 'DEPENDENCY_UNAVAILABLE';
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
