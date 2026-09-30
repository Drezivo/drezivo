/** Authoritative v1 lifecycle durations. Keep these values named and shared by bootstrap and gates. */
export const TRIAL_DURATION_DAYS = 14;
export const PAST_DUE_GRACE_DURATION_DAYS = 7;

/**
 * Pilot billing derives access at request time (./access.ts), so nothing may move a subscription
 * to past_due/restricted on a timer anymore: a sweep would restrict tenants (tenant.status) that
 * the access model deliberately keeps read-only. The sweep and its inline callers stay in the code
 * behind this switch so the old lifecycle can return by flipping it, without a rewrite.
 */
export const SUBSCRIPTION_LIFECYCLE_SWEEP_ENABLED = false;
