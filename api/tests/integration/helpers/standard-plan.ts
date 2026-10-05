/**
 * The only sellable plan during the pilot: "Standard", stored under the internal code `starter`
 * (the operator API accepts only starter|professional|business). Migrations 0063 and 0071 set these
 * current caps and deactivated `professional` and `business`. Limit tests derive their seed counts
 * from here so a future cap change is one edit.
 */
export const STANDARD_PLAN = {
  code: 'starter',
  version: 1,
  monthlyMinor: 29900,
  currency: 'PHP',
  physicalAssetsMax: 300,
  frontdeskSeatsMax: 3,
} as const;
