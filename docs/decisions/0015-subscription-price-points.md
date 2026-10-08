# 0015. Subscription price points

**Status:** Accepted owner pricing direction; plan definition and implementation pending
**Date:** 8 October 2026
**Owners:** Product owner

## Context

[ADR 0014](0014-starter-plan-price.md) set the only implemented pilot plan, Standard (`starter`
v1), to PHP 299 per month. The owner has since directed that the current subscription pricing use
monthly price points of PHP 149 and PHP 299.

The current app, API, and database still support only Standard at PHP 299 per month. No second
plan name, differentiated inclusions, quota, or billing selection behavior has been provided or
implemented.

## Decision

1. Record the owner-directed monthly subscription price points as **PHP 149** and **PHP 299**.
2. This decision records the prices only. It does not assign plan names, features, entitlements,
   eligibility, trial behavior, or upgrade/downgrade rules to either price.
3. The currently implemented and chargeable plan remains Standard (`starter` v1) at PHP 299 per
   month, with the limits in [ADR 0013](0013-starter-plan-capacity.md).
4. Do not treat PHP 149 as a selectable or chargeable plan until its plan definition, server-side
   entitlements, onboarding/payment selection, and versioned database changes are approved and
   implemented. Do not change existing subscriptions or payment history as part of this decision.

## Consequences

- Product and marketing materials may record both owner-directed price points, but must not invent
  tier names or feature differences.
- The pricing page and checkout must not imply that PHP 149 can be purchased while the runtime
  only provisions and charges Standard at PHP 299.
- A follow-up owner decision must define the plan mapping and entitlements before implementation.
- Historical plan rows and subscription-payment records remain unchanged.

## Related decisions

- [ADR 0011](0011-single-standard-pilot-plan.md) defines the single-plan pilot behavior.
- [ADR 0013](0013-starter-plan-capacity.md) defines the implemented Standard limits.
- [ADR 0014](0014-starter-plan-price.md) records the PHP 299 price applied by migration `0072`.
