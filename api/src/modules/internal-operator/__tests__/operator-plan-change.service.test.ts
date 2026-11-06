import { describe, expect, it } from 'vitest';

import {
  assertOperatorPlanChangeEligible,
  operatorPlanReplayStatus,
  operatorPlanRequestFingerprint,
} from '../operator-plan-change.service.js';
import { operatorPlanCode } from '../operator-plan.schema.js';

const now = new Date('2026-10-31T00:00:00.000Z');

describe('operator plan change policy', () => {
  it('allows only an active tenant with an unexpired trial and no pending payment', () => {
    expect(() => assertOperatorPlanChangeEligible({
      tenantStatus: 'active', subscriptionStatus: 'trialing',
      trialEndsAt: new Date('2026-11-01T00:00:00.000Z'), now, pendingPayment: false,
    })).not.toThrow();
  });

  it.each([
    { tenantStatus: 'restricted', subscriptionStatus: 'trialing', trialEndsAt: new Date('2026-11-01T00:00:00.000Z'), pendingPayment: false },
    { tenantStatus: 'active', subscriptionStatus: 'active', trialEndsAt: new Date('2026-11-01T00:00:00.000Z'), pendingPayment: false },
    { tenantStatus: 'active', subscriptionStatus: 'trialing', trialEndsAt: new Date('2026-10-30T00:00:00.000Z'), pendingPayment: false },
  ])('rejects an ineligible tenant or subscription state', (input) => {
    expect(() => assertOperatorPlanChangeEligible({ ...input, now })).toThrow();
  });

  it('blocks plan changes while a payment is waiting for review', () => {
    expect(() => assertOperatorPlanChangeEligible({
      tenantStatus: 'active', subscriptionStatus: 'trialing',
      trialEndsAt: new Date('2026-11-01T00:00:00.000Z'), now, pendingPayment: true,
    })).toThrow('Resolve the pending subscription payment');
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
