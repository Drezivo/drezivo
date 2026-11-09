import { describe, expect, it } from 'vitest';

import {
  assertOperatorPlanChangeEligible,
  operatorPlanReplayStatus,
  operatorPlanRequestFingerprint,
} from '../operator-plan-change.service.js';
import { operatorPlanCode } from '../operator-plan.schema.js';

const now = new Date('2026-10-31T00:00:00.000Z');

describe('operator plan change policy', () => {
  const eligible = {
    tenantStatus: 'active', subscriptionStatus: 'trialing', currentPlanCode: 'starter',
    trialEndsAt: new Date('2026-11-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-11-30T00:00:00.000Z'), now, pendingPayment: false,
  };

  it('allows current trials and paid periods for an active business', () => {
    expect(() => assertOperatorPlanChangeEligible(eligible)).not.toThrow();
    expect(() => assertOperatorPlanChangeEligible({ ...eligible, subscriptionStatus: 'active' })).not.toThrow();
  });

  it.each([
    { tenantStatus: 'restricted' },
    { tenantStatus: 'cancelled' },
    { subscriptionStatus: 'restricted' },
    { subscriptionStatus: 'cancelled' },
    { currentPlanCode: 'free', subscriptionStatus: 'active' },
    { trialEndsAt: new Date('2026-10-30T00:00:00.000Z') },
    { subscriptionStatus: 'active', currentPeriodEnd: new Date('2026-10-30T00:00:00.000Z') },
    { subscriptionStatus: 'active', currentPeriodEnd: null },
  ])('rejects ineligible state %o', (input) => {
    expect(() => assertOperatorPlanChangeEligible({ ...eligible, ...input })).toThrow();
  });

  it.each(['trialing', 'active'])('blocks a pending payment for %s subscriptions', (subscriptionStatus) => {
    expect(() => assertOperatorPlanChangeEligible({ ...eligible, subscriptionStatus, pendingPayment: true }))
      .toThrow('Resolve the pending subscription payment');
  });

  it('limits the operator selector contract to the four paid catalog tiers', () => {
    expect(operatorPlanCode.options).toEqual(['starter', 'standard', 'growth', 'scale']);
    expect(operatorPlanCode.safeParse('free').success).toBe(false);
    expect(operatorPlanCode.safeParse('enterprise').success).toBe(false);
  });

  it('replays the same completed intent and rejects reused keys with a different body', () => {
    const fingerprint = operatorPlanRequestFingerprint({ planCode: 'standard', reason: null });
    const completed = { resource_id: 'tenant-1', request_fingerprint: fingerprint, status: 'completed' };
    expect(operatorPlanReplayStatus(completed, 'tenant-1', fingerprint)).toBe('replay');
    expect(() => operatorPlanReplayStatus(completed, 'tenant-1', operatorPlanRequestFingerprint({ planCode: 'starter', reason: null }))).toThrow('already used');
    expect(operatorPlanRequestFingerprint({ planCode: 'standard', reason: null })).not.toBe(operatorPlanRequestFingerprint({ planCode: 'standard', reason: 'Support request' }));
  });
});
