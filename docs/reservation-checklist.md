# Reservation Checklist

Living implementation tracker for the staff-side **New Reservation** flow.

> Branch: `fix/general-errors`
>
> Scope: business/staff reservation intake, availability calendar, fixed-duration pricing, exact-time availability, bootstrap policy snapshots, and related validation/UI changes.
>
> Status: implementation is functionally complete for the agreed V1 flow, with a few repo/tooling follow-ups noted at the end.

---

## 1. Agreed reservation flow

- [x] Clothing is selected first.
- [x] Variant/size is selected second.
- [x] Availability calendar is hidden until a variant is selected.
- [x] Rental dates are selected from an inline calendar.
- [x] Pickup and return times are selected after the date range.
- [x] Exact timestamp availability is revalidated after times are selected.
- [x] Event date is optional and constrained to the selected pickup/return dates.
- [x] Fulfillment appears beside Event Date.
- [x] Payment method comes after rental-period selection.
- [x] Reservation creation remains the authoritative step that claims one physical asset under the existing allocation/locking rules.

Target dependency chain:

```text
Choose clothing
    ↓
Choose variant / size
    ↓
Variant availability calendar
    ↓
Choose pickup + return dates
    ↓
Choose pickup + return times
    ↓
Exact backend availability check
    ↓
Event date
    ↓
Fulfillment
    ↓
Payment method
    ↓
Reserve
```

---

## 2. Product / variant / physical-asset behavior

- [x] Staff selects a **product variant**, not a physical asset.
- [x] Availability is calculated from serialized physical assets belonging to that variant.
- [x] Different variants can have different availability.
- [x] Two assets of the same variant can have different availability.
- [x] The variant is considered bookable when at least one eligible physical asset can cover the whole requested interval.
- [x] Drezivo does not combine multiple garments to satisfy one reservation line.

Example:

```text
Medium
├── MED-001 → reserved
└── MED-002 → free

Variant result → still available
```

- [x] Integration coverage verifies the above behavior with multiple physical assets.

---

## 3. Inline availability calendar

### Calendar implementation

- [x] Uses `react-day-picker` as the calendar engine.
- [x] Uses Drezivo/shadcn-style UI wrappers and custom day rendering.
- [x] Calendar is inline instead of a small date-picker popover.
- [x] Previous/next month buttons were fixed so they stay inside the calendar header rather than appearing at the reservation-sheet corners.
- [x] Calendar month navigation is controlled by the reservation sheet.
- [x] Past dates are disabled using the branch timezone.
- [x] Date-range selection is supported.
- [x] Daily pricing can use the same calendar date for pickup and return.
- [x] Fixed-duration selection prevents obviously too-short return dates at the calendar level.
- [x] Non-whole-day minimum durations are not over-restricted by the date picker; remaining minimum time is enforced by exact timestamp validation.

### Calendar visual meaning

Current agreed visual language:

- [x] **Available** → transparent / no fill.
- [x] **Limited** → subtle amber.
- [x] **Unavailable / busy** → light red.
- [x] **Selected range** → Drezivo accent highlight.

Meaning of **Limited**:

> The variant is still bookable, but only some of its ready physical pieces are free.

Example:

```text
Medium has 2 pieces
MED-001 → reserved
MED-002 → free

Calendar → Limited / 1 left
```

- [x] Calendar labels do not rely on color alone.
- [x] Calendar can display operational labels such as Reserved, Rented, Fitting, Maintenance, and Unavailable when zero pieces remain.

### Important calendar limitation

- [x] Calendar is explicitly treated as **planning guidance**, not a guarantee.
- [x] Exact availability remains timestamp-based because prep and turnaround buffers can make only part of a day unavailable.
- [x] Backend is authoritative after pickup and return times are selected.

---

## 4. Fixed-duration rental rules

Example business rule:

```text
₱500 / 3 days fixed rental
Extra day: ₱150/day
```

Agreed behavior (owner rule confirmed 2026-10-03, replacing the earlier 72-hour reading):

- [x] Rental days are branch-local calendar dates counted inclusively. **The pickup date is Day 1.**
- [x] The owner-facing package length is stored as `included_duration_minutes = days × 1,440`; it means
      "N rental days", not N × 24 elapsed hours. Values that are not whole days are refused.
- [x] For `fixed_duration`, the package length is also the minimum: a 3-day package cannot be returned on Day 2.
- [x] Returning on the last included date uses the base rental price.
- [x] Each later return date adds one extra day at the extra-day price.
- [x] Pickup and return clock times never change the day count; a 4 PM pickup is still a full Day 1.
- [x] `daily` pricing uses the same count: every rental date, the pickup date included, is charged.
- [x] Every new price snapshot records `rental_day_basis: calendar_day_inclusive`,
      `included_rental_days`, and `rental_day_count`. Older snapshots have no basis and were priced on
      elapsed 24-hour blocks; they are never re-priced.

Examples for a 3-day package picked up Oct 5:

```text
Oct 5 → Oct 6  (2 days) → rejected, below the package
Oct 5 → Oct 7  (3 days) → base price   (Day 1 pickup, Day 2 event, Day 3 return)
Oct 5 → Oct 8  (4 days) → base + 1 extra day
Oct 5 → Oct 9  (5 days) → base + 2 extra days
```

### Minimum enforcement

- [x] The staff calendar suggests the earliest return date (pickup + N − 1) and refuses earlier ones.
- [x] API quote, availability-check, staff create, and guest hold paths all use one calculator
      (`computeRentalTotal` in `api/src/modules/reservations/reservations.quote.ts`).
- [x] This cannot be bypassed by calling the API directly.
- [x] Asset blocking stays timestamp-precise: `pickup_at` to `due_at` plus Recovery. Calendar-day
      pricing does not widen or shrink the exclusion interval.

Example:

```text
Pickup: Oct 5 · 4:00 PM
3-day package
Earliest return date: Oct 7 (any return time after pickup)
```

---

## 5. Prep and turnaround buffers

- [x] Variant `prep_minutes` is part of the blocked inventory interval before pickup.
- [x] Variant `turnaround_minutes` is part of the blocked inventory interval after return.
- [x] Customer rental duration and inventory occupancy are kept conceptually separate.

Example:

```text
1 day preparation
       ↓
3 day customer rental
       ↓
1 day turnaround
```

Inventory impact is roughly 5 days around a 3-day customer rental, while customer pricing still follows the 3-day rental tariff.

### UX explanation

- [x] Variant summary now explains the fixed rental period and the prep/turnaround buffers.
- [x] Too-short-duration messaging now explains the earliest valid return timestamp and why the garment may be blocked outside the customer-facing rental dates.

Example message direction:

> This is a 3-day fixed rental. With this pickup time, the earliest valid return is Sep 28, 2026 at 12:58 PM. Availability also reserves 1 day before pickup for preparation and 1 day after return for turnaround.

---

## 6. Pickup and return times

- [x] Calendar selects dates only.
- [x] Pickup time is a separate input.
- [x] Return time is a separate input.
- [x] Exact timestamps are converted using the selected branch timezone.
- [x] Return must be after pickup.
- [x] Fixed-duration minimum is enforced on branch-local rental dates (pickup date is Day 1).
- [x] Existing maximum rental-period guard remains in place.
- [x] Exact availability is cleared/rechecked whenever dates or times change.

---

## 7. Event date

- [x] Event Date is optional.
- [x] It appears after the rental date/time selection.
- [x] It is visually placed beside Fulfillment.
- [x] UI `min` = pickup date.
- [x] UI `max` = return date.
- [x] If the selected rental range changes and the existing event date becomes invalid, the event date is cleared.
- [x] API independently validates that Event Date is inside the branch-local pickup/return dates.

---

## 8. Fulfillment

- [x] Fulfillment was moved beside Event Date.
- [x] Pickup and Delivery options remain supported by the staff UI.
- [x] Fulfillment changes reset the reservation confirmation intent as needed.
- [x] Delivery pricing continues to read from the reservation policy snapshot when an actual quote/reservation is created.

Layout:

```text
Event date (optional)        Fulfillment
[ date picker ]              [ Pickup / Delivery ▼ ]
```

---

## 9. Payment methods

- [x] Payment method is shown after the rental-period controls.
- [x] Staff-side active payment methods are available independently of public storefront readiness.
- [x] Cash remains staff/business-side usable.
- [x] GCash can remain active for staff even when public storefront QR readiness is not configured.
- [x] Reservation intake loads staff payment-method options from the backend.

---

## 10. Staff availability APIs

Added/updated staff reservation endpoints:

### Availability calendar

```text
GET /api/v1/reservations/availability-calendar
```

- [x] Tenant/branch scoped.
- [x] Requires staff authentication and reservation-management permission.
- [x] Variant-specific.
- [x] Bounded date window.
- [x] Returns ready/active asset counts and per-day capacity.
- [x] Returns pricing timing metadata needed by the calendar.
- [x] Does not claim an asset.
- [x] No longer requires storefront/policy quote context.

### Exact availability check

```text
GET /api/v1/reservations/availability-check
```

- [x] Uses exact pickup and due timestamps.
- [x] Includes prep and turnaround in the blocked interval.
- [x] Counts eligible physical assets that can cover the entire buffered interval.
- [x] Returns pricing preview including extra-day count.
- [x] Enforces fixed-duration minimum.
- [x] Does not claim an asset.
- [x] No longer requires storefront/policy quote context.

### Reservation creation

```text
POST /api/v1/reservations
```

- [x] Remains authoritative.
- [x] Recalculates quote inputs.
- [x] Uses idempotency.
- [x] Locks/revalidates inventory before assigning one physical asset.
- [x] Stores historical pricing/policy/payment snapshots.

---

## 11. Expired holds and availability

- [x] Expired reservation holds are treated as logically released by staff availability previews.
- [x] Database time is used rather than trusting application/client time.
- [x] Exact reservation creation still performs authoritative release/revalidation under the transaction/asset lock.

---

## 12. Policy snapshot behavior

### What a policy snapshot is

A policy snapshot is an immutable copy of the business rules used by a reservation.

It currently stores:

```text
rental_rules
deposit_rules
cancellation_rules
delivery_rules
privacy_notice
effective_at
version
```

Purpose:

- [x] Old reservations retain the rules that were valid when they were created.
- [x] Changing settings later does not rewrite historical reservations.

Example:

```text
September reservation → Policy v1 → ₱500 deposit
October policy change → Policy v2 → ₱1,000 deposit

September reservation still shows ₱500.
```

### Staff-side storefront dependency bug

Problem found:

- Staff availability and quote foundation had inherited a storefront/policy dependency from public reservation architecture.
- Existing tenant bootstrap created an internal **draft storefront row** but did not create the initial policy snapshot.
- This produced:

```text
Reservation quote context could not be resolved for this branch.
```

Important clarification:

- [x] Staff should **not** have to configure or publish a public storefront before taking reservations.
- [x] The internal draft storefront row is currently only a schema/container relationship for the immutable policy snapshot.

### Fix applied

- [x] Calendar availability no longer requires policy/storefront quote context.
- [x] Exact availability no longer requires policy/storefront quote context.
- [x] New workspace bootstrap now creates a default policy snapshot automatically.
- [x] Public storefront publication/configuration remains optional.
- [x] Reservation creation still records a policy snapshot for historical consistency.

Default bootstrap snapshot currently seeds neutral internal defaults:

```text
rental_rules: {}
deposit_rules: {}
cancellation_rules: {}
delivery_rules: {}
privacy_notice: "Drezivo reservation policy"
version: 1
```

---

## 13. Existing workspace backfill migration

Added:

```text
api/src/db/migrations/0038_default_reservation_policy_snapshot.sql
```

Purpose:

- [x] Finds storefront rows that have no policy snapshots.
- [x] Inserts a default version-1 snapshot for those existing workspaces.
- [x] Does not overwrite storefronts that already have policy history.
- [x] Safe for existing tenants.

Local development DB:

- [x] `npm run db:migrate` applied migration `0038_default_reservation_policy_snapshot.sql` successfully.

This means the existing local workspace should now have the internal policy snapshot required for actual reservation creation.

---

## 14. Bootstrap changes

Workspace bootstrap now creates:

```text
Tenant
Main Branch
Owner Membership + branch permissions
Default catalogue categories
Cash payment method
GCash payment method
Draft/internal storefront row
Default Policy Snapshot v1
Trial subscription
Bootstrap/outbox/audit records
```

- [x] Policy snapshot creation is automatic.
- [x] Owner does not need to configure storefront before using staff reservations.
- [x] Bootstrap integration tests verify the seeded policy snapshot.

---

## 15. Calendar navigation fix

Bug observed:

- Previous and next month arrows appeared at the top-left/top-right corners of the entire reservation sheet.

Cause:

- `react-day-picker` navigation uses absolute positioning and was not anchored to a positioned calendar root.

Fix:

- [x] Calendar root is now `relative`.
- [x] Navigation stays inside the calendar header.
- [x] Header layout is now effectively:

```text
‹              September 2026              ›
```

---

## 16. Reservation-sheet UI changes

- [x] Clothing section moved to highest priority.
- [x] Variant selection follows clothing.
- [x] Variant summary displays price, fixed duration, extra-day price, deposit and ready-piece count.
- [x] Variant summary explains prep and turnaround buffers.
- [x] Rental calendar is inline and full width.
- [x] Pickup/return time fields are shown after range selection.
- [x] Event Date and Fulfillment share one responsive row.
- [x] Payment method follows rental details.
- [x] Mobile/narrow layouts still stack responsive fields.

---

## 17. Tests / validation completed during implementation

Backend validation completed at different checkpoints:

- [x] API typecheck passed.
- [x] API lint passed for changed reservation/bootstrap paths.
- [x] Reservation quote integration suite passed: **7/7**.
- [x] Reservation create/availability suite passed: **13/13**.
- [x] Tenant bootstrap integration suite passed: **4/4**.
- [x] Contracts availability tests passed: **5/5**.
- [x] Focused frontend reservation/calendar unit tests previously passed: **19/19** before the local dependency tree became incomplete.
- [x] App source-only TypeScript validation previously passed.
- [x] `git diff --check` passed at multiple checkpoints.

### Current local test-environment limitation

The local `node_modules` tree became incomplete during this work.

Observed error:

```text
Cannot find package 'vitest'
from @testing-library/jest-dom/dist/vitest.mjs
```

- [ ] Reinstall/repair local workspace dependencies.
- [ ] Re-run the focused frontend reservation/calendar tests after dependency repair.

This is an environment/dependency-install issue, not an assertion failure from the reservation feature.

---

## 18. Known repo/tooling follow-ups unrelated to reservation behavior

- [ ] Resolve existing `@asteasolutions/zod-to-openapi@9` / Zod 3 incompatibility so OpenAPI generation can run normally.
- [ ] Resolve existing app-wide jest-dom matcher typing configuration.
- [ ] Resolve existing ESLint/Next config incompatibility in the app workspace.
- [ ] Re-run full repo-wide checks after those tooling issues are repaired.

Do not silently change these dependencies/configs as part of reservation work unless explicitly approved.

---

## 19. Main files changed for this reservation work

### API

```text
api/src/modules/reservations/reservations.availability.repository.ts
api/src/modules/reservations/reservations.controller.ts
api/src/modules/reservations/reservations.middleware.ts
api/src/modules/reservations/reservations.quote.ts
api/src/modules/reservations/reservations.routes.ts
api/src/modules/reservations/reservations.service.ts
api/src/modules/onboarding/tenant-bootstrap.repository.ts
api/src/db/migrations/0038_default_reservation_policy_snapshot.sql
```

### API tests

```text
api/tests/integration/reservation-create.test.ts
api/tests/integration/reservation-quote.test.ts
api/tests/integration/tenant-bootstrap.test.ts
```

### App

```text
app/src/components/reservations/new-reservation-sheet.tsx
app/src/components/reservations/reservation-availability-calendar.tsx
app/src/components/ui/calendar.tsx
app/src/lib/drezivo-api.ts
app/package.json
package-lock.json
```

### App tests

```text
app/tests/unit/new-reservation-sheet.test.tsx
app/tests/unit/reservation-availability-calendar.test.tsx
app/tests/unit/drezivo-api-reservations-list.test.ts
```

### Contracts / docs

```text
contracts/src/availability/availability.ts
contracts/tests/availability-staff.test.ts
contracts/openapi/generate.ts
docs/product/Drezivo-PRD.md
docs/architecture/Drezivo-TRD.md
```

---

## 20. Remaining functional review checklist

Before considering the staff reservation experience fully polished in-browser:

- [ ] Repair local `node_modules` and restart API/app dev servers.
- [ ] Confirm the policy-context error no longer appears in New Reservation.
- [ ] Confirm calendar day styling visually matches:
  - transparent = available
  - amber = limited
  - light red = unavailable/busy
  - accent = selected
- [ ] Confirm previous/next month buttons remain inside the calendar header.
- [ ] Verify a 3-day fixed rental picked up Oct 5 accepts an Oct 7 return and rejects Oct 6.
- [ ] Verify a 3-day + 1-day prep + 1-day turnaround variant communicates the 5-day inventory impact clearly.
- [ ] Verify extra-day pricing in the UI matches backend quote response.
- [ ] Verify an Event Date outside the rental range cannot be submitted.
- [ ] Verify Cash reservation creation.
- [ ] Verify GCash staff reservation creation when GCash is active but storefront QR is not configured.
- [ ] Verify Delivery with the default policy snapshot does not introduce an unexpected fee.
- [ ] Verify one busy physical garment + one free garment shows `Limited / 1 left`, not unavailable.
- [ ] Verify zero eligible garments shows light-red unavailable/busy state.
- [ ] Verify actual reservation creation allocates exactly one eligible physical asset.

---

## 21. Working rules for continuing this feature

- Use the current checkout unless explicitly told otherwise.
- Do not create a new worktree without permission.
- Do not commit without explicit permission.
- Preserve unrelated `docs/second-brain` changes.
- Staff reservation functionality must not require public storefront publication/configuration.
- Calendar preview is advisory; reservation create remains authoritative.
- Do not weaken inventory locking, policy history, idempotency, or tenant authorization for UI convenience.

---

## 22. Current high-level status

```text
Staff reservation flow design       ✅
Variant-aware calendar              ✅
Fixed-duration minimum              ✅
Extra-day pricing                   ✅
Prep/turnaround awareness           ✅
Exact-time availability             ✅
Event-date constraints              ✅
Fulfillment placement               ✅
Payment method integration          ✅
Policy snapshot bootstrap           ✅
Existing-workspace policy backfill  ✅
Calendar navigation fix             ✅
Calendar exception-state styling    ✅
Backend regression tests            ✅
Frontend focused re-test            ⏳ blocked by local node_modules repair
Full repo tooling cleanup            ⏳ separate follow-up
Multi-item / edit / balances (§23)  ✅ in review (#242–#246)
```

---

## 23. Multi-item reservations, edit, balances, delivery and Continue (October 2026)

Handoff for engineers and coding agents picking up this work. The product rules and invariants are
in [ADR 0016](decisions/0016-multi-item-reservations-edit-and-balances.md); read it first. This
section is the implementation map.

### Pull request stack

Merge in this order. Each PR is based on the one before it, so retarget the next PR to `staging`
after its base merges.

| PR | Branch | What it adds |
| --- | --- | --- |
| #241 (merged) | `feat/reservation-delivery-requests` | Delivery always offered; `to_arrange` terms; owner email flags delivery requests |
| #242 | `feat/reservation-continue` | Continue a cancelled, expired or rejected reservation as a new booking |
| #243 | `feat/reservation-edit` | `PATCH /reservations/:id` for customer, dates, event date and fulfillment |
| #244 | `feat/reservation-multi-garment` | Staff book up to 10 items; pickup, return, cancel and completion loop over every allocation |
| #245 | `feat/storefront-multi-piece` | Storefront "Add another item" and multi-item status page |
| #246 | `feat/reservation-quality-pass` | Edit adds and removes items; balance payments; per-item inspection; "item" wording; this documentation |

PR #246 replaces PR #243's interim rule that refused a higher total after payment.

### Endpoints

- `POST /api/v1/reservations` and the storefront guest booking accept `additional_variant_ids`
  (at most 9) next to the main variant.
- `PATCH /api/v1/reservations/:reservationId` edits a reservation. Needs `reservations.manage`,
  `version` and an `Idempotency-Key`.
- `POST /api/v1/reservations/:reservationId/balance-payments/:paymentId/collect` records a received
  balance. Needs `reservations.manage`, `payments.manage`, `evidence.verify` and an
  `Idempotency-Key`.
- The inspection request accepts an optional `reservation_line_id` to inspect one item.
- Reservation detail adds `balance_payments`, line `product_id`, and delivery `fee_minor` and
  `terms`. The list adds `line_count`.
- New error code: `PRICE_CHANGE_NOT_ACCEPTED` (send `accept_price_change: true` to confirm).

### File map

Contracts (`contracts/src/`):

- `reservations/hold.ts`: `MAX_RESERVATION_LINES`, `additional_variant_ids`.
- `reservations/actions.ts`: edit request and response, balance collect request and response,
  inspection `reservation_line_id`.
- `reservations/detail.ts`, `reservations/list.ts`, `reservations/reservation.ts`: detail, list and
  delivery terms fields.
- `storefront/guest-booking.ts`: guest `additional_variant_ids` and `items` on the view.

API (`api/src/modules/reservations/`):

- `reservations.quote.ts`: per-line quoting, `resolveDelivery`.
- `reservations.command.service.ts`, `reservations.command.repository.ts`: multi-line create and
  distinct asset claiming.
- `reservations.edit.service.ts`, `reservations.edit.repository.ts`: edit planning, re-matching
  items to assets, repricing, `settleBalanceAfterEdit`.
- `reservations.balance.service.ts`, `reservations.balance.repository.ts`: balance rows and
  collection.
- `reservations.pickup.service.ts`, `reservations.return.service.ts`,
  `reservations.review.service.ts`, `reservations.cancellation.service.ts`,
  `reservations.completion-gate.service.ts`: loops over every allocation, balance checks.
- `reservations.repository.ts`: list and detail read model; payment summary excludes balances.
- `../guest-booking/`: storefront multi-item booking. `../notifications/email-notifications.ts`:
  owner email lists items and delivery requests.

App (`app/src/components/reservations/`): `reservation-details-sheet.tsx` (Delivery card, Edit,
Continue, refund owed), `reservation-edit-form.tsx`, `reservation-balance-payments.tsx`,
`additional-garments.tsx`, `new-reservation-sheet.tsx` (extra items, Continue prefill),
`reservations-page.tsx`, `reservation-mutation-actions.tsx` (per-item inspection);
`app/src/lib/zoned-time.ts`.

Web (`web/src/components/store/`): `booking/booking-drawer.tsx`, `booking/extra-pieces.tsx`,
`booking-status.tsx`.

### Tests

- API integration (real PostgreSQL): `api/tests/integration/reservation-edit.test.ts`,
  `reservation-multi-garment.test.ts`, plus updates to `reservation-quote`, `reservation-create` and
  `storefront-guest-booking`. Run with `npm run test:integration` in `api/` after
  `docker compose --env-file api/.env up -d` (see `docs/runbooks/local-development.md`), or point
  `TEST_DATABASE_URL` at any disposable PostgreSQL.
- App: `app/tests/unit/reservation-details-sheet.test.tsx`, `additional-garments.test.ts`,
  `new-reservation-sheet.test.tsx`. Web: `web/tests/unit/booking-extra-pieces.test.tsx`.
- Results on #246 (10 October 2026): API integration 496 of 497, API unit 251 of 252, app 473 of
  480, web 65 of 65, contracts 200 of 200. Every failure also fails on clean `staging`: the API
  `pilot-billing` "lapsed shop view-only" test, the API Turnstile "skipped only when no secret" test
  (fails when a local `api/.env` sets Turnstile keys), and seven app tests (two sign-in redirects,
  sign-up back link, catalogue window, fittings reschedule, two reservation tests).

### Gotchas

- Never assume one line, allocation or payment per reservation. Read the initial payment and the
  balances separately.
- Any new query for "the" payment of a reservation must exclude
  `business_key LIKE 'reservation:<id>:balance:%'`. Filtering on the initial-payment key instead
  hides rows that fixtures and older data created under other keys.
- Custody business keys keep the legacy form for one-item reservations; do not change that format.
- Edit inserts new lines at temporary line numbers (1000 and up), then renumbers in two phases
  through negative numbers to avoid the unique `(reservation_id, line_number)` collision.
- Idempotency keys must be at least 8 characters; short test keys fail validation.
- Working-tree files are CRLF on Windows checkouts. Normalize line endings after scripted edits.

### Not built yet

- Partial physical return (one item back early). All items are picked up and returned together.
- Recording a refund when an edit lowers a paid total. The panel only shows the amount owed.
- Renter-side edits. Only staff can edit; renters contact the shop.
- Manual QA on staging by the product owner after the stack merges.
