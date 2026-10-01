import {
  READ_ONLY_ACCESS_DAYS,
  STOREFRONT_GRACE_DAYS,
  SUBSCRIPTION_REMINDER_DAYS,
  type SubscriptionAccess,
  type SubscriptionStatus,
} from '@drezivo/contracts';

/**
 * Pilot access model: what a workspace may do is DERIVED from its subscription at request time.
 * No background job moves a subscription between states, so a stopped worker can never leave a
 * shop locked (or unlocked) by mistake, and every request sees the same answer for the same row.
 *
 * "End" is the trial end while trialing, otherwise the paid-through date (`current_period_end`):
 *   now < end                      full       (last SUBSCRIPTION_REMINDER_DAYS carry a reminder)
 *   operator extension > now       read_only  (storefront online until the extension ends)
 *   end <= now < end + 30 days     read_only  (storefront online for the first 3 days only)
 *   end + 30 days <= now           locked     (only subscribing is possible)
 *   cancelled                      locked
 * `grace_ends_at` is repurposed as the operator-granted "read-only until" extension.
 */
export interface AccessSubscription {
  status: SubscriptionStatus;
  trial_ends_at: Date | null;
  /** Operator-granted read-only extension end (stored in `subscription.grace_ends_at`). */
  grace_ends_at: Date | null;
  current_period_end: Date;
  pending_payment: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function accessOf(subscription: AccessSubscription, now: Date): SubscriptionAccess {
  const pending = subscription.pending_payment;
  if (subscription.status === 'cancelled') {
    return locked('cancelled', pending);
  }

  const trialing = subscription.status === 'trialing';
  // Bootstrap writes trial_ends_at and current_period_end as the same instant; the fallback only
  // guards a malformed trialing row, which must still resolve to a definite state.
  const end = trialing ? (subscription.trial_ends_at ?? subscription.current_period_end) : subscription.current_period_end;
  const nowMs = now.getTime();
  const endMs = end.getTime();

  if (nowMs < endMs) {
    const reminding = endMs - nowMs <= SUBSCRIPTION_REMINDER_DAYS * DAY_MS;
    const reason = trialing ? (reminding ? 'trial_ending' : 'trial') : reminding ? 'renewal_due' : 'paid';
    return {
      level: 'full',
      reason,
      ends_at: end.toISOString(),
      days_left: daysLeft(endMs, nowMs),
      pending_payment: pending,
      storefront_online: true,
      storefront_offline_at: null,
      read_only_until: null,
    };
  }

  const readOnlyEndMs = endMs + READ_ONLY_ACCESS_DAYS * DAY_MS;
  const storefrontGraceEndMs = endMs + STOREFRONT_GRACE_DAYS * DAY_MS;
  const extensionMs = subscription.grace_ends_at?.getTime() ?? null;

  if (extensionMs !== null && extensionMs > nowMs && extensionMs > endMs) {
    // After the extension the normal timeline resumes, so the later of the two instants wins.
    return {
      level: 'read_only',
      reason: 'trial_extension',
      ends_at: iso(extensionMs),
      days_left: daysLeft(extensionMs, nowMs),
      pending_payment: pending,
      storefront_online: true,
      storefront_offline_at: iso(Math.max(extensionMs, storefrontGraceEndMs)),
      read_only_until: iso(Math.max(extensionMs, readOnlyEndMs)),
    };
  }

  const lapsedReason = trialing ? 'trial_ended' : 'payment_overdue';
  if (nowMs < readOnlyEndMs) {
    const storefrontOnline = nowMs < storefrontGraceEndMs;
    return {
      level: 'read_only',
      reason: lapsedReason,
      ends_at: iso(readOnlyEndMs),
      days_left: daysLeft(readOnlyEndMs, nowMs),
      pending_payment: pending,
      storefront_online: storefrontOnline,
      storefront_offline_at: storefrontOnline ? iso(storefrontGraceEndMs) : null,
      read_only_until: iso(readOnlyEndMs),
    };
  }
  return locked(lapsedReason, pending);
}

function locked(reason: SubscriptionAccess['reason'], pending: boolean): SubscriptionAccess {
  return {
    level: 'locked',
    reason,
    ends_at: null,
    days_left: null,
    pending_payment: pending,
    storefront_online: false,
    storefront_offline_at: null,
    read_only_until: null,
  };
}

/** Whole days remaining, rounded down: 0 during the final 24 hours. */
function daysLeft(endMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((endMs - nowMs) / DAY_MS));
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
