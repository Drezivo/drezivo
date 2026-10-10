# 0014. Standard plan price

**Status:** Superseded by [ADR 0015](0015-starter-and-standard-plans.md) for plan identity and catalog structure; Standard's price remains unchanged
**Date:** 6 October 2026
**Owners:** Product owner

## Context

The current pilot sells one customer-facing Standard plan backed by the global `starter` v1 plan
row. Its price was PHP 300 per month. The pilot price is changing while its capacity limits remain
300 active physical clothing items and 3 Front Desk seats.

## Decision

1. Standard costs **PHP 299 per month** (29,900 PHP minor units), still using internal plan code
   `starter`, version 1.
2. Migration `0072_starter_plan_price.sql` updates the global `starter` v1 plan price in each
   environment. Since subscriptions reference this shared plan row, the current price is reflected
   for every tenant using that plan after the environment applies the migration.
3. Existing subscription-payment rows are historical records and are not rewritten. A payment
   already submitted keeps its recorded amount; new payment amounts use the current plan price.
4. The quotas in [ADR 0013](0013-starter-plan-capacity.md) remain unchanged.

## Consequences

- The onboarding, billing, public pricing, legal-draft, and operator-facing copy must show PHP 299
  per month and stay aligned with the plan row.
- Operators must apply the migration in each environment before accepting payments at the new
  price. Do not change production or test databases as part of this decision record.
- No subscription or payment history is deleted or repriced.

## Related decisions

- [ADR 0011](0011-single-standard-pilot-plan.md) establishes the single Standard pilot offer; this
  decision supersedes only its price.
- [ADR 0013](0013-starter-plan-capacity.md) sets the current asset and Front Desk limits.
- [Pilot operation runbook](../runbooks/pilot-operation.md) describes current payment operations.
