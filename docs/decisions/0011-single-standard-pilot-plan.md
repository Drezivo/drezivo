# 0011. One Standard plan during the pilot

**Status:** Accepted
**Date:** 1 October 2026
**Owners:** Product owner

## Context

The pilot no longer uses the Starter, Professional, and Business tiers. The current onboarding
flow presents one offer, and the application already uses the internal `starter` v1 plan identity
for that offer. Keeping three active plan definitions and the old prices in current specifications
would tell product, engineering, and operations to build different behavior.

## Decision

1. The only sellable pilot plan is **Standard**, priced at **PHP 300 per month** (30,000 PHP minor
   units).
2. Standard uses internal plan code `starter`, version 1, and includes up to 1,000 active physical
   assets and 10 Front Desk seats. The Owner does not consume a Front Desk seat.
3. Eligible verified people receive one fourteen-day lifetime trial. Onboarding has no tier chooser
   or self-service plan change during the pilot.
4. After the trial or paid period ends, access becomes read-only for up to 30 days. For the first
   three days, the storefront stays online without taking bookings or fittings; it is offline for
   the rest of the read-only period. The workspace locks after day 30 except for subscribing.
   Access is derived from subscription dates at request time, with a dated read-only extension
   available to an operator.
5. The Owner pays using a listed Drezivo payment method and submits a reference and receipt.
   An authorized operator reviews the proof; approval starts the paid month. There is no card
   collection or recurring payment provider.
6. Migration `0063_pilot_billing.sql` is the forward-only database change for this offer. It leaves
   `starter` v1 active, sets its entitlements to 1,000 assets and 10 seats, deactivates the old
   Professional and Business v1 rows, and preserves prior plan references in subscription history.
   The old rows are not deleted.
7. A future additional plan or price change requires a new owner decision and versioned database
   changes. The former tier amounts are historical and are not current offers.

## Consequences

- Product, architecture, legal-draft, and operator documentation must describe Standard as the sole
  current offer and mark three-tier pricing as historical where it remains useful context.
- Server-side entitlements remain authoritative. Browser copy does not supply prices, limits, or
  plan authority.
- Historical plan rows and subscription events remain available for audit and safe migration; they
  do not make the retired tiers sellable.

## Related decisions

- [ADR 0005](0005-money-as-minor-units.md) still governs money representation. Its quoted three-tier
  amounts record the offer at the time that ADR was accepted.
- [Pilot operation runbook](../runbooks/pilot-operation.md) describes current payment and access
  operations.
