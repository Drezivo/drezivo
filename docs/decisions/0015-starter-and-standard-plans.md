# 0015. Starter and Standard subscription plans

**Status:** Accepted
**Date:** 8 October 2026
**Owners:** Product owner

## Context

The pilot's single Standard offer at PHP 299/month is not suitable for every owner-operated shop.
Add a lower-priced tier while keeping existing Standard customers' subscriptions and billing
history intact. Price, limits, and trial duration must be authoritative in the backend and shared
by owner onboarding and public pricing.

## Decision

1. Offer two monthly plans:
   - **Starter:** PHP 149 (14,900 minor units), up to 125 active garments, zero Front Desk seats.
   - **Standard:** PHP 299 (29,900 minor units), up to 300 active garments, up to 3 Front Desk
     seats. The Owner does not consume a seat.
2. Both plans use the existing fourteen-day trial and lifetime eligibility rules. Limits apply
   during the trial. A Front Desk member inherits access from the invited tenant and has no
   independent trial or subscription.
3. Owner onboarding requires an explicit plan code selection. The API catalog and active database
   plan/entitlement rows own prices and limits; clients may select a code but cannot submit price or
   entitlement values. The same public catalog supplies marketing pricing cards.
4. The API enforces active-garment capacity and Front Desk seat capacity regardless of client UI.
   Starter's zero Front Desk seats rejects invitations server-side. Active garment usage counts
   physical assets under the established `physical_assets.max` entitlement.
5. Migration `0075_starter_standard_plan_tiers.sql` renames the existing PHP 299 `starter` v1 plan
   row to `standard` in place, preserving its UUID and all subscription, trial, provider/payment,
   and event references. It adds a separate `starter` v1 row at PHP 149 and sets entitlements to
   125/0 and 300/3. Existing tenants retain their subscription status, dates, submitted payment
   amounts/references, and access; no tenant data is deleted or repriced.
6. Self-service plan changes during a trial remain unavailable. Existing Standard customers
   remain Standard; choosing a tier is part of new owner onboarding.

## Consequences

- `starter` now means the new Starter tier; the old row identity representing Standard becomes
  `standard`. Consumers and tests must use the canonical code rather than infer a tier from the
  old code.
- The backend public catalog is a release dependency for onboarding and the marketing pricing
  section. If it cannot load, those surfaces show a retryable error instead of stale prices.
- The existing single-plan decisions are historical: ADR 0011 is superseded, and ADRs 0013/0014
  continue to describe Standard's unchanged limits/price but not the complete catalog.
- The migration is forward-only and must be applied through the reviewed API migration workflow in
  each target environment. This ADR does not authorize applying it to any database.

## Related decisions

- [ADR 0011](0011-single-standard-pilot-plan.md) records the superseded single-plan pilot.
- [ADR 0013](0013-starter-plan-capacity.md) records the unchanged Standard limits.
- [ADR 0014](0014-starter-plan-price.md) records the unchanged Standard price.
- [PRD pricing and entitlements](../product/Drezivo-PRD.md#6-pricing-entitlements-notifications-operator-admin-billing)
  defines current customer-facing requirements.
