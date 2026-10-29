import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import {
  assertFrontDeskSeatCapacity,
  assertPlanFeatureEnabled,
  assertPhysicalAssetCapacity,
  resolvePlanEntitlements,
} from '../entitlements.service.js';

const enabledStorefrontFeatures = [
  { capability: 'fittings.enabled', limit_value: 1, enabled: true },
  { capability: 'storefront_reservations.enabled', limit_value: 1, enabled: true },
  { capability: 'storefront_payments.enabled', limit_value: 1, enabled: true },
  { capability: 'storefront_theme.ivory', limit_value: 1, enabled: true },
  { capability: 'storefront_theme.sage', limit_value: 1, enabled: true },
  { capability: 'storefront_theme.blush', limit_value: 1, enabled: true },
  { capability: 'storefront_theme.noir', limit_value: 1, enabled: true },
];

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
              monthly_minor: 29900,
              currency: 'PHP',
              active: true,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { capability: 'physical_assets.max', limit_value: 125, enabled: true },
            { capability: 'frontdesk_seats.max', limit_value: null, enabled: false },
          ],
        }),
    } as unknown as PoolClient;

    await expect(resolvePlanEntitlements(client, 'starter')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('accepts an Owner-only plan with zero Front Desk seats', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'plan-1',
              code: 'starter',
              version: 1,
              monthly_minor: 29900,
              currency: 'PHP',
              active: true,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { capability: 'physical_assets.max', limit_value: 125, enabled: true },
            { capability: 'frontdesk_seats.max', limit_value: 0, enabled: true },
            ...enabledStorefrontFeatures,
          ],
        }),
    } as unknown as PoolClient;

    await expect(resolvePlanEntitlements(client, 'starter')).resolves.toMatchObject({
      physicalAssetsMax: 125,
      frontdeskSeatsMax: 0,
    });
  });

  it('rejects a negative Front Desk seat entitlement', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'plan-1',
              code: 'starter',
              version: 1,
              monthly_minor: 29900,
              currency: 'PHP',
              active: true,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { capability: 'physical_assets.max', limit_value: 125, enabled: true },
            { capability: 'frontdesk_seats.max', limit_value: -1, enabled: true },
          ],
        }),
    } as unknown as PoolClient;

    await expect(resolvePlanEntitlements(client, 'starter')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('resolves Free with its bounded garment cap and limited storefront capabilities', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'free-plan',
              code: 'free',
              version: 1,
              monthly_minor: 0,
              currency: 'PHP',
              active: true,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { capability: 'physical_assets.max', limit_value: 20, enabled: true },
            { capability: 'frontdesk_seats.max', limit_value: 0, enabled: true },
            { capability: 'fittings.enabled', limit_value: 0, enabled: true },
            { capability: 'storefront_reservations.enabled', limit_value: 0, enabled: true },
            { capability: 'storefront_payments.enabled', limit_value: 0, enabled: true },
            { capability: 'storefront_theme.ivory', limit_value: 1, enabled: true },
            { capability: 'storefront_theme.sage', limit_value: 1, enabled: true },
            { capability: 'storefront_theme.blush', limit_value: 0, enabled: true },
            { capability: 'storefront_theme.noir', limit_value: 0, enabled: true },
          ],
        }),
    } as unknown as PoolClient;

    await expect(resolvePlanEntitlements(client, 'free')).resolves.toMatchObject({
      planCode: 'free',
      monthlyMinor: 0,
      physicalAssetsMax: 20,
      frontdeskSeatsMax: 0,
      features: {
        fittings: false,
        storefront_reservations: false,
        storefront_payments: false,
        storefront_themes: ['ivory', 'sage'],
      },
    });
  });

  it.each(['storefront_reservations', 'storefront_payments'] as const)('rejects direct use of the disabled Free capability %s', async (feature) => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'free-plan',
              code: 'free',
              version: 1,
              monthly_minor: 0,
              currency: 'PHP',
              active: true,
              subscription_status: 'active',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { capability: 'physical_assets.max', limit_value: 20, enabled: true },
            { capability: 'frontdesk_seats.max', limit_value: 0, enabled: true },
            { capability: 'fittings.enabled', limit_value: 0, enabled: true },
            { capability: 'storefront_reservations.enabled', limit_value: 0, enabled: true },
            { capability: 'storefront_payments.enabled', limit_value: 0, enabled: true },
            { capability: 'storefront_theme.ivory', limit_value: 1, enabled: true },
            { capability: 'storefront_theme.sage', limit_value: 1, enabled: true },
            { capability: 'storefront_theme.blush', limit_value: 0, enabled: true },
            { capability: 'storefront_theme.noir', limit_value: 0, enabled: true },
          ],
        }),
    } as unknown as PoolClient;

    await expect(assertPlanFeatureEnabled(client, 'tenant-id', feature)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('rejects a Free asset activation that would exceed the 20-piece limit', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'tenant-id' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'free-plan',
              code: 'free',
              version: 1,
              monthly_minor: 0,
              currency: 'PHP',
              active: true,
              subscription_status: 'active',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { capability: 'physical_assets.max', limit_value: 20, enabled: true },
            { capability: 'frontdesk_seats.max', limit_value: 0, enabled: true },
            { capability: 'fittings.enabled', limit_value: 0, enabled: true },
            { capability: 'storefront_reservations.enabled', limit_value: 0, enabled: true },
            { capability: 'storefront_payments.enabled', limit_value: 0, enabled: true },
            { capability: 'storefront_theme.ivory', limit_value: 1, enabled: true },
            { capability: 'storefront_theme.sage', limit_value: 1, enabled: true },
            { capability: 'storefront_theme.blush', limit_value: 0, enabled: true },
            { capability: 'storefront_theme.noir', limit_value: 0, enabled: true },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: 20 }] }),
    } as unknown as PoolClient;

    await expect(assertPhysicalAssetCapacity(client, 'tenant-id', 1)).rejects.toMatchObject({
      code: 'CAPACITY_CONFLICT',
    });
  });

  it('rejects reserving a Front Desk seat when the plan allows zero seats', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'tenant-id' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'starter-plan',
              code: 'starter',
              version: 1,
              monthly_minor: 14900,
              currency: 'PHP',
              active: true,
              subscription_status: 'trialing',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { capability: 'physical_assets.max', limit_value: 125, enabled: true },
            { capability: 'frontdesk_seats.max', limit_value: 0, enabled: true },
            ...enabledStorefrontFeatures,
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }),
    } as unknown as PoolClient;

    await expect(assertFrontDeskSeatCapacity(client, 'tenant-id', 1)).rejects.toMatchObject({
      code: 'CAPACITY_CONFLICT',
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
            monthly_minor: 29900,
            currency: 'PHP',
            active: true,
            ...override,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { capability: 'physical_assets.max', limit_value: 125, enabled: true },
          { capability: 'frontdesk_seats.max', limit_value: 0, enabled: true },
        ],
      });
    const client = { query } as unknown as PoolClient;

    await expect(resolvePlanEntitlements(client, 'starter')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });
});
