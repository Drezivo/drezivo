---
title: Rental Day Counting Alignment Implementation Plan
type: implementation-plan
status: implemented
owner: Drezivo team
updated: 2026-10-03
tags: [drezivo, reservations, pricing, rental-days, availability, storefront, operations]
---

# Rental Day Counting Alignment Implementation Plan

**Status:** Implemented 2026-10-03. A rental business owner confirmed that a 3-day rental is Day 1 pickup, Day 2 event, Day 3 return (see section 19), so the decision gate is met. The calendar-day rule now drives the API calculator, staff UI, storefront checkout, and snapshots. Section 19 records the answer and the interim defaults for questions the owner has not answered yet.

**Decision gate:** Confirm the actual rental-day rule with the business owner before starting Phase 1. If the owner confirms that a “3-day rental” means **Day 1 pickup, Day 2 event/use, Day 3 return**, execute this plan. If the owner confirms a true 72-hour rental, close this plan as not required and keep the current elapsed-duration model.

**Canonical specifications affected if verified:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), [ERD](../../architecture/Drezivo-ERD.dbml), [[Reservations Checklist]], [[Availability Checklist]], [[Clothing Checklist]], [[Schedule Calendar Checklist]], and `docs/reservation-checklist.md`.

## 1. Problem statement

Drezivo currently defines a fixed-duration rental using elapsed minutes.

Current example:

```text
Configured package: 3 days
Stored duration: 4,320 minutes
Pickup: Oct 5, 10:00 AM
Earliest included return: Oct 8, 10:00 AM
```

The current implementation therefore treats “3 days” as exactly 72 elapsed hours.

The merchant reference under review uses a different convention:

```text
Day 1 — Pickup
Day 2 — Event / use
Day 3 — Return
```

Under that rule, the same rental would be:

```text
Pickup: Oct 5
Day 1: Oct 5
Day 2: Oct 6
Day 3 / Return: Oct 7
```

If the owner confirms this convention, the current Drezivo rule is a **business-rule mismatch**, not merely a UI bug. The backend quote logic, reservation validation, staff UI, storefront checkout, contract fields, documentation, and test expectations all currently encode the elapsed-duration interpretation.

## 2. Current authoritative behavior

The current production rule is explicitly documented and implemented as elapsed time:

- `docs/product/Drezivo-PRD.md` FR7–FR8 says a 3-day fixed rental rejects less than 72 hours and accepts exactly 72 hours.
- `docs/reservation-checklist.md` records `included_duration_minutes` as the base-price duration and hard minimum.
- `api/src/modules/reservations/reservations.quote.ts` calculates included duration and extra days from timestamp differences.
- `api/src/modules/reservations/reservations.service.ts` exposes `minimum_duration_minutes` and uses `computeRentalTotal(...)` for exact availability checks.
- `app/src/components/reservations/new-reservation-sheet.tsx` derives earliest valid return by adding `included_duration_minutes` to pickup time.
- `app/src/components/reservations/reservation-availability-calendar.tsx` derives rental-day guidance from minimum duration minutes.
- `web/src/components/store/booking/booking-drawer.tsx` derives minimum fixed rental days from `included_duration_minutes / 1440`.
- `web/src/lib/storefront-format.ts` displays fixed-duration pricing as days derived from included minutes.
- Add/Edit Clothing currently converts configured “included days” into minutes.
- `product_variant.included_duration_minutes` is the persisted tariff field.

This means changing only the date picker would be incorrect. Server-side validation would continue rejecting the merchant’s expected date range, and pricing could disagree between surfaces.

## 3. Candidate business rule pending owner verification

If verified, freeze the following rule before writing code:

> A fixed-duration clothing rental is counted in **inclusive branch-local calendar days**. The pickup date is Day 1. For an `N`-day package, the included return date is `pickup local date + (N - 1)` calendar days.

Examples:

| Package | Pickup date | Included return date | Rental-day count |
| --- | --- | --- | --- |
| 1 day | Oct 5 | Oct 5 | 1 |
| 2 days | Oct 5 | Oct 6 | 2 |
| 3 days | Oct 5 | Oct 7 | 3 |
| 4 days | Oct 5 | Oct 8 | 4 |

For a 3-day fixed package:

```text
Oct 5 pickup  → Day 1
Oct 6         → Day 2
Oct 7 return  → Day 3
Oct 8 return  → +1 extra rental day
Oct 9 return  → +2 extra rental days
```

The branch timezone remains authoritative for determining local calendar dates.

## 4. Important distinctions to preserve

The implementation must keep these concepts separate:

### 4.1 Rental-day count

Used for package eligibility and planned extra-day pricing.

```text
pickup local date → inclusive rental dates → return local date
```

### 4.2 Exact pickup and return timestamps

Still required for:

- physical handover schedule;
- precise asset allocation boundaries;
- Calendar pickup/return events;
- late-return detection;
- branch opening-hour validation where applicable;
- overlap checks with other bookings.

A calendar-day pricing rule does **not** mean timestamps can be removed.

### 4.3 Recovery after return

Recovery remains separate and begins after the exact return timestamp.

Example:

```text
Oct 5 — Pickup / Day 1
Oct 6 — Day 2
Oct 7 — Return / Day 3
Oct 8 — Recovery / cleaning
Oct 9 — Available again
```

Recovery must never add a customer rental day or extra-day charge.

### 4.4 Planned extra day versus late-return penalty

Do not automatically treat every return-time violation as an extra planned rental day. Confirm with the business owner whether:

- a planned extension to the next local date uses `extra_day_price_minor`;
- a same-date late return after the promised return time uses a separate late fee/penalty policy;
- both can apply in some circumstances.

Until this is confirmed, do not merge late-return penalties into fixed-duration pricing.

## 5. Business-owner verification gate — RDAY-000

- [ ] **RDAY-000 — Verify the merchant’s rental-day definition before implementation**
  - **Owner questions:**
    - [ ] Does a 3-day rental mean `pickup day = Day 1`, `next day = Day 2`, `return day = Day 3`?
    - [ ] If pickup is late in the afternoon, is that still a full Day 1?
    - [ ] For a 3-day package picked up Oct 5 at 4 PM, is Oct 7 still the normal included return date?
    - [ ] Is there a standard return clock time on the return date, or is the return time selected per reservation?
    - [ ] If the customer returns later on the same return date, is that an extra rental day, a late penalty, or only an operational exception?
    - [ ] Does an extension from Oct 7 to Oct 8 always count as exactly one extra rental day regardless of clock time?
    - [ ] Does the same inclusive calendar-day rule apply to `daily` pricing, or only to fixed packages?
    - [ ] For a 1-day rental, may pickup and return occur on the same local date?
    - [ ] Must the event date be between pickup and return dates inclusive?
    - [ ] Does delivery change Day 1, or does Day 1 remain the agreed customer handover date?
  - **Required evidence:** Record the owner’s answers in this plan before checking RDAY-000 complete.
  - **Stop condition:** If the owner says “3 days means 72 hours,” do not implement the remaining phases.

## 6. Recommended target domain model if verified

Do not simply rename the UI while continuing to use elapsed minutes as the hidden business meaning. The domain should represent the merchant concept directly.

Recommended future tariff shape:

```text
pricing_mode = fixed_duration
included_rental_days = 3
extra_day_price_minor = 10000
rental_day_basis = calendar_day_inclusive
```

Exact booking facts remain:

```text
pickup_at = precise instant
return_at / due_at = precise instant
timezone_snapshot = branch timezone
```

### Why not keep only `included_duration_minutes`?

Using `4,320` minutes to mean “three inclusive local dates” would be semantically false. It would invite the same bug again in quoting, rescheduling, storefront estimates, reports, or future integrations.

### Backward compatibility

Existing accepted reservations must never have historical totals or promised due dates silently recalculated after the rule changes.

Recommended compatibility strategy:

- New tariff configuration gains an explicit day-counting basis and included rental-day count.
- Existing accepted reservation `price_snapshot` records keep their original computed totals and due timestamps.
- New reservation snapshots include the rule that produced the price, such as:

```json
{
  "pricing_mode": "fixed_duration",
  "rental_day_basis": "calendar_day_inclusive",
  "included_rental_days": 3,
  "extra_day_count": 0
}
```

- Legacy snapshots with only `included_duration_minutes` are treated as `elapsed_duration` history and are never reinterpreted.

If production contains only disposable test reservations at implementation time, a simpler data reset may be acceptable, but only after confirming there are no real commitments worth preserving.

## 7. Phase 1 — Specification and contract alignment

- [ ] **RDAY-010 — Update the canonical PRD rule**
  - Replace the current “3 days = minimum 72 hours” acceptance example.
  - State the verified calendar-day rule explicitly.
  - Add examples for base package and extra days.
  - Keep exact pickup/return timestamps and Recovery separate.

- [ ] **RDAY-011 — Update operational checklists and architecture docs**
  - Update `docs/reservation-checklist.md` fixed-duration section.
  - Update [[Reservations Checklist]] where it describes elapsed-duration pricing.
  - Update [[Availability Checklist]] where minimum duration is described in minutes.
  - Update Data Model/ERD descriptions if product-variant tariff fields change.
  - Update storefront/customer-facing terminology so “3 days” has one meaning everywhere.

- [ ] **RDAY-012 — Define shared rental-day contract fields**
  - Introduce a shared day-counting basis instead of re-deriving semantics independently in API/app/web.
  - Recommended values:
    - `elapsed_duration` for legacy history only;
    - `calendar_day_inclusive` for the verified merchant rule.
  - Add `included_rental_days` for fixed-duration calendar tariffs.
  - Decide whether `minimum_duration_minutes` remains in any response; if calendar-day tariffs no longer use it, deprecate/remove it from new consumers.
  - Add contract tests for 1-day, 2-day, 3-day, long-name timezone boundaries, and strict unknown-field rejection.

## 8. Phase 2 — Forward-only persistence migration

- [ ] **RDAY-020 — Add forward-only tariff fields**
  - Do not edit historical migrations.
  - Add the minimum fields required to represent calendar-day tariffs explicitly.
  - Candidate product-variant fields:
    - `rental_day_basis`;
    - `included_rental_days`.
  - Add bounded checks, for example positive included days and a sensible maximum consistent with storefront max rental days.

- [ ] **RDAY-021 — Backfill existing fixed-duration variants safely**
  - Inventory current active and archived variants before migration.
  - Where `included_duration_minutes` is exactly divisible by 1,440, derive the candidate day count.
  - Do not silently convert unusual minute-based historical tariffs without review.
  - Decide whether current test/pilot variants are converted to `calendar_day_inclusive` immediately or remain legacy until explicitly edited.

- [ ] **RDAY-022 — Preserve accepted reservation history**
  - Do not rewrite `pickup_at`, `due_at`, `rental_total_minor`, or accepted price snapshots.
  - Add the new day basis/day count to future reservation snapshots.
  - Legacy snapshots without the field remain valid historical records.
  - Confirm reservation-detail parsing can read both legacy and new snapshot shapes.

- [ ] **RDAY-023 — Audit reschedule behavior**
  - Determine whether an accepted reservation reschedule keeps its original tariff basis or re-quotes using the current variant rule.
  - Recommended default: preserve accepted commercial terms unless the reschedule workflow explicitly performs and records repricing.
  - Add tests for a legacy elapsed reservation being rescheduled after the new rule exists.

## 9. Phase 3 — One authoritative rental-day calculator

- [ ] **RDAY-030 — Implement shared server-side local-date counting**
  - Use the reservation/branch timezone snapshot.
  - Convert pickup and return instants to branch-local ISO dates.
  - For inclusive calendar counting:

```text
rental_day_count = local_date_difference(pickup_date, return_date) + 1
```

  - Never use raw UTC millisecond division to count calendar rental days.
  - Handle DST-capable zones correctly even though the launch timezone is normally `Asia/Manila`.

- [ ] **RDAY-031 — Replace fixed-duration minimum validation**
  - Current rule: `return - pickup >= included_duration_minutes`.
  - Verified rule: `inclusive local rental days >= included_rental_days`.
  - Example for a 3-day package:
    - Oct 5 → Oct 6 = 2 days → reject;
    - Oct 5 → Oct 7 = 3 days → base package;
    - Oct 5 → Oct 8 = 4 days → base + 1 extra day.

- [ ] **RDAY-032 — Replace extra-day calculation**
  - Fixed package:

```text
extra_day_count = max(0, inclusive_rental_days - included_rental_days)
```

  - Do not round elapsed partial 24-hour blocks upward for a calendar-day tariff.
  - Keep the legacy elapsed calculator only for legacy snapshots/variants if backward compatibility requires it.

- [ ] **RDAY-033 — Decide and implement `daily` pricing semantics**
  - Do not assume `daily` pricing automatically changes with fixed-duration pricing.
  - If the owner confirms inclusive calendar days for daily pricing, use the same local-date count.
  - Otherwise document and test the different rule explicitly.

## 10. Phase 4 — Reservation and availability backend cutover

- [ ] **RDAY-040 — Update reservation quote pricing**
  - Replace elapsed-minimum logic in `reservations.quote.ts` for new calendar-day tariffs.
  - Continue deriving all totals server-side.
  - Return explicit day-count information in the quote/availability projection.

- [ ] **RDAY-041 — Update staff exact-availability check**
  - `GET`/check paths must validate the same calendar-day rule as final reservation creation.
  - Remove any API response that misleadingly states a calendar tariff’s minimum only as minutes.
  - Return `included_rental_days`, `rental_day_basis`, and calculated `extra_day_count` where useful.

- [ ] **RDAY-042 — Keep asset blocking timestamp-precise**
  - The authoritative allocation remains:

```text
blocked_start = pickup_at
blocked_end = due_at + Recovery
```

  - Do not convert allocation exclusion ranges to whole calendar days.
  - Calendar-day pricing and timestamp-precise availability are separate concerns.

- [ ] **RDAY-043 — Update guest/storefront reservation creation**
  - Guest checkout and staff creation must call the same server rental-day calculator.
  - No client estimate may override server pricing.
  - A direct API call cannot bypass the new minimum-day rule.

## 11. Phase 5 — Staff reservation UI

- [ ] **RDAY-050 — Default the return date using inclusive days**
  - For `N` included days, default return local date to pickup date + `N - 1`.
  - A 3-day package selected on Oct 5 should default to Oct 7, not Oct 8.

- [ ] **RDAY-051 — Remove elapsed-hour minimum messaging**
  - Remove messages such as “earliest valid return is pickup time + 72 hours” for calendar tariffs.
  - Replace with calendar language, for example:

> This is a 3-day rental. Pickup day counts as Day 1, so an Oct 5 pickup has an included return date of Oct 7.

- [ ] **RDAY-052 — Keep return-time validation separate**
  - Continue requiring an exact return time.
  - Do not move the included return date forward merely because return time is earlier than pickup time unless the verified owner rule requires that.
  - Apply Business Hours/time restrictions independently from rental-day count.

- [ ] **RDAY-053 — Update rental preview and totals**
  - Show included day count.
  - Show extra planned rental days based on local dates.
  - Keep deposit and Recovery separate.

## 12. Phase 6 — Clothing configuration UI

- [ ] **RDAY-060 — Rename the persisted concept in Add Clothing**
  - Owner-facing field remains simple: `Included rental days` or equivalent.
  - Stop treating that input as merely `days × 1,440 minutes` for new calendar tariffs.
  - Keep Extra day price as an explicit separate amount.

- [ ] **RDAY-061 — Update Edit Clothing and sizing transitions**
  - Load/save the new included-day field directly.
  - Existing legacy variants should be clearly normalized or migrated before edit.
  - Do not accidentally convert a legacy irregular-minute tariff without an explicit migration rule.

- [ ] **RDAY-062 — Update Clothing Details summaries**
  - Example display:

```text
₱600 · 3-day rental · Extra day ₱100/day
```

  - Avoid wording that implies 72 elapsed hours when the basis is calendar-day inclusive.

## 13. Phase 7 — Public storefront checkout

- [ ] **RDAY-070 — Update date-range minimum selection**
  - The storefront range picker must allow Oct 5 → Oct 7 for a verified 3-day package.
  - It must reject Oct 5 → Oct 6 as below the 3-day minimum.

- [ ] **RDAY-071 — Fix client-side estimates**
  - `web/src/components/store/booking/booking-drawer.tsx` currently estimates using date difference and a minimum derived from minutes.
  - Replace this with the shared contract semantics.
  - The estimate remains display-only; server response remains authoritative.

- [ ] **RDAY-072 — Update customer-facing copy**
  - Explain the merchant rule clearly enough to avoid disputes.
  - Example:

```text
3-day rental
Day 1: Pickup
Day 2: Event/use
Day 3: Return
```

  - Show exact pickup and return times separately.

## 14. Phase 8 — Calendar, dashboard, notifications, and downstream projections

- [ ] **RDAY-080 — Verify Calendar requires no semantic rewrite**
  - Calendar should continue rendering stored `pickup_at` and `due_at` timestamps.
  - No calendar event should independently calculate rental duration.

- [ ] **RDAY-081 — Audit Dashboard wording**
  - Any “X-day rental” summary must use snapshot day semantics rather than elapsed-hour derivation.

- [ ] **RDAY-082 — Audit notifications/messages**
  - Pickup/return reminders must use stored deadlines.
  - Any package-duration text must come from the accepted pricing snapshot or canonical tariff fields.

- [ ] **RDAY-083 — Audit reports/export**
  - If exports expose rental duration, include the accepted day basis so legacy elapsed and new calendar rentals are not ambiguous.

## 15. Phase 9 — Test matrix

- [ ] **RDAY-090 — Unit-test the calendar-day calculator**
  - Same-date pickup/return = 1 rental day.
  - Oct 5 → Oct 6 = 2 rental days.
  - Oct 5 → Oct 7 = 3 rental days.
  - Month/year boundary.
  - Leap day.
  - DST transition in a non-Manila test timezone.
  - Pickup/return times do not alter local-date count unless owner policy explicitly says otherwise.

- [ ] **RDAY-091 — Integration-test fixed package pricing**
  - 3-day package Oct 5 → Oct 6 rejects.
  - Oct 5 → Oct 7 uses base price.
  - Oct 5 → Oct 8 adds one extra day.
  - Oct 5 → Oct 9 adds two extra days.
  - Deposit/delivery remain independent.

- [ ] **RDAY-092 — Integration-test availability**
  - Allocation begins at exact pickup instant.
  - Allocation ends at exact due instant + Recovery.
  - Adjacent safe intervals remain allowed.
  - Recovery overlap still prevents unsafe next booking.
  - Calendar-day pricing does not weaken PostgreSQL allocation exclusion.

- [ ] **RDAY-093 — Test staff UI**
  - Selecting Oct 5 on a 3-day package defaults/permits Oct 7.
  - Oct 6 is visibly invalid.
  - Exact time edits do not silently move the package to Oct 8.
  - Extra-day preview matches backend response.

- [ ] **RDAY-094 — Test storefront UI**
  - Public picker, review step, and server hold agree on dates and price.
  - Direct API bypass attempts receive the same validation.

- [ ] **RDAY-095 — Legacy compatibility tests**
  - Existing reservation detail still parses old price snapshots.
  - Old accepted totals and due timestamps do not change.
  - Historical legacy reservations do not become invalid after deployment.

## 16. Phase 10 — Data and release safety

- [ ] **RDAY-100 — Audit production data before migration**
  - Count active/archived fixed-duration variants.
  - Identify any non-day-aligned `included_duration_minutes` values.
  - Count accepted future reservations that were promised under elapsed-duration semantics.
  - Separate disposable test reservations from real business commitments.

- [ ] **RDAY-101 — Choose migration policy for existing variants**
  - Option A: convert all active day-aligned pilot variants after owner confirmation.
  - Option B: preserve legacy basis until owner edits each variant.
  - Record the chosen policy before running the migration.

- [ ] **RDAY-102 — Protect existing future reservations**
  - Never automatically shorten a customer’s already-promised due date from Oct 8 to Oct 7.
  - Never automatically add or remove charges from an accepted reservation.
  - New semantics apply to newly quoted bookings unless a deliberate migration workflow says otherwise.

- [ ] **RDAY-103 — Release backend before relying on frontend changes**
  - Contracts/migration/API first.
  - Staff and storefront clients only use new semantics after compatible API is deployed.
  - Avoid a window where UI allows Oct 5 → Oct 7 but API still requires 72 hours.

- [ ] **RDAY-104 — Production smoke test**
  - Create a test fixed 3-day variant.
  - Quote Oct 5 → Oct 7.
  - Verify base price.
  - Quote Oct 5 → Oct 8.
  - Verify one extra day.
  - Verify allocation Recovery end.
  - Verify staff and public storefront display identical terms.

## 17. Files/modules expected to change if verified

This is an implementation map, not an exhaustive list.

### Contracts

- `contracts/src/catalogue/admin.ts`
- `contracts/src/catalogue/staff.ts`
- `contracts/src/storefront/catalogue.ts`
- `contracts/src/availability/availability.ts`
- reservation pricing/snapshot contracts as required
- related contract tests

### Database/schema

- new forward migration under `api/src/db/migrations/`
- `api/src/db/schema/catalogue.ts`
- Data Model / ERD documentation

### API

- `api/src/modules/reservations/reservations.quote.ts`
- `api/src/modules/reservations/reservations.service.ts`
- catalogue read/write repositories/services
- reservation snapshot persistence/mappers
- availability and reservation integration tests

### Staff app

- `app/src/components/inventory/add-clothing-page.tsx`
- `app/src/components/inventory/edit-clothing-page.tsx`
- `app/src/components/inventory/clothing-details-page.tsx`
- `app/src/components/inventory/sizing-transition-dialog.tsx`
- `app/src/components/reservations/new-reservation-sheet.tsx`
- `app/src/components/reservations/reservation-availability-calendar.tsx`
- shared API client/types as required

### Public storefront

- `web/src/components/store/booking/booking-drawer.tsx`
- `web/src/lib/storefront-format.ts`
- catalogue/item pricing presentation
- storefront booking tests

### Documentation

- `docs/product/Drezivo-PRD.md`
- `docs/reservation-checklist.md`
- `docs/architecture/Drezivo-Data-Model.md`
- `docs/architecture/Drezivo-ERD.dbml`
- relevant Second Brain Operations checklists

## 18. Non-negotiable release outcomes

If the owner verifies inclusive calendar-day rentals, the change is complete only when all of the following are true:

- [ ] “3 days” means the same thing in Clothing, staff Reservations, API pricing, public storefront, reservation snapshots, and documentation.
- [ ] Pickup day is counted as Day 1 for new calendar-day fixed tariffs.
- [ ] A 3-day Oct 5 pickup can return Oct 7 at base price.
- [ ] Oct 8 is one planned extra day for that same package.
- [ ] Exact timestamps still protect real asset availability.
- [ ] Recovery remains post-return operational occupancy and never customer rental time.
- [ ] The database exclusion constraint remains the final concurrency authority.
- [ ] Existing accepted reservations are not silently repriced or shortened.
- [ ] Staff and storefront use the same server-owned pricing calculation.
- [ ] Direct API calls cannot bypass the minimum rental-day rule.
- [ ] Business-owner examples are captured as executable tests before release.

## 19. Owner-verification record

Complete this section after the business-owner discussion.

```text
Date verified: 2026-10-03
Business owner / rental operator: pilot rental business owner (Messenger conversation)

3-day definition: Day 1 pickup, Day 2 event, Day 3 return
Pickup day counts as Day 1: Yes
Expected dates for Oct 1 pickup (owner's own example):
  Day 1: Oct 1 (pickup)
  Day 2: Oct 2 (event)
  Day 3 / normal return: Oct 3

Return-time rule: not asked yet. Interim: clock times never change the day count; staff choose any
  return time on the return date (after pickup when it is the same date). Storefront keeps its
  single handover time.
Extra-day rule: not asked yet. Interim: each later return date adds one extra day at
  extra_day_price_minor.
Same-day 1-day rental allowed: Interim yes for staff bookings (pickup date = return date). The
  storefront needs at least one night because pickup and return share one handover time.
Daily-pricing rule: Interim same inclusive count (a daily item is a 1-day package whose extra-day
  price is the daily rate), so "3 days" means one thing everywhere.
Late-return rule: not asked yet. No late fee was added; late returns stay an operational exception.
Delivery/handover rule: not asked yet. Day 1 is the agreed handover date (pickup_at).

Decision:
[ ] Keep existing elapsed-duration behavior
[x] Implement inclusive calendar-day behavior using this plan

Notes: Existing accepted reservations keep their stored totals and due dates. There is no
reservation reschedule flow, so nothing re-quotes them. New snapshots record
rental_day_basis = calendar_day_inclusive; snapshots without it are elapsed-duration history.
The tariff column stays included_duration_minutes (always whole days x 1,440 because owners enter
days); the calculator refuses any value that is not whole days instead of rounding it.
```

## 20. Implementation order after verification

```text
Owner verifies business rule
        ↓
Freeze PRD + contract semantics
        ↓
Forward migration + compatibility strategy
        ↓
One authoritative server rental-day calculator
        ↓
Reservation quote + exact availability + create
        ↓
Staff Clothing + Reservation UI
        ↓
Public storefront checkout
        ↓
Calendar/dashboard/downstream wording audit
        ↓
Legacy + concurrency + timezone tests
        ↓
Production data audit and staged rollout
```

Do not start with frontend date-picker changes. The correction is a domain/pricing change and must be backend-authoritative before the UI is allowed to depend on it.
