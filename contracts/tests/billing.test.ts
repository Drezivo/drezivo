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

    expect(billingOverview.shape.plan.safeParse(starter).success).toBe(true);
    expect(billingOverview.shape.plan.safeParse(standard).success).toBe(true);
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
});
