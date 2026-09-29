import type { ErrorCode, ErrorField } from '@drezivo/contracts';

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

/** 409 — the tenant is temporarily restricted; the shared action policy decides what survives. */
export class TenantRestrictedError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'TENANT_RESTRICTED';
}

/** 409 — the tenant is permanently closed; only explicitly allowed settlement/export reads survive. */
export class TenantCancelledError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'TENANT_CANCELLED';
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

/** 409 — the requested appointment interval violates branch fitting hours or a closure. */
export class ScheduleConflictError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'SCHEDULE_CONFLICT';
}

/** 409 — illegal state transition, a stale `version` on a conditional update, or lost claim contention. */
export class StateConflictError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'STATE_CONFLICT';
}

/** 409 — the reservation hold deadline has passed and cannot be revived. */
export class HoldExpiredError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'HOLD_EXPIRED';
}

/** 409 — the requested reservation state change is not legal from the current state. */
export class InvalidReservationTransitionError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'INVALID_RESERVATION_TRANSITION';
}

/** 409 — the selected garment is not currently eligible for the requested booking operation. */
export class AssetUnavailableError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'ASSET_UNAVAILABLE';
}

/** 409 — physical readiness prevents the requested handover/booking operation. */
export class AssetUnreadyError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'ASSET_UNREADY';
}

/** 409 — required verified collection/evidence state has not been satisfied. */
export class PaymentPrerequisiteFailedError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'PAYMENT_PREREQUISITE_FAILED';
}

/** 409 — same idempotency key replayed with a different canonical request hash. */
export class IdempotencyKeyReusedError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'IDEMPOTENCY_KEY_REUSED';
}

/** 409 — a tenant-local clothing/style code already belongs to another product. */
export class DuplicateClothingCodeError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'DUPLICATE_CLOTHING_CODE';
}

/** 422 — the selected category is not a valid category for this tenant/action. */
export class InvalidCategoryError extends AppError {
  readonly status = 422;
  readonly code: ErrorCode = 'INVALID_CATEGORY';
}

/** 422 — the selected reusable measurement guide is unavailable for this tenant/action. */
export class InvalidMeasurementGuideError extends AppError {
  readonly status = 422;
  readonly code: ErrorCode = 'INVALID_MEASUREMENT_GUIDE';
}

/** 409 — retirement/archive cannot proceed while physical custody remains unresolved. */
export class UnresolvedCustodyError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'UNRESOLVED_CUSTODY';
}

/** 409 — an optimistic catalogue write targeted a stale version/timestamp. */
export class StaleVersionError extends AppError {
  readonly status = 409;
  readonly code: ErrorCode = 'STALE_VERSION';
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

/** 503 — a required downstream dependency (DB, Clerk, object storage) is unavailable. Never expose internals. */
export class DependencyUnavailableError extends AppError {
  readonly status = 503;
  readonly code: ErrorCode = 'DEPENDENCY_UNAVAILABLE';
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
