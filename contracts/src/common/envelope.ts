/**
 * TRD §4 — every endpoint's error path uses one stable envelope (see
 * `errors.ts`). The success path needs the same discipline: one fixed
 * shape, `{ data, request_id }`, so a consumer's HTTP client can unwrap a
 * response without per-endpoint branching, and `request_id` is available on
 * every response — success or failure — for support correlation.
 *
 * `request_id` on a 2xx response is what lets a merchant report "the
 * confirm button did X" and have that map directly to one server log line,
 * without exposing anything sensitive to get there.
 */
import { z } from 'zod';

/**
 * Builds a success-response schema for a given payload schema:
 * `{ data: T, request_id: string }`. List endpoints put a `paginatedResponse`
 * (see `pagination.ts`) in as `T`, so the pagination meta lives inside
 * `data`, not bolted onto the envelope as a second, competing convention.
 */
export function successEnvelope<Data extends z.ZodTypeAny>(data: Data) {
  return z.object({
    data,
    request_id: z.string().min(1),
  });
}
