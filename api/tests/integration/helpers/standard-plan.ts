/** Standard remains the legacy customer tier at its existing 299 PHP/month identity and limits. */
export const STANDARD_PLAN = {
  code: 'standard',
  version: 1,
  monthlyMinor: 29900,
  currency: 'PHP',
  physicalAssetsMax: 300,
  frontdeskSeatsMax: 3,
} as const;

/** Lower-cost owner-only tier. */
export const STARTER_PLAN = {
  code: 'starter',
  version: 1,
  monthlyMinor: 14900,
  currency: 'PHP',
  physicalAssetsMax: 125,
  frontdeskSeatsMax: 0,
} as const;
