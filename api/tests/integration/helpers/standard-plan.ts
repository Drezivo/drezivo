/**
 * The only sellable plan during the pilot: "Standard", stored under the internal code `starter`
 * (the operator API accepts only starter|professional|business). Migration 0063_pilot_billing set
 * these caps and deactivated `professional` and `business`. Limit tests derive their seed counts
 * from here so a future cap change is one edit.
 */
export const STANDARD_PLAN = {
  code: 'starter',
  version: 1,
  monthlyMinor: 30000,
  currency: 'PHP',
  physicalAssetsMax: 1000,
  frontdeskSeatsMax: 10,
} as const;
