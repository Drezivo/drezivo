import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listActivePlanRows: vi.fn(),
}));

vi.mock('../plans.repository.js', () => ({
  listActivePlanRows: mocks.listActivePlanRows,
  PLAN_CAPABILITIES: [
    'physical_assets.max',
    'frontdesk_seats.max',
    'fittings.enabled',
    'storefront_reservations.enabled',
    'storefront_payments.enabled',
    'storefront_theme.ivory',
    'storefront_theme.sage',
    'storefront_theme.blush',
    'storefront_theme.noir',
  ],
}));

import { DependencyUnavailableError } from '../../../shared/errors.js';
import { getPublicPlanCatalog } from '../plans.service.js';

const capabilities = [
  'physical_assets.max',
  'frontdesk_seats.max',
  'fittings.enabled',
  'storefront_reservations.enabled',
  'storefront_payments.enabled',
  'storefront_theme.ivory',
  'storefront_theme.sage',
  'storefront_theme.blush',
  'storefront_theme.noir',
] as const;

const planRows = (
  code: 'free' | 'starter' | 'standard',
  monthly_minor: number,
  limits: { assets: number; seats: number },
  features: { fittings: boolean; reservations: boolean; payments: boolean; themes: readonly string[] },
) => {
  const values: Record<(typeof capabilities)[number], number> = {
    'physical_assets.max': limits.assets,
    'frontdesk_seats.max': limits.seats,
    'fittings.enabled': Number(features.fittings),
    'storefront_reservations.enabled': Number(features.reservations),
    'storefront_payments.enabled': Number(features.payments),
    'storefront_theme.ivory': Number(features.themes.includes('ivory')),
    'storefront_theme.sage': Number(features.themes.includes('sage')),
    'storefront_theme.blush': Number(features.themes.includes('blush')),
    'storefront_theme.noir': Number(features.themes.includes('noir')),
  };
  return capabilities.map((capability) => ({
    code,
    monthly_minor,
    currency: 'PHP',
    capability,
    limit_value: values[capability],
    enabled: true,
  }));
};

const rows = [
  ...planRows('free', 0, { assets: 20, seats: 0 }, {
    fittings: false,
    reservations: false,
    payments: false,
    themes: ['ivory', 'sage'],
  }),
  ...planRows('starter', 14900, { assets: 125, seats: 0 }, {
    fittings: true,
    reservations: true,
    payments: true,
    themes: ['ivory', 'sage', 'blush', 'noir'],
  }),
  ...planRows('standard', 29900, { assets: 300, seats: 3 }, {
    fittings: true,
    reservations: true,
    payments: true,
    themes: ['ivory', 'sage', 'blush', 'noir'],
  }),
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
          code: 'free',
          name: 'Free',
          monthly_price_minor: 0,
          currency: 'PHP',
          trial_days: 0,
          limits: { active_garments: 20, frontdesk_seats: 0 },
          features: {
            fittings: false,
            storefront_reservations: false,
            storefront_payments: false,
            storefront_themes: ['ivory', 'sage'],
          },
        },
        {
          code: 'starter',
          name: 'Starter',
          monthly_price_minor: 14900,
          currency: 'PHP',
          trial_days: 14,
          limits: { active_garments: 125, frontdesk_seats: 0 },
          features: {
            fittings: true,
            storefront_reservations: true,
            storefront_payments: true,
            storefront_themes: ['ivory', 'sage', 'blush', 'noir'],
          },
        },
        {
          code: 'standard',
          name: 'Standard',
          monthly_price_minor: 29900,
          currency: 'PHP',
          trial_days: 14,
          limits: { active_garments: 300, frontdesk_seats: 3 },
          features: {
            fittings: true,
            storefront_reservations: true,
            storefront_payments: true,
            storefront_themes: ['ivory', 'sage', 'blush', 'noir'],
          },
        },
      ],
    });
  });

  it('fails closed when a plan or one of its required entitlements is missing', async () => {
    mocks.listActivePlanRows.mockResolvedValue(rows.slice(0, capabilities.length - 1));

    await expect(getPublicPlanCatalog()).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});
