/**
 * TRD §4 — "Errors use a stable envelope: code, safe message, request_id,
 * optional field errors. Use 401 unauthenticated, 403 unauthorized, 404 for
 * concealed foreign objects, 409 capacity/state/idempotency conflict, 422
 * invalid inputs, 429 throttled, 503 unavailable dependency. Never return
 * raw SQL errors or foreign-key information that identifies another tenant."
 *
 * `ErrorCode` is a closed enum, not a free-text string, so a client can
 * `switch` on it exhaustively and a new server-side failure mode cannot
 * silently appear as an unhandled string the UI has never seen.
 */
import { z } from 'zod';

/**
 * One member per distinct failure category the API contract exposes.
 * Deliberately coarser than raw HTTP status: `CAPACITY_CONFLICT` and
 * `STATE_CONFLICT` both map to 409 but are distinguishable business
 * outcomes a UI renders differently ("someone else took that garment" vs
 * "this booking already moved on").
 */
export const errorCode = z.enum([
  // 401 — unauthenticated
  'UNAUTHENTICATED',
  // 403 — unauthorized (authenticated, but forbidden for this actor/scope)
  'FORBIDDEN',
  // 404 — resource missing or concealed cross-tenant (never distinguished on the wire)
  'NOT_FOUND',
  // 409 — a concurrent conflict, one of three business-distinct reasons
  'CONFLICT',
  'CAPACITY_CONFLICT',
  'STATE_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'TRIAL_CONSUMED',
  'CURRENT_OWNED_TENANT_EXISTS',
  'INCOMPLETE_ONBOARDING_EXISTS',
  'SEAT_LIMIT_EXCEEDED',
  'ASSET_LIMIT_EXCEEDED',
  'INVALID_INVITATION',
  'STALE_PROVIDER_STATE',
  'TENANT_RESTRICTED',
  'TENANT_CANCELLED',
  'LAST_OWNER_CONFLICT',
  'OPERATOR_APPROVAL_REQUIRED',
  // 422 — the request body failed validation
  'VALIDATION_FAILED',
  // 429 — rate limited
  'RATE_LIMITED',
  // 501 — the route is part of the contract but this api build has not implemented it yet
  'NOT_IMPLEMENTED',
  // 503 — an upstream dependency (DB, S3, email, payment rail) is unavailable
  'DEPENDENCY_UNAVAILABLE',
  // 500 — unexpected failure with no safe, more specific code to report
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof errorCode>;

/** One field-level validation failure, for `422 VALIDATION_FAILED` responses. */
export const errorField = z.object({
  field: z.string().min(1),
  message: z.string().min(1),
});
export type ErrorField = z.infer<typeof errorField>;

/**
 * The failure details nested under `error` in every failure response.
 * `message` is always safe to display — never a raw SQL error, stack trace,
 * or cross-tenant foreign-key detail (TRD §4).
 */
export const errorObject = z.object({
  code: errorCode,
  message: z.string().min(1),
  fields: z.array(errorField).optional(),
});
export type ErrorObject = z.infer<typeof errorObject>;

/**
 * The single failure envelope every endpoint returns on failure:
 * `{ success: false, error: { code, message, fields? }, request_id }`.
 * `request_id` lets a support agent correlate a customer report with server
 * logs without needing any PII in the report itself.
 */
export const errorEnvelope = z.object({
  success: z.literal(false),
  error: errorObject,
  request_id: z.string().min(1),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelope>;
