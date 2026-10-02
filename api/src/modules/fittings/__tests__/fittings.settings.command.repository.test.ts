import type { PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { insertFittingCapacityClaimsForRebalance } from '../fittings.settings.command.repository.js';

describe('fitting capacity rebalance repository', () => {
  it('inserts claims for many fittings in one database round trip', async () => {
    const assignments = Array.from({ length: 24 }, (_, index) => ({
      allocationId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      fittingId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      slotId: `20000000-0000-4000-8000-${String((index % 3) + 1).padStart(12, '0')}`,
      startsAt: '2099-01-05T01:00:00.000Z',
      endsAt: '2099-01-05T02:00:00.000Z',
    }));
    const query = vi.fn().mockResolvedValue({
      rows: assignments.map(({ fittingId }) => ({ fitting_id: fittingId })),
    } satisfies Partial<QueryResult<{ fitting_id: string }>>);
    const client = { query } as unknown as PoolClient;

    const inserted = await insertFittingCapacityClaimsForRebalance(client, {
      tenantId: '30000000-0000-4000-8000-000000000001',
      assignments,
    });

    expect(inserted).toBe(assignments.length);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('FROM unnest(');
    expect(query.mock.calls[0]?.[1]).toEqual([
      '30000000-0000-4000-8000-000000000001',
      assignments.map(({ allocationId }) => allocationId),
      assignments.map(({ fittingId }) => fittingId),
      assignments.map(({ slotId }) => slotId),
      assignments.map(({ startsAt }) => startsAt),
      assignments.map(({ endsAt }) => endsAt),
    ]);
  });

  it('avoids a database round trip when there are no claims to insert', async () => {
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;

    await expect(
      insertFittingCapacityClaimsForRebalance(client, {
        tenantId: '30000000-0000-4000-8000-000000000001',
        assignments: [],
      }),
    ).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
