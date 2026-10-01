import { describe, expect, it } from 'vitest';

import { subscriptionAccess } from '@drezivo/contracts';

import { accessOf, type AccessSubscription } from '../access.js';

const DAY = 24 * 60 * 60 * 1000;
const END = new Date('2026-10-14T04:00:00.000Z');
const at = (offsetMs: number): Date => new Date(END.getTime() + offsetMs);

function trial(overrides: Partial<AccessSubscription> = {}): AccessSubscription {
  return {
    status: 'trialing',
    trial_ends_at: END,
    grace_ends_at: null,
    current_period_end: END,
    pending_payment: false,
    ...overrides,
  };
}

function paid(overrides: Partial<AccessSubscription> = {}): AccessSubscription {
  return trial({ status: 'active', trial_ends_at: null, current_period_end: END, ...overrides });
}

describe('accessOf', () => {
  it('always returns a contract-valid access object', () => {
    const offsets = [-10 * DAY, -3 * DAY, -1, 0, 3 * DAY - 1, 3 * DAY, 30 * DAY - 1, 30 * DAY];
    for (const subscription of [trial(), paid(), trial({ status: 'cancelled' }), paid({ status: 'past_due' })]) {
      for (const offset of offsets) {
        expect(subscriptionAccess.safeParse(accessOf(subscription, at(offset))).success).toBe(true);
      }
    }
  });

  it('gives full access during the trial, with a reminder only in the last three days', () => {
    expect(accessOf(trial(), at(-10 * DAY))).toMatchObject({ level: 'full', reason: 'trial', days_left: 10, ends_at: END.toISOString() });
    expect(accessOf(trial(), at(-3 * DAY - 1))).toMatchObject({ level: 'full', reason: 'trial', days_left: 3 });
    expect(accessOf(trial(), at(-3 * DAY))).toMatchObject({ level: 'full', reason: 'trial_ending', days_left: 3 });
    expect(accessOf(trial(), at(-1))).toMatchObject({ level: 'full', reason: 'trial_ending', days_left: 0, storefront_online: true });
  });

  it('turns read-only at the exact trial end instant, with the storefront online for three days', () => {
    const atEnd = accessOf(trial(), at(0));
    expect(atEnd).toMatchObject({
      level: 'read_only',
      reason: 'trial_ended',
      storefront_online: true,
      storefront_offline_at: at(3 * DAY).toISOString(),
      read_only_until: at(30 * DAY).toISOString(),
      ends_at: at(30 * DAY).toISOString(),
      days_left: 30,
    });
    expect(accessOf(trial(), at(3 * DAY - 1))).toMatchObject({ level: 'read_only', storefront_online: true });
    expect(accessOf(trial(), at(3 * DAY))).toMatchObject({ level: 'read_only', storefront_online: false, storefront_offline_at: null });
  });

  it('locks at exactly thirty days after the end', () => {
    expect(accessOf(trial(), at(30 * DAY - 1))).toMatchObject({ level: 'read_only', days_left: 0 });
    expect(accessOf(trial(), at(30 * DAY))).toEqual({
      level: 'locked',
      reason: 'trial_ended',
      ends_at: null,
      days_left: null,
      pending_payment: false,
      storefront_online: false,
      storefront_offline_at: null,
      read_only_until: null,
    });
  });

  it('keeps the storefront online and read-only access during an operator extension', () => {
    const extension = at(45 * DAY);
    const subscription = trial({ grace_ends_at: extension });
    expect(accessOf(subscription, at(40 * DAY))).toMatchObject({
      level: 'read_only',
      reason: 'trial_extension',
      storefront_online: true,
      ends_at: extension.toISOString(),
      read_only_until: extension.toISOString(),
      storefront_offline_at: extension.toISOString(),
      days_left: 5,
    });
    expect(accessOf(subscription, extension)).toMatchObject({ level: 'locked', reason: 'trial_ended' });
  });

  it('resumes the normal timeline when a short extension ends inside the read-only window', () => {
    const subscription = trial({ grace_ends_at: at(5 * DAY) });
    expect(accessOf(subscription, at(4 * DAY))).toMatchObject({
      reason: 'trial_extension',
      read_only_until: at(30 * DAY).toISOString(),
      storefront_offline_at: at(5 * DAY).toISOString(),
    });
    expect(accessOf(subscription, at(5 * DAY))).toMatchObject({ level: 'read_only', reason: 'trial_ended', storefront_online: false });
  });

  it('ignores an extension that is already over or does not reach past the end', () => {
    expect(accessOf(trial({ grace_ends_at: at(-DAY) }), at(DAY))).toMatchObject({ reason: 'trial_ended' });
    expect(accessOf(trial({ grace_ends_at: at(DAY) }), at(2 * DAY))).toMatchObject({ reason: 'trial_ended' });
    expect(accessOf(trial({ grace_ends_at: at(DAY) }), at(-DAY))).toMatchObject({ level: 'full', reason: 'trial_ending' });
  });

  it('follows the same timeline for a paid period, with renewal and overdue reasons', () => {
    expect(accessOf(paid(), at(-10 * DAY))).toMatchObject({ level: 'full', reason: 'paid' });
    expect(accessOf(paid(), at(-3 * DAY))).toMatchObject({ level: 'full', reason: 'renewal_due' });
    expect(accessOf(paid(), at(0))).toMatchObject({ level: 'read_only', reason: 'payment_overdue', storefront_online: true });
    expect(accessOf(paid(), at(30 * DAY))).toMatchObject({ level: 'locked', reason: 'payment_overdue' });
    expect(accessOf(paid({ status: 'past_due' }), at(DAY))).toMatchObject({ level: 'read_only', reason: 'payment_overdue' });
  });

  it('locks a cancelled subscription regardless of dates', () => {
    expect(accessOf(paid({ status: 'cancelled' }), at(-10 * DAY))).toMatchObject({ level: 'locked', reason: 'cancelled', storefront_online: false });
  });

  it('passes through a pending payment without granting access', () => {
    expect(accessOf(trial({ pending_payment: true }), at(31 * DAY))).toMatchObject({ level: 'locked', pending_payment: true });
    expect(accessOf(trial({ pending_payment: true }), at(-DAY))).toMatchObject({ level: 'full', pending_payment: true });
  });

  it('falls back to the period end for a trialing row without a trial end', () => {
    expect(accessOf(trial({ trial_ends_at: null }), at(-DAY))).toMatchObject({ level: 'full', ends_at: END.toISOString() });
    expect(accessOf(trial({ trial_ends_at: null }), at(DAY))).toMatchObject({ level: 'read_only', reason: 'trial_ended' });
  });
});
