import { describe, expect, it } from 'vitest';

import { billingOverview } from '../src/tenancy/billing';

describe('billing overview plan contract', () => {
  it('accepts Free and paid plan identities and rejects mismatched names', () => {
    const starter = {
      code: 'starter',
      name: 'Starter',
      monthly_minor: '14900',
      currency: 'PHP',
      physical_assets_max: 125,
      frontdesk_seats_max: 0,
      trial_days: 14,
    };
    const free = {
      code: 'free',
      name: 'Free',
      monthly_minor: '0',
      currency: 'PHP',
      physical_assets_max: 20,
      frontdesk_seats_max: 0,
      trial_days: 0,
    };
    const standard = {
      ...starter,
      code: 'standard',
      name: 'Standard',
      monthly_minor: '29900',
      physical_assets_max: 300,
      frontdesk_seats_max: 3,
    };

    const growth = {
      ...starter,
      code: 'growth',
      name: 'Growth',
      monthly_minor: '49900',
      physical_assets_max: 500,
      frontdesk_seats_max: 5,
    };
    const scale = {
      ...starter,
      code: 'scale',
      name: 'Scale',
      monthly_minor: '99900',
      physical_assets_max: 1000,
      frontdesk_seats_max: 8,
    };

    expect(billingOverview.shape.plan.safeParse(starter).success).toBe(true);
    expect(billingOverview.shape.plan.safeParse(standard).success).toBe(true);
    expect(billingOverview.shape.plan.safeParse(growth).success).toBe(true);
    expect(billingOverview.shape.plan.safeParse(scale).success).toBe(true);
    expect(billingOverview.shape.plan.safeParse(free).success).toBe(true);
    expect(billingOverview.shape.plan.safeParse({ ...starter, name: 'Standard' }).success).toBe(false);
  });

  it('accepts an open-ended Free subscription without a current period end', () => {
    expect(
      billingOverview.shape.subscription.safeParse({
        status: 'active',
        trial_ends_at: null,
        read_only_until: null,
        current_period_end: null,
      }).success,
    ).toBe(true);
  });

  it('reads usage when an API sends it and still reads a response from an API without it', () => {
    const usage = billingOverview.shape.usage;
    expect(usage.safeParse(undefined).success).toBe(true);
    expect(usage.safeParse({ active_garments: 12, frontdesk_seats_used: 0 }).success).toBe(true);
    expect(usage.safeParse({ active_garments: -1, frontdesk_seats_used: 0 }).success).toBe(false);
    expect(usage.safeParse({ active_garments: 1, frontdesk_seats_used: 0, extra: 1 }).success).toBe(false);
  });
});
