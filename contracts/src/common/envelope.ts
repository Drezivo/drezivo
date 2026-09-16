/**
 * TRD §4 — every endpoint's response uses one stable envelope, success and
 * failure alike, so a consumer's HTTP client can unwrap any response with a
 * single parse path instead of per-endpoint branching.
 *
 * The envelope is a discriminated union on `success`:
 *   `{ success: true,  data: T, request_id }`
 *   `{ success: false, error: { code, message, fields? }, request_id }`
 * (see `errors.ts` for the failure side). `request_id` is on every response
 * — success or failure — so a merchant can report "the confirm button did
 * X" and have that map directly to one server log line, without exposing
 * anything sensitive to get there.
 */
import { z } from 'zod';

import { errorEnvelope } from './errors';

/**
 * Builds the success-response schema for a given payload schema:
 * `{ success: true, data: T, request_id }`. List endpoints put a
 * `paginatedResponse` (see `pagination.ts`) in as `T`, so the pagination
 * meta lives inside `data`, not bolted onto the envelope as a second,
 * competing convention. No-content mutations use `successEnvelope(z.null())`
 * with HTTP 200 so the envelope — and idempotent replays of it — stay uniform.
 */
export function successEnvelope<Data extends z.ZodTypeAny>(data: Data) {
  return z.object({
    success: z.literal(true),
    data,
    request_id: z.string().min(1),
  });
}

/**
 * The full response schema for an endpoint: everything the server can send
 * for one request, discriminated on `success`. TypeScript consumers narrow
 * with `if (body.success)` and get `body.data` with no null checks; failure
 * gives `body.error` with its closed `code` enum.
 */
export function apiEnvelope<Data extends z.ZodTypeAny>(data: Data) {
  return z.discriminatedUnion('success', [successEnvelope(data), errorEnvelope]);
}
