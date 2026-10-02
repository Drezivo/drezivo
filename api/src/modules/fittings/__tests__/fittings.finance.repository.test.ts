import type { PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { insertFittingRefundAllocationReversals } from '../fittings.finance.repository.js';

describe('fitting finance repository', () => {
  it.each([1, 3])('inserts %i refund allocation reversals in one ordered query', async (count) => {
    const reversals = Array.from({ length: count }, (_, index) => ({
      allocationId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      amountMinor: (index + 1) * 100,
      reversesId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      businessKey: `refund:20000000-0000-4000-8000-000000000001:allocation-reverse:${index + 1}`,
    }));
    const query = vi
      .fn()
      .mockResolvedValue({ rowCount: count, rows: [] } satisfies Partial<QueryResult>);
    const client = { query } as unknown as PoolClient;

    await expect(
      insertFittingRefundAllocationReversals(client, {
        tenantId: '30000000-0000-4000-8000-000000000001',
        paymentId: '40000000-0000-4000-8000-000000000001',
        chargeId: '50000000-0000-4000-8000-000000000001',
        reversals,
      }),
    ).resolves.toBe(count);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain(
      'FROM unnest($4::uuid[], $5::integer[], $6::uuid[], $7::text[])',
    );
    expect(query.mock.calls[0]?.[0]).toContain('WITH ORDINALITY');
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY reversal.ordinal');
    expect(query.mock.calls[0]?.[1]).toEqual([
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      reversals.map(({ allocationId }) => allocationId),
      reversals.map(({ amountMinor }) => amountMinor),
      reversals.map(({ reversesId }) => reversesId),
      reversals.map(({ businessKey }) => businessKey),
    ]);
  });

  it('does not query when there are no refund allocation reversals', async () => {
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;

    await expect(
      insertFittingRefundAllocationReversals(client, {
        tenantId: '30000000-0000-4000-8000-000000000001',
        paymentId: '40000000-0000-4000-8000-000000000001',
        chargeId: '50000000-0000-4000-8000-000000000001',
        reversals: [],
      }),
    ).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
