import type { PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { readVisibleVariantIds } from '../storefront.repository.js';

describe('storefront catalogue visibility repository', () => {
  it.each([1, 3])('checks %i requested variants in one tenant-scoped query', async (count) => {
    const variantIds = Array.from({ length: count }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const query = vi.fn().mockResolvedValue({
      rows: variantIds.map((variant_id) => ({ variant_id })),
    } satisfies Partial<QueryResult<{ variant_id: string }>>);
    const client = { query } as unknown as PoolClient;

    await expect(readVisibleVariantIds(client, '10000000-0000-4000-8000-000000000001', variantIds)).resolves.toEqual(variantIds);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('v.id = ANY($2::uuid[])');
    expect(query.mock.calls[0]?.[0]).toContain("p.status = 'active'");
    expect(query.mock.calls[0]?.[0]).toContain("c.status = 'active'");
    expect(query.mock.calls[0]?.[1]).toEqual(['10000000-0000-4000-8000-000000000001', variantIds]);
  });

  it('does not issue a query for an empty variant list', async () => {
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;

    await expect(readVisibleVariantIds(client, '10000000-0000-4000-8000-000000000001', [])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
