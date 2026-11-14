import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import { assertOperatorPlanCapacity, type TenantEntitlementSnapshot } from '../entitlements.service.js';

const target = { physicalAssetsMax: 3, frontdeskSeatsMax: 2 } as TenantEntitlementSnapshot;

function clientWithUsage(garments: number, staff: number) {
  const query = vi.fn()
    .mockResolvedValueOnce({ rows: [{ count: garments }] })
    .mockResolvedValueOnce({ rows: [{ count: staff }] });
  return { client: { query } as unknown as PoolClient, query };
}

describe('operator plan capacity', () => {
  it.each([[2, 1], [3, 2]])('allows %i active garments and %i active staff within the target', async (garments, staff) => {
    const { client, query } = clientWithUsage(garments, staff);
    await expect(assertOperatorPlanCapacity(client, 'tenant', target)).resolves.toMatchObject({
      physicalAssets: { current: garments, limit: 3 },
      frontdeskSeats: { current: staff, limit: 2 },
    });
    expect(query.mock.calls[1]?.[0]).toContain("role = 'frontdesk'");
    expect(query.mock.calls[1]?.[0]).toContain("status = 'active'");
    expect(query.mock.calls[1]?.[0]).not.toContain('membership_invitation');
  });

  it.each([
    [4, 2, /active garments: 4 used, 3 allowed/],
    [3, 3, /active Front Desk staff: 3 used, 2 allowed/],
    [4, 3, /active garments: 4 used, 3 allowed; active Front Desk staff: 3 used, 2 allowed/],
  ])('explains limits exceeded by %i garments and %i staff', async (garments, staff, message) => {
    const { client } = clientWithUsage(garments, staff);
    await expect(assertOperatorPlanCapacity(client, 'tenant', target)).rejects.toMatchObject({
      code: 'CAPACITY_CONFLICT', message: expect.stringMatching(message) as unknown,
    });
  });
});
