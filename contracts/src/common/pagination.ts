/**
 * TRD §4 — "Restrict content types, body size, pagination and filters."
 * TRD §9 — "Start with indexed tenant queries, bounded calendar windows,
 * keyset pagination and optimized images."
 *
 * One fixed page-meta shape for every list endpoint in the contract. If each
 * module invented its own pagination envelope, every consumer would need a
 * per-endpoint adapter just to render a "next page" button. Keyset
 * (cursor-based) pagination is used, not offset/limit — offset pagination
 * degrades at scale (TRD §9 "ask what happens at 100x") and produces
 * skipped/duplicated rows under concurrent writes to the same list.
 */
import { z } from 'zod';

/** Request-side paging controls, embedded into each module's query schema. */
export const paginationRequest = z.object({
  /** Opaque cursor from a previous response's `pageMeta.nextCursor`. Omit for the first page. */
  cursor: z.string().min(1).optional(),
  /** Page size. Bounded so no client can force an unbounded scan. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationRequest = z.infer<typeof paginationRequest>;

/**
 * The one page-meta shape every list response embeds under `pageMeta`.
 * `nextCursor` is `null` (not absent) on the last page, so a client can
 * `if (pageMeta.nextCursor)` without an `in` check.
 */
export const pageMeta = z.object({
  next_cursor: z.string().min(1).nullable(),
  has_more: z.boolean(),
});
export type PageMeta = z.infer<typeof pageMeta>;

/**
 * Builds a paginated list response schema for a given item schema:
 * `{ items: T[], page_meta: PageMeta }`. Every module's list endpoint wraps
 * its item schema with this instead of inventing its own envelope.
 */
export function paginatedResponse<Item extends z.ZodTypeAny>(item: Item) {
  return z.object({
    items: z.array(item),
    page_meta: pageMeta,
  });
}
