# 0016. App-only Growth and Scale plans

**Status:** Accepted
**Date:** 28 October 2026
**Owners:** Product owner

## Context

The app needs two higher-capacity fixed plans while the public marketing page remains focused on
Free, Starter, and Standard. These are standard catalog plans, not customer-specific quotes. Prices,
limits, and feature access must stay server-authoritative, and each paid plan must preserve the
existing lifetime-eligible fourteen-day trial.

## Decision

1. Add **Growth** at PHP 499/month (49,900 minor units), with 500 active garments and up to five
   Front Desk seats.
2. Add **Scale** at PHP 999/month (99,900 minor units), with 1,000 active garments and up to eight
   Front Desk seats.
3. Both plans inherit Standard's paid features: fittings, online storefront reservations, storefront
   payment methods, and all four storefront designs. Both use the same fourteen-day lifetime trial.
4. Show Growth and Scale in owner onboarding at `/onboarding/plan` and in the Settings billing plan
   picker. Keep both out of the public `web` pricing and landing pages; those continue to show only
   Free, Starter, and Standard, with Standard documented at 300 active garments.
5. Keep prices, quotas, and feature entitlements in migration-managed API catalog rows. The client
   submits a plan code only; the API validates plan activation and applies entitlements.
6. Do not change the existing Standard row in this work. Its temporary database quota is separate
   from the public/documented 300-garment Standard offer and is not surfaced by marketing. A later
   owner-directed change will return Standard's database quota to 300.
7. Paid-plan changes remain unavailable in-app. The billing picker may display all paid tiers but
   must not imply that existing paid subscribers can switch plans there.

## Consequences

- Migration `0092_growth_scale_plan_tiers.sql` creates both version-1 plans and their capabilities,
  and extends onboarding's selected-plan constraint.
- The contracts package, API catalog, billing summary, onboarding mapper, and payment-review handler
  recognize `growth` and `scale`.
- The website's static marketing snapshot remains three plans and does not request the app catalog.
- The plans are fixed catalog entries. Per-tenant price and entitlement overrides are not
  introduced.

## Related decisions

- [ADR 0015](0015-starter-and-standard-plans.md) defines public Starter and Standard plans.
- [PRD pricing and entitlements](../product/Drezivo-PRD.md#6-pricing-entitlements-notifications-operator-admin-billing)
  defines current product-facing requirements.
