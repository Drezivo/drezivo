import type { PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createFittingAppointmentBase } from '../fittings.command.repository.js';

describe('fitting command repository', () => {
  it.each([1, 3])('inserts %i fitting lines in one bulk query', async (count) => {
    const garments = Array.from({ length: count }, (_, index) => ({
      lineId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      variantId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      assetId: index === 0 ? null : `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      guaranteed: false,
    }));
    const query = vi.fn().mockResolvedValue({ rows: [] } satisfies Partial<QueryResult>);
    const client = { query } as unknown as PoolClient;

    await createFittingAppointmentBase(client, {
      fittingId: '30000000-0000-4000-8000-000000000001',
      tenantId: '40000000-0000-4000-8000-000000000001',
      branchId: '50000000-0000-4000-8000-000000000001',
      customerId: '60000000-0000-4000-8000-000000000001',
      startsAt: '2099-01-05T01:00:00.000Z',
      endsAt: '2099-01-05T02:00:00.000Z',
      timezoneSnapshot: 'Asia/Manila',
      currency: 'PHP',
      feeMinor: 0,
      internalNote: null,
      businessKey: `fitting:${count}`,
      garments,
      chargeId: '70000000-0000-4000-8000-000000000001',
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain('FROM unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::boolean[])');
    expect(query.mock.calls[1]?.[1]).toEqual([
      '40000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      garments.map(({ lineId }) => lineId),
      garments.map(({ variantId }) => variantId),
      garments.map(({ assetId }) => assetId),
      garments.map(({ guaranteed }) => guaranteed),
    ]);
  });
});
