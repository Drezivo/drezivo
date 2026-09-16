import { z } from 'zod';

/**
 * One fixed pagination shape for every list endpoint (AGENTS.md: "List endpoints must use one
 * fixed pagination meta shape"). Keyset (cursor) pagination, not offset — TRD §9 calls for
 * keyset pagination over bounded windows so list queries stay index-scans at any page depth,
 * unlike `OFFSET n` which degrades linearly with page number.
 */

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PageMeta {
  next_cursor: string | null;
  limit: number;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

/**
 * Builds a page from `limit + 1` fetched rows: if the extra row is present there is a next
 * page, and its cursor field becomes `next_cursor` without a second COUNT/lookahead query.
 */
export function buildPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => string,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    meta: {
      next_cursor: hasMore && last ? cursorOf(last) : null,
      limit,
    },
  };
}
