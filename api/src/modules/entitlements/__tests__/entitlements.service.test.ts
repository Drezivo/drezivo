import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import {
  assertFrontDeskSeatCapacity,
  assertPhysicalAssetCapacity,
  resolvePlanEntitlements,
} from '../entitlements.service.js';

describe('entitlement service', () => {
  it('rejects invalid quota increments before touching the database', async () => {
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;

    await expect(assertPhysicalAssetCapacity(client, 'tenant-id', 0)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(assertFrontDeskSeatCapacity(client, 'tenant-id', 1.5)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed for an unknown plan code', async () => {
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;

    await expect(resolvePlanEntitlements(client, 'enterprise')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when a required entitlement is disabled or non-numeric', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'plan-1',
              code: 'starter',
              version: 1,
              monthly_minor: 30000,
              currency: 'PHP',
              active: true,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { capability: 'physical_assets.max', limit_value: 75, enabled: true },
            { capability: 'frontdesk_seats.max', limit_value: null, enabled: false },
          ],
        }),
    } as unknown as PoolClient;

    await expect(resolvePlanEntitlements(client, 'starter')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it.each([
    ['non-v1', { version: 2 }],
    ['inactive', { active: false }],
    ['wrong currency', { currency: 'USD' }],
    ['non-positive price', { monthly_minor: 0 }],
  ])('fails closed for a %s plan definition', async (_label, override) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'plan-1',
            code: 'starter',
            version: 1,
            monthly_minor: 30000,
            currency: 'PHP',
            active: true,
            ...override,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { capability: 'physical_assets.max', limit_value: 75, enabled: true },
          { capability: 'frontdesk_seats.max', limit_value: 1, enabled: true },
        ],
      });
    const client = { query } as unknown as PoolClient;

    await expect(resolvePlanEntitlements(client, 'starter')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });
});
