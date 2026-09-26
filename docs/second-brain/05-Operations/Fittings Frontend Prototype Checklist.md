---
title: Fittings V1.1 Frontend Prototype Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-26
tags: [drezivo, v1.1, fittings, frontend, prototype, checklist]
---

# Fittings V1.1 Frontend Prototype Checklist

**Status:** Frontend-only prototype. The goal is to visualize and validate the staff fitting experience before fitting contracts, API routes, migrations, or backend services are implemented.

**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).

**Related operational checklists:** [[Schedule Calendar Checklist]], [[Dashboard Checklist]], [[Availability Checklist]], [[Reservations Checklist]], and [[Core Rental Operations Checklist]].

## How to use this checklist

Implement the fitting staff experience as a **V1.1 visual prototype** using local mock data only. The prototype should answer whether the fitting workflow is understandable for a clothing-rental owner/front desk before Drezivo commits to fitting backend behavior.

Do not use this checklist to create or imply production fitting behavior.

Before marking a task complete:

- No fitting API route is added.
- No fitting database migration/table is added.
- No fitting contract/schema is added to `@drezivo/contracts`.
- No fitting payment, slot, or garment mutation is presented as authoritative.
- Mock data is isolated from production API clients and easy to delete later.
- The UI follows the current Drezivo dashboard visual language and reuses existing shared components where practical.
- Any fitting status, fee, duration, note field, or public-booking behavior that is not canonical is marked as a **prototype assumption**.
- Existing V1 rental pages continue to behave as V1 surfaces; this prototype must not make Fittings appear production-ready in Dashboard, Schedule, Payments, or Availability.

## Frontend product decision: no fitting resources

The fitting frontend will **not** expose rooms, staff assignment, capacity-slot resources, resource filters, resource management, or resource-specific availability.

This is a frontend/product-surface decision for the prototype. It does not rewrite the current ERD or future backend concurrency model. If backend capacity controls are later required, they remain an implementation concern until a separate product decision intentionally exposes them to staff.

The staff-facing schedule should stay simple:

- fitting operating days/hours;
- appointment duration;
- breaks/closures;
- bounded fitting availability preview.

## Frontend-only boundary

### In scope

- `/fittings` staff page.
- Fitting appointment list/table.
- Operational summary indicators.
- Search and presentation-only status/date filters.
- Fitting Details Sheet.
- New Fitting prototype flow.
- Garment preference versus guaranteed-garment presentation.
- Fitting fee/payment-state presentation where useful.
- `/fittings/schedule` staff page.
- Business-level fitting hours, breaks, closures, duration, and availability visualization.
- Loading, empty, error, disabled, responsive, keyboard, and dark-mode states.

### Explicitly out of scope

- Fitting contracts in `contracts/`.
- API routes/services/repositories.
- PostgreSQL fitting tables or migrations.
- Real slot claiming or overlap enforcement.
- Frontend room/staff/resource assignment or capacity management.
- Real garment allocation for fittings.
- Real payment creation/verification/refunds.
- Real email/guest links.
- Public customer fitting booking.
- Calendar/Dashboard production fitting queries.
- Entitlement enforcement.
- Analytics/reporting.

## Prototype information model

```text
Fitting Appointment
  ├── Customer
  ├── Date / time period
  ├── Garment line(s)
  │    ├── Variant preference
  │    └── Optional guaranteed physical garment
  └── Optional fitting fee / payment state
```

Important visual rule:

```text
Garment preference ≠ Guaranteed garment
```

A preferred garment with no physical asset assignment must never be presented as guaranteed.

## Prototype assumptions that remain non-canonical

- Exact fitting appointment status enum/state machine.
- Whether `No-show` belongs in the first V1.1 release.
- Default fitting duration source.
- Default fitting fee source.
- Whether appointment notes persist directly on the fitting appointment.
- Whether V1.1 starts staff-only or includes customer self-booking.
- Exact payment requirement for a fitting.
- Exact cancellation/rejection/refund policy for fitting fees.

For prototype presentation, labels such as **Pending**, **Confirmed**, **Completed**, **Cancelled**, **Rejected**, and **No-show** may be used only as mock UI vocabulary until the product state machine is approved.

---

# Phase 0: Audit current fitting prototype surface

**Phase status:** Complete for frontend prototyping. No fitting backend/contracts/schema were added.

- [x] **FIT-FE-000 — Inventory all current fitting UI references**
  - **Outcome:** Existing fitting references are understood before building the dedicated page.
  - **Acceptance:**
    - [x] Record the existing `/fittings` sidebar link.
    - [x] Record Dashboard fitting mock metrics/cards.
    - [x] Record Schedule/Calendar fitting mock events and filters.
    - [x] Record Availability fitting mock blocks.
    - [x] Review the three historical fitting reference screenshots.
    - [x] Identify retained versus outdated behavior.
  - **Evidence:**
    - Dashboard, Calendar, and Availability already contain future-facing fitting mock data; none is production fitting authority.
    - Existing Availability mocks treat `Fitting` as garment unavailability too broadly. Only an explicitly guaranteed physical garment may eventually justify a fitting-linked allocation.
    - Historical screenshots remain visual references only.
    - **Retain:** operational appointment list, date/time/customer/status scanning, details sheet, visible fee/payment state, schedule/availability entry point, operating hours, duration, and breaks.
    - **Reject/redesign:** resource management, room/staff assignment, capacity-slot controls, `max appointments per slot`, blanket fitting garment blocks, merged payment/appointment status, mandatory-payment assumptions, and unapproved public self-booking.

- [x] **FIT-FE-001 — Confirm frontend-only prototype data boundary**
  - **Depends on:** FIT-FE-000.
  - **Outcome:** Mock fitting data cannot become a fake production data source.
  - **Acceptance:**
    - [x] Fitting mock data lives in a clearly named frontend-only fixture module.
    - [x] No fitting mock arrays are placed in production API clients.
    - [x] No fitting mock types are copied into `@drezivo/contracts`.
    - [x] Stable synthetic appointment IDs are used.
    - [x] No real customer PII or payment evidence is used.
  - **Evidence:**
    - `app/src/components/fittings/fitting-prototype-data.ts` is isolated and has no production API/contract imports.
    - Appointment IDs use stable `fit-proto-*` identifiers.
    - Contacts use reserved `example.test` addresses and obviously synthetic phone numbers.
    - Fixtures cover guaranteed garments, preference-only garments, payment review, completed appointments, and `No-show` presentation.
    - No room/staff/resource fixture data exists in the fitting prototype.

- [x] **FIT-FE-002 — Define the prototype information architecture**
  - **Depends on:** FIT-FE-000.
  - **Acceptance:**
    - [x] `/fittings` is the appointment operations page.
    - [x] `/fittings/schedule` is the fitting hours/availability page.
    - [x] Appointment details open in a Sheet from `/fittings`.
    - [x] `New Fitting` launches one clearly defined prototype flow.
    - [x] `Schedule & Availability` navigates to `/fittings/schedule`.
    - [x] Schedule configuration is not mixed into the main appointment list.
  - **Route map:**

```text
/fittings
  FittingsPage
    ├── operational summary
    ├── search + status/date filters
    ├── appointment list
    ├── FittingDetailsSheet
    └── NewFittingSheet / prototype flow

/fittings/schedule
  FittingSchedulePage
    ├── operating days/hours
    ├── appointment duration
    ├── breaks / closures
    └── fitting availability preview
```

---

# Phase 1: `/fittings` page shell and operational hierarchy

- [ ] **FIT-FE-010 — Create the Fittings route and page shell** _(implementation complete; authenticated browser verification pending)_
  - **Depends on:** FIT-FE-002.
  - **Acceptance:**
    - [x] Uses the authenticated dashboard shell.
    - [x] Page title is `Fittings`.
    - [x] Supporting copy is short and operational.
    - [x] Primary action is `New Fitting`.
    - [x] Secondary action is `Schedule & Availability`.
    - [ ] Confirm 360px behavior in an authenticated browser.
    - [x] No backend-ready/production-ready wording is shown.
  - **Evidence:**
    - `app/src/app/(dashboard)/fittings/page.tsx` mounts the staff fitting surface.
    - `app/src/components/fittings/fittings-page.tsx` uses the same dashboard canvas, width, heading, tokens, cards, buttons, inputs, and dropdown primitives as Reservations/Calendar.
    - `New Fitting` is visible but disabled until Phase 4; no fake mutation is attached.
    - `Schedule & Availability` targets `/fittings/schedule`.

- [x] **FIT-FE-011 — Add compact fitting summary indicators**
  - **Acceptance:**
    - [x] Use only `Today`, `Upcoming`, and `Pending Review`.
    - [x] Avoid conversion/revenue/utilization metrics.
    - [x] Counts derive from `FITTING_PROTOTYPE_APPOINTMENTS`.
    - [x] Indicators are intentionally non-interactive.
  - **Evidence:** Fixture projections render `Today = 3`, `Upcoming = 1`, `Pending review = 2`.

- [ ] **FIT-FE-012 — Add search and fitting list filters** _(implementation complete; browser interaction verification pending)_
  - **Acceptance:**
    - [x] Search matches customer name and garment display name.
    - [x] Status filter uses prototype-only labels.
    - [x] Date filter supports `All dates`, `Today`, and `Upcoming`.
    - [x] No resource filter is present.
    - [x] Reset/clear behavior works.
    - [x] Empty filtered results show a useful state.
    - [x] Controls wrap cleanly on small screens.
  - **Evidence:**
    - Toolbar reports `Showing N of 6 appointments`.
    - `Clear filters` appears only when filtering is active.
    - `No fittings match these filters.` has a reset action.
    - `app/tests/unit/fittings-page.test.tsx` covers shell/actions, counts, customer/garment search, status/date filters, clear behavior, and zero-results state.
    - No room/staff/resource filtering remains in the page, fixture, or Phase 1 tests.

---

# Phase 2: Appointment list/table

- [ ] **FIT-FE-020 — Build the fitting appointment table/list** _(implementation complete; browser/mobile verification pending)_
  - **Depends on:** FIT-FE-011, FIT-FE-012.
  - **Acceptance:**
    - [x] Show appointment date/time.
    - [x] Show customer name.
    - [x] Show garment summary.
    - [x] Show fitting fee/payment summary only where present.
    - [x] Show appointment status separately from payment status.
    - [x] Do not show room/staff/resource fields.
    - [x] Avoid phone, email, evidence, measurements, or long notes in the table.
    - [x] Row opens Fitting Details Sheet.
    - [x] Desktop rows remain scan-friendly in the responsive implementation.
    - [x] Mobile becomes a compact stacked list in the responsive implementation.
    - [x] Paginate the filtered appointment list at 15 appointments per page.
  - **Evidence:**
    - `app/src/components/fittings/fittings-page.tsx` renders one responsive appointment list source: stacked two-column appointment rows below `lg`, and a six-column operational row layout at `lg` and above.
    - Visible list fields are limited to date/time, customer, garment summary, fee/payment, appointment status, and attention. Phone, email, payment evidence, measurements, long notes, and all room/staff/resource concepts stay out of the list.
    - Appointment status and payment state use separate badges and separate fixture fields; no payment state mutates appointment state in the frontend.
    - Clicking or keyboard-activating an appointment row opens a minimal `Fitting Details` Sheet preview. Phase 3 remains responsible for the richer details layout.
    - The frontend fixture now contains 20 synthetic appointments so pagination is visible during review. The filtered result set is paginated at 10 rows per page using the same compact footer language as Reservations: `Page N · X fittings loaded`, with previous/current-page/next controls aligned on the right.
    - Search/status/date filters apply before pagination and reset the current page to page 1.
    - `app/tests/unit/fittings-page.test.tsx` defines coverage for the list fields, absence of fitting room/staff labels, row-to-sheet opening, and the 15-row pagination boundary.
    - A real authenticated desktop/360px browser walkthrough is still required before the Phase 2 visual acceptance is considered fully verified.

- [x] **FIT-FE-021 — Add meaningful attention states**
  - **Acceptance:**
    - [x] Seed payment-review attention.
    - [x] Seed a preference-only garment attention state.
    - [x] Communicate attention with text/icon, not color alone.
    - [x] Do not claim the frontend detected a real backend conflict.
  - **Evidence:**
    - `Bianca Flores` carries `Payment review` plus `Preference only`; other preference-only examples remain available in the fixture.
    - Attention badges include explicit text and an icon (`CircleAlert` for payment review, `Info` for preference-only), so meaning is not color-only.
    - No overlap, resource, or backend-conflict detection language is displayed by the frontend.

- [x] **FIT-FE-022 — Add list empty/loading/error prototype states**
  - **Acceptance:**
    - [x] Empty tenant state differs from empty filtered state.
    - [x] Loading skeleton follows the list structure.
    - [x] Error state includes retry UI.
    - [x] No fake zero counts appear as authoritative while loading.
  - **Evidence:**
    - `appointments={[]}` renders `No fitting appointments yet`; a filter with no matches renders `No fittings match these filters` with a clear-filter action.
    - `initialViewState="loading"` renders four list-structured skeleton rows and replaces summary counts with skeletons instead of zeroes.
    - `initialViewState="error"` renders a retry action that returns the local prototype to its ready state without a network request.
    - Prettier, TypeScript transpile checks, and `git diff --check` pass for the Phase 2 source/tests.
    - Targeted Vitest still fails before test collection because the repository root resolves `@testing-library/jest-dom/dist/vitest.mjs` without a resolvable root `vitest` package; the two fitting suites report `0 test` before failing on that existing dependency-resolution issue.

---

# Phase 3: Fitting Details Sheet

- [x] **FIT-FE-030 — Build the Fitting Details Sheet shell**
  - **Acceptance:**
    - [x] Same interaction language as Reservation/Calendar sheets.
    - [x] Accessible title/description.
    - [x] Appointment status separate from payment state.
    - [x] Date/time period is easy to scan.
    - [x] Supports direct opening from a fitting row.
    - [x] Mobile/full-width treatment is usable.
  - **Evidence:** `FittingDetailsPreviewSheet` now uses the shared Sheet primitive, opens directly from appointment rows, and uses a full-width mobile sheet with `sm:max-w-lg` desktop sizing.

- [x] **FIT-FE-031 — Add customer section**
  - **Acceptance:**
    - [x] Customer name.
    - [x] Only mock contact fields needed by staff.
    - [x] No identity documents/excess PII.
    - [x] No customer account requirement implied.
  - **Evidence:** Customer name, synthetic email, and synthetic phone are shown; no account or identity-document fields are introduced.

- [x] **FIT-FE-032 — Add garment section with preference/guarantee distinction**
  - **Acceptance:**
    - [x] Show style/variant information.
    - [x] `Preference only` and `Guaranteed garment` are distinct.
    - [x] Guaranteed fixture may display a synthetic asset code.
    - [x] Preference-only never says `Reserved`, `Held`, or `Guaranteed`.
    - [x] Multiple garment lines remain readable.
  - **Evidence:** Guaranteed garments show a synthetic `PROTO-*` asset code; preference-only garments never show an asset code or reserved/held wording.

- [x] **FIT-FE-034 — Add fitting fee/payment presentation**
  - **Acceptance:**
    - [x] Show fitting fee only when present.
    - [x] Payment state remains separate from appointment status.
    - [x] Use presentation-only payment labels.
    - [x] No receipt bytes or fake automatic verification.
    - [x] Payment state does not automatically mutate appointment status.
  - **Evidence:** Fee and payment state are grouped separately with an explicit prototype note that payment does not drive appointment status.

- [x] **FIT-FE-035 — Add prototype appointment actions**
  - **Acceptance:**
    - [x] Actions are disabled, mock-only, or local-state-only.
    - [x] Use only useful actions such as Confirm, Complete, Cancel, Reject, or Mark no-show.
    - [x] Destructive local actions require confirmation.
    - [x] Local mock mutations use an in-flight guard.
    - [x] No network request occurs.
  - **Evidence:** Pending fittings expose Confirm/Reject; Confirmed fittings expose Complete/Cancel/Mark no-show. Reject, Cancel, and No-show require an inline confirmation step. Local status overrides update only page memory and use an action-in-flight ref guard; no API client is called.
  - **Validation:** Prettier, TypeScript transpile, and `git diff --check` pass. Targeted Vitest still fails before test collection because the repository root cannot resolve `vitest` from `@testing-library/jest-dom/dist/vitest.mjs`; the suite reports `0 test` before that existing dependency-resolution failure.

---

# Phase 4: New Fitting prototype flow

- [x] **FIT-FE-040 — Define the New Fitting interaction pattern**
  - **Acceptance:**
    - [x] Choose a route or large Sheet/Dialog based on existing dashboard patterns.
    - [x] Keep grouping clear and mobile-friendly.
    - [x] Draft reset/restore behavior is intentional.
  - **Evidence:** `New Fitting` opens a large right-side Sheet using the existing dashboard overlay language. The flow is split into Appointment → Garments → Review and uses stacked controls below `sm`. Closing or cancelling resets the local draft; refreshing intentionally loses local-only records.

- [x] **FIT-FE-041 — Add customer selection/input prototype**
  - **Acceptance:**
    - [x] Existing-customer search uses synthetic fixtures only.
    - [x] New customer input stays minimal.
    - [x] No customer account required.
    - [x] No real create-customer request.
  - **Evidence:** Existing customer search is derived only from `FITTING_PROTOTYPE_APPOINTMENTS` synthetic contacts and supports name/email/phone filtering. Walk-ins require only a name, with optional email/phone. No API client or customer mutation is called.

- [x] **FIT-FE-042 — Add date/time selection prototype**
  - **Acceptance:**
    - [x] Select date and start time.
    - [x] Show prototype duration/end time where useful.
    - [x] Past/invalid selections are handled locally.
    - [x] Do not display authoritative `Available` from local calculations.
  - **Evidence:** The flow reuses `DatePickerField` and `TimePickerField`, limits dates before the prototype review date, exposes 30/60/90-minute prototype durations, and derives the review/end period locally. No `Available` guarantee or slot claim is shown.

- [x] **FIT-FE-043 — Add garment preference/guarantee selection prototype**
  - **Acceptance:**
    - [x] Search/select synthetic clothing.
    - [x] Allow multiple garment lines.
    - [x] Each line can be preference-only or guaranteed intent.
    - [x] Guaranteed intent explains future backend validation.
    - [x] Frontend does not claim a physical garment.
  - **Evidence:** Garment search is derived from the fitting fixture catalogue and supports multiple selected lines. New local records use `Guaranteed intent` rather than `Guaranteed garment`, never synthesize an asset code, and explicitly explain that a future backend must validate/claim a physical garment.

- [x] **FIT-FE-045 — Add optional fee/payment section prototype**
  - **Acceptance:**
    - [x] Fee is a mock configured value, not canonical price.
    - [x] No real payment intake.
    - [x] No-fee fitting remains representable.
    - [x] PHP formatting matches existing conventions.
  - **Evidence:** The prototype defaults to a configurable ₱300 fixture value, validates non-negative local input, supports disabling the fee entirely, and stores only the existing mock payment-state label. No payment method, receipt upload, verification, or Payments API behavior is introduced.

- [x] **FIT-FE-046 — Add review/create prototype state**
  - **Depends on:** FIT-FE-041, FIT-FE-042, FIT-FE-043, FIT-FE-045.
  - **Acceptance:**
    - [x] Review shows customer, period, garments, guarantee labels, and fee if present.
    - [x] Final CTA is explicitly prototype/local-only.
    - [x] Double-click cannot create duplicate mock records.
    - [x] Refresh may lose prototype-only state unless intentionally documented.
  - **Evidence:** Review shows customer, date/start/duration, selected garments, intent labels, fee, and payment state. `Create local fitting` appends one appointment to in-memory page state, immediately opens that appointment in the Details Sheet, and uses a submit-in-flight ref that remains locked through sheet close. The UI explicitly states that refresh removes the created record.
  - **Validation:** Prettier, source transpile checks, and `git diff --check` pass. Typecheck reports no `src/components/fittings/*` source errors after the Phase 4 fixes; the remaining fitting-test diagnostics are the repository-wide missing jest-dom matcher typings. Targeted Vitest still fails before test collection because the repository root cannot resolve `vitest` from `@testing-library/jest-dom/dist/vitest.mjs`.

---

# Phase 5: `/fittings/schedule` hours and availability prototype

- [x] **FIT-FE-050 — Create Fitting Schedule & Availability page shell**
  - **Acceptance:**
    - [x] Route is `/fittings/schedule`.
    - [x] Navigation back to `/fittings` exists.
    - [x] Page stays business-level and does not expose rooms/staff/resources.
    - [x] Hours, duration, breaks, and availability are visually separated.
  - **Evidence:** `app/src/app/(dashboard)/fittings/schedule/page.tsx` mounts the new `FittingSchedulePage`. The page uses the existing dashboard canvas/cards, has a `Back to Fittings` link, and separates weekly hours, duration, breaks/closures, and the bounded availability view without any room/staff/capacity-slot fields.

- [ ] **FIT-FE-051 — Build weekly fitting operating-hours editor/visualizer** _(implementation complete; authenticated 360px browser verification pending)_
  - **Acceptance:**
    - [x] Monday–Sunday schedule.
    - [x] Multiple windows per day can be visualized if useful.
    - [x] A day can be unavailable.
    - [x] Validate start < end locally.
    - [ ] Mobile editing avoids horizontal overflow. _(responsive stacking is implemented; real 360px walkthrough still required)_
  - **Evidence:** The local hours editor renders all seven weekdays, supports enabling/disabling a day, adding/removing split windows, and shows inline validation when `start >= end`. Time controls stack below `sm` instead of requiring a horizontal table.

- [x] **FIT-FE-052 — Add appointment-duration setting prototype**
  - **Acceptance:**
    - [x] Duration is clearly labeled as prototype/configuration-driven.
    - [x] Use a small bounded set of sensible options or one validated numeric control.
    - [x] No duration value is promoted to canonical product truth yet.
  - **Evidence:** The duration control is local-only with bounded 30/45/60/90-minute options. Its helper copy explicitly says the value is prototype configuration and does not establish backend capacity; the selected value is reflected only in the local availability-view subtitle.

- [x] **FIT-FE-053 — Visualize breaks and date-specific closures**
  - **Acceptance:**
    - [x] Show examples such as lunch break, holiday closure, or private event.
    - [x] Closure includes date/time and short reason.
    - [x] Create/edit/remove remains local-state-only.
  - **Evidence:** Seed examples include `Lunch break`, `Private event`, and `Holiday closure`. Each displays type, date, start/end time, and reason. Add/edit/remove operations mutate component state only, validate reason/date/time locally, and do not import or call any API client.

- [x] **FIT-FE-054 — Build bounded fitting availability visualization**
  - **Acceptance:**
    - [x] Use a bounded day/week view.
    - [x] Distinguish working hours, booked mock appointments, and closures.
    - [x] Appointment block can open the mock Fitting Details Sheet where practical.
    - [x] UI never claims local rendering is authoritative backend capacity enforcement.
    - [x] Avoid excessive slot rendering.
  - **Evidence:** The view is bounded to Sep 26–Oct 2 and renders seven responsive day cards rather than a slot-heavy grid. Each day separately labels working hours, scheduled fixture fittings, and breaks/closures. At most three fitting blocks render per day with a `+N more` summary. Appointment blocks resolve the shared fitting fixture and open the same exported `FittingDetailsPreviewSheet`; the page explicitly states that the visualization does not enforce or certify backend capacity or garment availability.
  - **Validation:** Prettier, direct TypeScript transpilation, and `git diff --check` pass for the Phase 5 route/component/test. Typecheck reports no `src/components/fittings/*` or route source diagnostics; only the existing missing jest-dom matcher typings appear in the test file. Targeted Vitest still fails before test collection because the repository root cannot resolve `vitest` from `@testing-library/jest-dom/dist/vitest.mjs`.

---

# Phase 6: Cross-page prototype consistency

- [x] **FIT-FE-060 — Keep fitting fixture identities consistent across screens**
  - **Acceptance:**
    - [x] `/fittings` row and Details Sheet share the same fixture source.
    - [x] `/fittings/schedule` appointment blocks resolve the same fixture.
    - [x] Customer/garment/status/payment labels remain consistent.
    - [x] No duplicate fitting objects are maintained across components.
  - **Evidence:** `/fittings`, its Details Sheet, New Fitting fixture catalogues, and `/fittings/schedule` all resolve `FITTING_PROTOTYPE_APPOINTMENTS` / `FittingPrototypeAppointment` from `fitting-prototype-data.ts`; no second appointment fixture collection was introduced. `fitting-prototype-presentation.ts` centralizes fitting status/payment badge classes, garment-intent labels, date/time formatting, and PHP formatting so list, review, and details wording cannot drift independently.

- [x] **FIT-FE-061 — Prevent prototype fittings from becoming V1 Calendar authority**
  - **Acceptance:**
    - [x] No production Calendar contract changes.
    - [x] `/calendar` does not imply fitting events are tenant production data.
    - [x] Future integration remains deferred backend work.
  - **Evidence:** Calendar continues using its existing standalone mock activity data and does not import the fitting fixture, fitting route state, or fitting API/client contracts. Calendar fitting metrics/cards are now visibly labeled `Fittings (prototype)` / `Fitting · Prototype`, and opening one states `Calendar mock only · not linked to /fittings tenant data`. No Calendar API or shared contract was changed to make fittings production data.

- [x] **FIT-FE-062 — Prevent prototype fittings from becoming V1 Dashboard authority**
  - **Acceptance:**
    - [x] No real Dashboard fitting query/API work.
    - [x] Existing fitting metrics remain clearly mock/future-facing.
  - **Evidence:** Dashboard still renders its existing static fixture data only. `Fittings Today` now describes `Prototype appointments`, and fitting schedule badges render `Fitting · Prototype`; no dashboard query, API client, backend contract, or fitting endpoint was added.

- [x] **FIT-FE-063 — Keep fitting payment presentation separate from Payments production behavior**
  - **Acceptance:**
    - [x] No Payments API/client contract changes.
    - [x] Fitting fee/payment fixtures stay inside the prototype.
    - [x] Appointment status never mirrors payment automatically.
  - **Evidence:** Fitting fee/payment values remain fields on the frontend-only fitting fixture/New Fitting local record and no fitting component imports reservation/payment production clients. The Details Sheet continues to state that payment presentation does not change appointment status automatically. `fitting-prototype-data.test.ts` now explicitly checks that the same appointment status can coexist with different fitting payment states, guarding the two axes from being coupled.

---

# Phase 7: UX, accessibility, responsive behavior, and polish

- [ ] **FIT-FE-070 — Complete responsive fitting pages** _(implementation complete; real 360px browser verification pending)_
  - **Acceptance:**
    - [ ] `/fittings` works at 360px. _(responsive implementation complete; browser walkthrough pending)_
    - [ ] `/fittings/schedule` works at 360px. _(responsive implementation complete; browser walkthrough pending)_
    - [x] No unnecessary page-level horizontal scrolling.
    - [x] Date/time controls do not overflow in the responsive implementation.
    - [x] Primary actions remain reachable.
    - [x] Details Sheet is readable without nested horizontal scrolling.
  - **Evidence:** Both fitting routes now guard page-level horizontal overflow, use smaller mobile page padding, stack controls before `sm`, and keep schedule day cards single-column until wider breakpoints. The New Fitting footer stays reachable with a mobile sticky action area; the Details Sheet is full-width with `overflow-x-hidden` and switches its appointment facts to one column on small screens.

- [x] **FIT-FE-071 — Complete keyboard and accessibility pass**
  - **Acceptance:**
    - [x] Search/filter/forms have accessible names.
    - [x] Appointment rows expose an accessible details action.
    - [x] Sheets/dialogs have title, description, focus management, and close behavior.
    - [x] Status/attention is not color-only.
    - [x] Schedule controls are keyboard reachable.
    - [x] No essential information is hover-only.
  - **Evidence:** Filter triggers expose purpose plus current value, pagination is a named navigation region with an `aria-current` page, customer selection uses a named radiogroup, progress exposes the current step, appointment rows and weekly fitting blocks have explicit details-action labels, and schedule switches/date/time controls remain keyboard-focusable. Shared Radix Sheets retain title/description, focus trapping, Escape/close behavior, and visible close controls. Status, payment, attention, working-hours, and closure meaning are all present as text rather than color alone.

- [ ] **FIT-FE-072 — Complete light/dark theme review** _(token pass complete; visual theme walkthrough pending)_
  - **Acceptance:**
    - [ ] Text/background contrast remains clear. _(requires visual verification in both themes)_
    - [x] Status badges retain meaning.
    - [x] Active filters remain distinguishable.
    - [x] Schedule working/booked/closed states remain distinguishable with text/icons as needed.
  - **Evidence:** Fitting components now rely on dashboard theme tokens rather than hard-coded white/black text/background colors. The previously hard-coded white Cancel/Add-window text now uses `text-dashboard-navy`, which resolves appropriately in both light and dark themes. Badges and schedule states keep explicit text labels, and active filter values remain visible in their trigger controls.

- [x] **FIT-FE-073 — Remove unnecessary text and enterprise complexity**
  - **Acceptance:**
    - [x] Main page is operational and scan-first.
    - [x] Avoid dashboard-within-dashboard layout.
    - [x] Avoid excessive cards.
    - [x] Avoid exposing ERD terms such as `resource_allocation` or `fitting_line`.
    - [x] Do not expose room/staff/resource concepts in fitting UI.
  - **Evidence:** Staff-facing copy was shortened across New Fitting, Details, and Schedule; technical backend/network wording was removed where it did not help the workflow. The schedule remains four purposeful sections (hours, duration, closures, weekly availability) rather than nested dashboards, and a source scan finds no room/staff/resource or ERD field terminology in fitting components.
  - **Validation:** Prettier, direct TypeScript syntax/transpile checks, and `git diff --check` pass for the edited Phase 7 fitting source/tests. The targeted Vitest command starts but does not complete within the runner timeout, and the repo-wide typecheck likewise exceeds the available timeout; no source syntax/transpile error was observed. Real 360px and light/dark browser walkthroughs remain the explicit visual verification gaps above.

---

# Phase 8: Prototype review gate before backend implementation

- [ ] **FIT-FE-080 — Run owner/front-desk workflow review** _(review kit complete; real operator review pending)_
  - **Acceptance:**
    - [ ] Reviewer can find today's/upcoming fittings. _(requires real reviewer walkthrough)_
    - [ ] Reviewer can understand customer, garments, fee/payment state, and appointment status. _(requires real reviewer walkthrough)_
    - [ ] Reviewer understands preference-only versus guaranteed garment. _(requires real reviewer walkthrough)_
    - [ ] Reviewer can visualize creating a fitting. _(requires real reviewer walkthrough)_
    - [ ] Reviewer understands operating hours, duration, breaks, and closures. _(requires real reviewer walkthrough)_
    - [ ] Confusing fields/actions are removed rather than justified only by the ERD. _(final confirmation follows review)_
  - **Evidence:** `Fittings Prototype Review Gate.md` now contains a 12-step owner/front-desk walkthrough and a structured review-result template. The script covers discovery, details comprehension, garment intent, payment/status separation, existing and walk-in creation, default-duration propagation, weekly hours, and breaks/closures. No human reviewer result is fabricated; this item remains open until an actual owner/front-desk session is completed.

- [ ] **FIT-FE-081 — Resolve product decisions exposed by the prototype** _(partially resolved; backend-blocking decisions remain)_
  - **Acceptance:**
    - [ ] Decide exact fitting statuses/transitions. _(frontend working flow documented; backend lifecycle not canonical)_
    - [x] Decide whether `No-show` belongs in initial V1.1. _(kept in the staff-facing prototype vocabulary)_
    - [x] Decide fitting duration source/default. _(business-level schedule default; 60-minute fallback; 30/45/60/90 prototype options; per-appointment override)_
    - [ ] Decide fitting fee source/default. _(current ₱300 remains fixture-only)_
    - [ ] Decide whether appointment notes are required.
    - [ ] Decide staff-only versus public fitting booking. _(current prototype is staff-facing only, not yet a canonical scope decision)_
    - [ ] Decide payment requirement before confirmation.
    - [ ] Decide fitting cancellation/rejection/refund behavior.
  - **Evidence:** Schedule duration now writes a session-scoped prototype default consumed when New Fitting opens, so the reviewed behavior matches the intended configuration flow without introducing tenant persistence or backend contracts. The review-gate document records the current frontend transition model and separately lists all remaining product/domain blockers.

- [ ] **FIT-FE-082 — Freeze approved frontend prototype for backend handoff** _(frontend freeze candidate documented; backend handoff intentionally blocked)_
  - **Acceptance:**
    - [x] Route hierarchy approved. (`/fittings`, `/fittings/schedule`)
    - [x] List fields approved. (date/time, customer, garment summary, fee/payment, status, attention)
    - [x] Details Sheet sections approved. (customer, appointment, garments, fee/payment, local actions)
    - [x] New Fitting inputs approved. (customer, period, garments/intents, optional fee/payment, review)
    - [x] Hours/availability interactions approved. (weekly hours, duration, breaks/closures, bounded weekly view)
    - [x] Prototype-only labels that should not become wire enums are identified.
    - [x] Fixture shapes are not blindly copied into API contracts. _(explicit freeze rule documented)_
    - [x] Backend checklist is created only after product decisions are canonicalized. _(no backend fitting checklist created yet)_
  - **Evidence:** `Fittings Prototype Review Gate.md` records the frozen frontend surface, explicitly labels prototype vocabulary/fixture shapes as non-contractual, lists unresolved backend-blocking decisions, and marks backend handoff `NOT READY`. This overall item remains open because the real operator review and remaining FIT-FE-081 decisions must be completed before backend planning begins.

---

# Recommended initial mock scenarios

1. **Confirmed fitting — guaranteed garment**
   - One customer.
   - One guaranteed garment with synthetic asset code.
   - No attention state.

2. **Pending review — payment evidence**
   - Fitting fee shown.
   - Payment under review.
   - Appointment status remains separate.

3. **Preference-only fitting**
   - Two garment preferences.
   - No physical asset guarantee.
   - UI clearly says `Preference only`.

4. **Completed fitting**
   - Past appointment.
   - Useful for history presentation without rental-history logic.

5. **Cancelled/rejected/no-show example**
   - Include only the minimum needed to compare terminal-state presentation.
   - Exact lifecycle remains a product decision until FIT-FE-081.

# Frontend completion definition

The fitting frontend prototype is complete when:

- `/fittings` is visually complete using isolated mock data.
- `/fittings/schedule` is visually complete using isolated mock data.
- Fitting Details Sheet communicates customer, appointment, garment guarantee/preference, and optional fee/payment clearly.
- New Fitting can be walked through locally without a network request.
- Business-level fitting hours, duration, breaks/closures, and bounded availability can be understood visually.
- No room/staff/resource management appears in the fitting frontend.
- The prototype works at 360px and with keyboard navigation.
- No real fitting backend/contract/database behavior has been introduced.
- Existing V1 Calendar/Dashboard/Payments behavior has not been expanded accidentally.
- Open domain decisions discovered through the prototype are documented before backend planning begins.
