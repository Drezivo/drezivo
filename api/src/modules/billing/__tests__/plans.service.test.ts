import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listActivePlanRows: vi.fn(),
}));

vi.mock('../plans.repository.js', () => ({
  listActivePlanRows: mocks.listActivePlanRows,
}));

import { DependencyUnavailableError } from '../../../shared/errors.js';
import { getPublicPlanCatalog } from '../plans.service.js';

const rows = [
  {
    code: 'starter',
    monthly_minor: 14900,
    currency: 'PHP',
    capability: 'physical_assets.max',
    limit_value: 125,
    enabled: true,
  },
  {
    code: 'starter',
    monthly_minor: 14900,
    currency: 'PHP',
    capability: 'frontdesk_seats.max',
    limit_value: 0,
    enabled: true,
  },
  {
    code: 'standard',
    monthly_minor: 29900,
    currency: 'PHP',
    capability: 'physical_assets.max',
    limit_value: 300,
    enabled: true,
  },
  {
    code: 'standard',
    monthly_minor: 29900,
    currency: 'PHP',
    capability: 'frontdesk_seats.max',
    limit_value: 3,
    enabled: true,
  },
];

describe('public plan catalog service', () => {
  beforeEach(() => {
    mocks.listActivePlanRows.mockReset();
  });

  it('returns server-owned prices, limits, and trial duration for both plans', async () => {
    mocks.listActivePlanRows.mockResolvedValue(rows);

    await expect(getPublicPlanCatalog()).resolves.toEqual({
      plans: [
        {
          code: 'starter',
          name: 'Starter',
          monthly_price_minor: 14900,
          currency: 'PHP',
          trial_days: 14,
          limits: { active_garments: 125, frontdesk_seats: 0 },
        },
        {
          code: 'standard',
          name: 'Standard',
          monthly_price_minor: 29900,
          currency: 'PHP',
          trial_days: 14,
          limits: { active_garments: 300, frontdesk_seats: 3 },
        },
      ],
    });
  });

  it('fails closed when either active plan or entitlement is missing', async () => {
    mocks.listActivePlanRows.mockResolvedValue(rows.slice(0, 3));

    await expect(getPublicPlanCatalog()).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});
