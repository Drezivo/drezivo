# 0005. Money is stored as integer minor units, serialized as decimal strings

**Status:** Accepted, dated 15 September 2026

## Context

TRD §4 states the API contract rule directly: "Serialize monetary minor units as decimal
strings so JavaScript number limits cannot silently corrupt amounts." TRD §6 (operational
finance) requires "signed/typed immutable entries," positive bounded amounts, and exact
equality checks (`allocated amount ≤ available verified payment`, `total refunded/released ≤
the applicable refundable balance`) — none of which can be trusted if the underlying
representation loses precision. TRD §6 gives the concrete numbers this has to hold for exactly:
the owner-confirmed monthly PHP plan prices are Starter ₱300, Professional ₱499, Business
₱1,299 — stored as minor units 30000, 49900, 129900.

JavaScript's `number` type is an IEEE 754 double: it represents integers exactly only up to
2^53 − 1, and standard arithmetic on it (including what `JSON.parse`/`JSON.stringify` do to a
numeric field by default) is subject to floating-point rounding the moment any division or
fractional operation touches it. A rental subledger (TRD §6: "This is a rental subledger, not a
certified accounting system") that silently rounds a peso amount is a direct violation of TRD
§11's integrity target: "Zero duplicate postings/overlapping blocking allocations in acceptance
suite; no percentage allowance for financial duplication" — a rounding error is a smaller,
quieter version of the same class of defect.

## Decision

Every monetary amount in the system is stored in the database as an **integer number of minor
units** (centavos for PHP — 1 peso = 100 minor units), never as a decimal/float column. On the
wire — every API request and response body defined in `@drezivo/contracts` (ADR 0003) — a
monetary amount serializes as a **decimal string**, e.g. `"1000.00"` for ₱1,000.00 stored as
integer `100000`, never as a JSON number.

Every consumer — `api`'s domain services, `app`, `web`, and any export/report generation —
**parses monetary strings with a decimal library** (e.g. a fixed-point/big-decimal library
appropriate to the language), never with `parseFloat`, `Number()`, or implicit numeric
coercion. Money never travels through a code path that treats it as an IEEE 754 double, from
database column to database column.

Per TRD §5, an accepted rental's price/policy snapshot is stored at confirmation time; editing a
catalogue price never rewrites an accepted rental. Snapshotted amounts follow the same
minor-units/decimal-string rule as live amounts — there is no separate representation for
historical values.

## Consequences

**Good:**

- Amounts cannot silently lose precision in transit or in a client that happens to run the
  value through ordinary arithmetic before displaying it — the wire format itself refuses to be
  treated as a `number` without an explicit, deliberate parse step.
- Database-level integer arithmetic for posting, allocation, and refund-cap checks (TRD §6) is
  exact — no floating-point comparison is ever used to decide whether a refund would exceed a
  balance.
- The representation is consistent across the whole system (database, wire format, every
  consumer), so there is one rule to audit for, not a per-service judgment call.

**Bad:**

- Every consumer of a monetary field has an extra parsing step compared to "just read the JSON
  number" — a decimal library dependency in every codebase that touches money (`api`, `app`,
  `web`, and any future export tooling).
- A developer unfamiliar with this rule can trivially violate it by writing `Number(response.
  total)` or a template that interpolates the field directly into arithmetic; this is a code
  review responsibility (`CONTRIBUTING.md` §4: "AI-generated code gets more scrutiny than
  hand-written code") and a candidate for a lint rule banning `parseFloat`/bare `Number()` on
  known monetary field names, once the `api`/`app`/`web` repositories exist to host that lint
  rule.
- Minor-units integers require a documented currency-to-minor-unit conversion factor per
  currency if Drezivo ever supports a currency without a 1:100 major/minor relationship; V1
  targets PHP only, so this is not yet a concern but should not be assumed universal by future
  code.

## Alternatives considered

**JSON numbers for money, rounded/truncated carefully by convention** — rejected outright: TRD
§4 states this explicitly ("JavaScript number limits cannot silently corrupt amounts"). Relying
on every developer to round correctly, every time, in every service, in every language the
contract might eventually target, is the same class of mistake TRD §6's "no percentage
allowance for financial duplication" standard exists to rule out.

**Decimal/numeric database columns instead of integer minor units** — considered, since
PostgreSQL's `NUMERIC` type is exact. Rejected in favor of integer minor units because integer
arithmetic and integer range-exclusion/comparison constraints (TRD §5, §6) are simpler to reason
about and index than arbitrary-precision decimal columns, and because the wire-format decision
(decimal string) is independent of the storage decision either way — integer minor units keep
the storage layer as simple as possible while the wire format stays deliberately opaque to
naive numeric handling.
