# 0013. Standard plan pilot capacity

**Status:** Accepted
**Date:** 6 October 2026
**Owners:** Product owner

## Context

ADR 0011 established Standard as the single sellable pilot plan, represented by the internal
`starter` v1 plan. Its initial limits were 1,000 active physical assets and 10 Front Desk seats.
The pilot now needs lower, explicit capacity limits.

## Decision

1. Standard uses internal plan code `starter`, version 1. Its initial PHP 300 price was later
   superseded by [ADR 0014](0014-starter-plan-price.md); capacity is unaffected.
2. Standard allows up to **300 active physical clothing items** and **3 active Front Desk seats**.
   The Owner does not consume a Front Desk seat. Active physical items are counted according to
   the existing `physical_assets.max` entitlement semantics.
3. Migration `0071_starter_plan_limits.sql` updates these two global plan entitlements. The limits
   apply to every tenant on Standard in an environment after that environment applies the migration.
4. Applying the lower caps does not delete or deactivate existing clothing or memberships. Existing
   usage above a new cap remains intact; the existing server-side quota guard prevents additional
   activation/invitation until usage is below the limit.
5. All other terms and behavior in ADR 0011 remain unchanged.

## Consequences

- Runtime entitlements remain authoritative; UI copy is informational only.
- Operators should check current usage before applying this migration. No tenant data migration or
  per-tenant exception is part of this decision.
- Product, architecture, runbook, and legal-draft documents must describe the current quotas as
  300 active physical clothing items and 3 Front Desk seats.

## Related decisions

- [ADR 0011](0011-single-standard-pilot-plan.md) defines the single Standard offer and all other
  pilot billing/access terms.
- [ADR 0012](0012-storefront-guest-email-free-bookings.md) is unrelated and remains in force.
- [Pilot operation runbook](../runbooks/pilot-operation.md) describes current payment and access
  operations.
