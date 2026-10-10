import { describe, expect, it } from 'vitest';

import { billingOverview } from '../src/tenancy/billing';

describe('billing overview plan contract', () => {
  it('accepts both current plan identities and rejects mismatched names', () => {
    const starter = {
      code: 'starter',
      name: 'Starter',
      monthly_minor: '14900',
      currency: 'PHP',
      physical_assets_max: 125,
      frontdesk_seats_max: 0,
      trial_days: 14,
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
    expect(billingOverview.shape.plan.safeParse({ ...starter, name: 'Standard' }).success).toBe(false);
  });
});
