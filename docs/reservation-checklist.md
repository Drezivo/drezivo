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

Agreed behavior:

- [x] `included_duration_minutes` is the base-price duration.
- [x] For `fixed_duration`, it is also a **hard minimum rental duration**.
- [x] A 3-day fixed rental cannot be booked for 1 or 2 days.
- [x] Exactly 3 days uses the base rental price.
- [x] More than 3 days is allowed.
- [x] Extra time is charged using the existing extra-day price rule.
- [x] Partial extra days round upward according to the existing quote logic.
- [x] `daily` pricing does not inherit the fixed-duration minimum rule.

Examples:

```text
72 hours   → base price
73–96 hrs  → base + 1 extra day
97–120 hrs → base + 2 extra days
```

### Exact-time minimum enforcement

- [x] The UI checks exact pickup and return timestamps.
- [x] API quote/check paths also reject intervals shorter than the fixed-duration minimum.
- [x] This cannot be bypassed by calling the API directly.

Example:

```text
Pickup: Sep 25 · 12:58 PM
3-day minimum
Earliest valid return: Sep 28 · 12:58 PM
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
- [x] Fixed-duration minimum is enforced using elapsed timestamp duration.
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
- [ ] Verify a 3-day fixed rental cannot be reserved below the exact 72-hour boundary.
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
```
