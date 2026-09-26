---
title: Fittings V1.1 Implementation Checklist
type: implementation-checklist
status: in-progress
owner: Drezivo team
updated: 2026-09-26
tags: [drezivo, v1.1, fittings, frontend, backend, implementation, checklist]
---

# Fittings V1.1 Implementation Checklist

**Status:** Frontend prototype implemented and approved as the staff-facing direction. Backend implementation is the next workstream, subject to the backend decision gates in this checklist.

This file is the feature-wide implementation checklist for `/fittings` and `/fittings/schedule`. The original frontend prototype phases are retained below as implementation history; the backend phases are appended after the frontend section.

**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).

**Related operational checklists:** [[Schedule Calendar Checklist]], [[Dashboard Checklist]], [[Availability Checklist]], [[Reservations Checklist]], and [[Core Rental Operations Checklist]].

## How to use this checklist

Use the frontend phases to preserve the approved staff workflow and UI constraints. Use the backend phases at the bottom of this file to turn that prototype into production behavior without copying mock fixture shapes or prototype labels directly into contracts.

The frontend prototype remains the interaction reference. The PRD, TRD, Data Model, migrations, contracts, and API conventions remain authoritative for production behavior. Where the prototype and canonical backend documents disagree, resolve the product/domain decision explicitly before implementing the affected backend phase.

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

## Frontend prototype boundary

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
- Business-level fitting hours, breaks, closures, and default duration.
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

- Exact fitting appointment persisted status enum/state machine.
- Whether the approved frontend `No-show` label maps directly to a persisted backend state or another canonical representation.
- Backend persistence and validation rules for the approved business-level default-duration behavior.
- Default fitting fee source.
- Whether appointment notes persist directly on the fitting appointment.
- Whether V1.1 starts staff-only or includes customer self-booking.
- Exact payment requirement for a fitting.
- Exact cancellation/rejection/refund policy for fitting fees.

For prototype presentation, labels such as **Pending**, **Confirmed**, **Completed**, **Cancelled**, **Rejected**, and **No-show** remain presentation vocabulary until the backend state machine is approved.

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
    - **Retain:** operational appointment list, date/time/customer/status scanning, details sheet, visible fee/payment state, schedule entry point, operating hours, duration, and breaks.
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
    - [x] `/fittings/schedule` is the fitting schedule-settings page.
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
```

---

# Phase 1: `/fittings` page shell and operational hierarchy

- [x] **FIT-FE-010 — Create the Fittings route and page shell**
  - **Depends on:** FIT-FE-002.
  - **Acceptance:**
    - [x] Uses the authenticated dashboard shell.
    - [x] Page title is `Fittings`.
    - [x] Supporting copy is short and operational.
    - [x] Primary action is `New Fitting`.
    - [x] Secondary action is `Schedule & Availability`.
    - [x] Confirm 360px behavior in an authenticated browser.
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

- [x] **FIT-FE-012 — Add search and fitting list filters**
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

- [x] **FIT-FE-020 — Build the fitting appointment table/list**
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
    - Authenticated desktop/360px browser behavior has been reviewed and accepted.

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

# Phase 5: `/fittings/schedule` hours and schedule-settings prototype

- [x] **FIT-FE-050 — Create Fitting Schedule & Availability page shell**
  - **Acceptance:**
    - [x] Route is `/fittings/schedule`.
    - [x] Navigation back to `/fittings` exists.
    - [x] Page stays business-level and does not expose rooms/staff/resources.
    - [x] Hours, duration, and breaks/closures are visually separated.
  - **Evidence:** `app/src/app/(dashboard)/fittings/schedule/page.tsx` mounts the `FittingSchedulePage`. The page uses the existing dashboard canvas/cards, has a `Back to Fittings` link, and keeps the V1 schedule surface focused on weekly hours, default duration, and breaks/closures without any room/staff/capacity-slot fields.

- [x] **FIT-FE-051 — Build weekly fitting operating-hours editor/visualizer**
  - **Acceptance:**
    - [x] Monday–Sunday schedule.
    - [x] Multiple windows per day can be visualized if useful.
    - [x] A day can be unavailable.
    - [x] Validate start < end locally.
    - [x] Mobile editing avoids horizontal overflow.
  - **Evidence:** The local hours editor renders all seven weekdays, supports enabling/disabling a day, adding/removing split windows, and shows inline validation when `start >= end`. Time controls stack below `sm` instead of requiring a horizontal table.

- [x] **FIT-FE-052 — Add appointment-duration setting prototype**
  - **Acceptance:**
    - [x] Duration is clearly labeled as prototype/configuration-driven.
    - [x] Use a small bounded set of sensible options or one validated numeric control.
    - [x] No duration value is promoted to canonical product truth yet.
  - **Evidence:** The duration control uses bounded 30/45/60/90-minute options. The selected business-level default is session-scoped for the prototype and becomes the initial duration in New Fitting; staff can still override an individual appointment.

- [x] **FIT-FE-053 — Visualize breaks and date-specific closures**
  - **Acceptance:**
    - [x] Show examples such as lunch break, holiday closure, or private event.
    - [x] Closure includes date/time and short reason.
    - [x] Create/edit/remove remains local-state-only.
  - **Evidence:** Seed examples include `Lunch break`, `Private event`, and `Holiday closure`. Each displays type, date, start/end time, and reason. Add/edit/remove operations mutate component state only, validate reason/date/time locally, and do not import or call any API client.

- [x] **FIT-FE-054 — De-scope duplicate fitting availability visualization**
  - **Acceptance:**
    - [x] Do not duplicate the main Calendar page inside `/fittings/schedule`.
    - [x] Keep `/fittings/schedule` focused on configuration: hours, default duration, and breaks/closures.
    - [x] Scheduled fitting visualization remains a Calendar responsibility for V1.
  - **Evidence:** The earlier bounded weekly availability section was removed after review because it duplicated Calendar behavior and added another scheduling surface to maintain for V1.
  - **Validation:** Prettier, direct TypeScript transpilation, and `git diff --check` pass for the Phase 5 route/component/test. Typecheck reports no `src/components/fittings/*` or route source diagnostics; only the existing missing jest-dom matcher typings appear in the test file. Targeted Vitest still fails before test collection because the repository root cannot resolve `vitest` from `@testing-library/jest-dom/dist/vitest.mjs`.

---

# Phase 6: Cross-page prototype consistency

- [x] **FIT-FE-060 — Keep fitting fixture identities consistent across screens**
  - **Acceptance:**
    - [x] `/fittings` row and Details Sheet share the same fixture source.
    - [x] Customer/garment/status/payment labels remain consistent.
    - [x] No duplicate fitting objects are maintained across components.
  - **Evidence:** `/fittings`, its Details Sheet, and New Fitting fixture catalogues resolve `FITTING_PROTOTYPE_APPOINTMENTS` / `FittingPrototypeAppointment` from `fitting-prototype-data.ts`; no second appointment fixture collection was introduced. `fitting-prototype-presentation.ts` centralizes fitting status/payment badge classes, garment-intent labels, date/time formatting, and PHP formatting so list, review, and details wording cannot drift independently.

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

- [x] **FIT-FE-070 — Complete responsive fitting pages**
  - **Acceptance:**
    - [x] `/fittings` works at 360px.
    - [x] `/fittings/schedule` works at 360px.
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

- [x] **FIT-FE-072 — Complete light/dark theme review**
  - **Acceptance:**
    - [x] Text/background contrast remains clear.
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
  - **Evidence:** Staff-facing copy was shortened across New Fitting, Details, and Schedule; technical backend/network wording was removed where it did not help the workflow. The schedule is limited to three purposeful configuration areas (hours, duration, closures), and a source scan finds no room/staff/resource or ERD field terminology in fitting components.
  - **Validation:** Prettier, direct TypeScript syntax/transpile checks, and `git diff --check` pass for the edited Phase 7 fitting source/tests. The targeted Vitest command starts but does not complete within the runner timeout, and the repo-wide typecheck likewise exceeds the available timeout; no source syntax/transpile error was observed. Real 360px and light/dark browser walkthroughs remain the explicit visual verification gaps above.

---

# Phase 8: Prototype review gate before backend implementation

- [x] **FIT-FE-080 — Run owner/front-desk workflow review**
  - **Acceptance:**
    - [x] Reviewer can find today's/upcoming fittings.
    - [x] Reviewer can understand customer, garments, fee/payment state, and appointment status.
    - [x] Reviewer understands preference-only versus guaranteed garment.
    - [x] Reviewer can visualize creating a fitting.
    - [x] Reviewer understands operating hours, duration, breaks, and closures.
    - [x] Confusing fields/actions are removed rather than justified only by the ERD.
  - **Evidence:** `Fittings Prototype Review Gate.md` contains the owner/front-desk walkthrough and review-result structure. The frontend workflow has now been reviewed and accepted for discovery, details comprehension, garment intent, payment/status separation, existing and walk-in creation, default-duration propagation, weekly hours, and breaks/closures.

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
    - [x] Schedule interactions approved. (weekly hours, default duration, breaks/closures; duplicate weekly availability view removed)
    - [x] Prototype-only labels that should not become wire enums are identified.
    - [x] Fixture shapes are not blindly copied into API contracts. _(explicit freeze rule documented)_
    - [x] Backend implementation remains blocked until product decisions are canonicalized; the phased backend planning checklist may exist in this file before implementation begins.
  - **Evidence:** `Fittings Prototype Review Gate.md` records the frozen frontend surface, explicitly labels prototype vocabulary/fixture shapes as non-contractual, and lists unresolved backend-blocking decisions. The backend checklist below is a planning artifact only; BE-1+ implementation remains gated by BE-0 until those decisions are canonicalized.

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
- Business-level fitting hours, default duration, and breaks/closures can be understood visually.
- No room/staff/resource management appears in the fitting frontend.
- The prototype works at 360px and with keyboard navigation.
- No real fitting backend/contract/database behavior has been introduced.
- Existing V1 Calendar/Dashboard/Payments behavior has not been expanded accidentally.
- Open domain decisions discovered through the prototype are documented before backend planning begins.

---

# Backend implementation checklist

**Backend status:** Planned. Do not begin schema or API implementation until Phase BE-0 closes the domain decisions that affect persistence and concurrency.

**Backend target:** Production V1.1 staff fitting operations that support the approved `/fittings` and `/fittings/schedule` frontend without copying prototype fixtures directly into contracts.

**Primary code areas:**

- `contracts/src/fittings/*` for shared request/response/state contracts.
- `api/src/db/migrations/*` and `api/src/db/schema/*` for persistence.
- `api/src/modules/fittings/*` for routes, controllers, middleware, repositories, and services.
- Existing availability, catalogue allocation, customer, finance, audit, idempotency, and tenant-context modules where reuse is appropriate.

## Backend non-negotiables

- Tenant and branch scope must come from authenticated server context, never from trusted client IDs alone.
- Every mutating fitting operation must follow the existing idempotency contract.
- Appointment/payment state remain separate. Payment state must never silently drive appointment state.
- A garment preference without a physical asset assignment must never block inventory or be described as guaranteed.
- A guaranteed garment must claim a concrete eligible physical asset using the canonical asset-allocation mechanism.
- Reschedule/change operations must claim the replacement interval before releasing the old winning allocation; failure must preserve the current appointment.
- Fitting periods use timezone-aware bounded intervals and branch/tenant timezone rules already established by the platform.
- No room/staff/resource management is exposed in the approved fitting UI.
- No duplicate weekly availability visualization is added to `/fittings/schedule`; Calendar remains the operational schedule visualization.
- Prototype strings such as `Guaranteed intent`, `Pending review`, and fixture object shapes are not automatically wire enums or database schema.
- Public fitting booking, notifications, analytics, entitlement gating, and automated reminders stay out until explicitly approved.

## Canonical backend discrepancy to resolve first

The approved frontend intentionally exposes only business-level fitting hours, duration, and breaks/closures. The current V1.1 PRD/TRD/Data Model still describe fitting room/staff/resource capacity and resource-level exclusion.

Before migrations are written, choose and document one backend direction:

1. **Internal capacity/resource model remains canonical:** backend resources/capacity exist for correctness but are hidden from the current staff UI; or
2. **Business-level capacity model replaces the resource model:** PRD, TRD, Data Model, ERD, invariants, and concurrency design are revised before implementation.

Do not silently implement one interpretation while leaving the canonical documents describing the other.

---

# Backend Phase BE-0: Freeze product and domain behavior

- [ ] **FIT-BE-000 — Resolve the fitting capacity/resource backend model**
  - **Acceptance:**
    - [ ] Choose internal resource/capacity enforcement versus a revised business-level capacity model.
    - [ ] Keep room/staff/resource concepts out of the current frontend unless a later product decision reintroduces them.
    - [ ] Update PRD, TRD, Data Model, and ERD together if the canonical model changes.
    - [ ] Define how hours, breaks, closures, and capacity are represented by the chosen model.
    - [ ] Define the concurrency primitive used to prevent overbooking; no unguarded `count then insert` flow.

- [ ] **FIT-BE-001 — Freeze canonical fitting appointment states and transitions**
  - **Acceptance:**
    - [ ] Define the exact persisted status enum.
    - [ ] Define allowed transitions and actor permissions for each transition.
    - [ ] Decide whether the frontend labels `Pending`, `Confirmed`, `Completed`, `Rejected`, `Cancelled`, and `No-show` map directly to persisted states or presentation labels.
    - [ ] Keep payment/evidence status independent from appointment status.
    - [ ] Define terminal states and which transitions release garment/capacity allocations.
    - [ ] Define optimistic-version or locked conditional-transition behavior for concurrent status updates.

- [ ] **FIT-BE-002 — Freeze staff creation and customer rules**
  - **Acceptance:**
    - [ ] Confirm the first production slice is staff-created fittings only or intentionally include public booking.
    - [ ] Define existing-customer selection behavior.
    - [ ] Define the minimum allowed walk-in identity/contact fields; reconcile the name-only frontend path with canonical customer contact/privacy rules.
    - [ ] Define whether a walk-in creates/reuses a `customer` record or uses another approved representation.
    - [ ] Define deduplication rules; do not merge customers by phone alone.

- [ ] **FIT-BE-003 — Freeze duration and schedule-setting semantics**
  - **Acceptance:**
    - [ ] Persist one business/branch fitting default duration source.
    - [ ] Keep the approved bounded prototype options only if product confirms them; do not treat `30/45/60/90` as canonical merely because the prototype used them.
    - [ ] Snapshot the effective duration/period on each appointment so future setting changes do not rewrite history.
    - [ ] Define weekly operating-hour behavior, multiple windows, unavailable days, and date-specific breaks/closures.
    - [ ] Define timezone behavior from branch/tenant configuration.

- [ ] **FIT-BE-004 — Freeze fitting fee, payment, cancellation, and refund rules**
  - **Acceptance:**
    - [ ] Decide whether a fitting fee is optional, required, or disabled in the first backend slice.
    - [ ] Define the fee source/default; current `₱300` fixture value is not canonical.
    - [ ] Decide whether payment is required before confirmation.
    - [ ] Define supported payment/evidence states by reusing the finance domain where possible.
    - [ ] Define cancellation/rejection/no-show fee behavior.
    - [ ] Define refund/reversal behavior before adding fitting finance links.

- [ ] **FIT-BE-005 — Freeze garment preference versus guarantee semantics**
  - **Acceptance:**
    - [ ] Preference-only line requires a variant but no physical asset block.
    - [ ] Guaranteed line requires an eligible physical asset and blocking allocation.
    - [ ] Define when the asset is chosen: create, confirm, or another approved transition.
    - [ ] Define how a failed guaranteed-asset claim is returned to the caller.
    - [ ] Define release behavior for reschedule, rejection, cancellation, no-show, and completion.

- [ ] **FIT-BE-006 — Produce the backend decision record**
  - **Acceptance:**
    - [ ] Every BE-0 decision above is written into the canonical product/architecture docs.
    - [ ] `Fittings Prototype Review Gate.md` is updated from frontend review artifact to reference the approved backend decisions.
    - [ ] No unresolved item required for schema design is left as an implicit code assumption.

**BE-0 exit gate:** No contracts, migrations, or production fitting routes until FIT-BE-000 through FIT-BE-006 are complete.

---

# Backend Phase BE-1: Contracts and API surface

- [ ] **FIT-BE-010 — Create the fittings contract module**
  - **Depends on:** BE-0 complete.
  - **Acceptance:**
    - [ ] Add `contracts/src/fittings/` with explicit exports from the contracts package index.
    - [ ] Define canonical fitting IDs, appointment state, garment-line semantics, fee/payment summary, and schedule-setting DTOs.
    - [ ] Reuse common money, pagination, time, error, and idempotency contracts.
    - [ ] Do not copy `FittingPrototypeAppointment` or frontend fixture types into contracts.
    - [ ] Do not use `Guaranteed intent` as a wire value unless deliberately approved as a domain concept.

- [ ] **FIT-BE-011 — Define fitting list and detail contracts**
  - **Acceptance:**
    - [ ] List response supports bounded pagination using existing API conventions.
    - [ ] Filters cover only approved operational needs: customer/garment search, status, and date window.
    - [ ] Detail response contains customer, period, garment lines, fee/payment summary, status, and approved actions/state metadata.
    - [ ] No room/staff/resource fields leak into the public contract if the backend model is intentionally internal.

- [ ] **FIT-BE-012 — Define create/update/action contracts**
  - **Acceptance:**
    - [ ] Existing-customer and approved walk-in creation paths are explicit.
    - [ ] Appointment period/duration is validated server-side.
    - [ ] Garment lines distinguish preference-only from guaranteed physical-asset intent using canonical semantics.
    - [ ] Status changes use explicit commands/actions rather than arbitrary client state replacement.
    - [ ] Mutating contracts require the standard idempotency key behavior.

- [ ] **FIT-BE-013 — Define schedule-setting contracts**
  - **Acceptance:**
    - [ ] Read/update contract covers approved weekly fitting hours.
    - [ ] Default duration is included using the canonical BE-0 representation.
    - [ ] Break/closure create/edit/remove contracts are explicit.
    - [ ] There is no separate weekly availability-preview API solely to recreate the removed frontend section.

- [ ] **FIT-BE-014 — Define stable fitting error semantics**
  - **Acceptance:**
    - [ ] Validation, not-found, forbidden, state-conflict, schedule-conflict, capacity-conflict, and garment-conflict cases map to stable existing error-envelope conventions.
    - [ ] Conflict responses are safe and do not expose cross-tenant identifiers or private customer data.
    - [ ] Same idempotency key with different validated payload returns the platform-standard conflict behavior.

- [ ] **FIT-BE-015 — Add contract tests and package build coverage**
  - **Acceptance:**
    - [ ] Contract schemas reject invalid dates, durations, money, state values, and malformed lines.
    - [ ] Valid list/detail/create/action/schedule examples parse.
    - [ ] Package typecheck/build passes.
    - [ ] API and app can consume the new package exports without circular dependencies.

---

# Backend Phase BE-2: Database schema, migration, and invariants

- [ ] **FIT-BE-020 — Design the fitting persistence migration from the approved model**
  - **Depends on:** BE-1 contracts approved.
  - **Acceptance:**
    - [ ] Add `fitting_appointment` with tenant/branch/customer, canonical status, bounded period, timezone snapshot, currency, fee snapshot if approved, business key, timestamps, and optimistic/version fields as required.
    - [ ] Add `fitting_line` with variant reference, optional physical asset reference, and canonical guarantee semantics.
    - [ ] Add the approved schedule/capacity tables from FIT-BE-000; do not mechanically deploy obsolete ERD entities.
    - [ ] Add release-boundary extension FKs such as fitting links in `asset_allocation`, `payment`, and `charge` only when their owning fitting tables exist and the finance scope is approved.

- [ ] **FIT-BE-021 — Add tenant, branch, FK, and state integrity constraints**
  - **Acceptance:**
    - [ ] Appointment/customer/variant/asset/capacity references cannot cross tenants.
    - [ ] Branch relationships match the appointment branch where required.
    - [ ] Period is finite, non-empty, and normalized to canonical `[)` semantics.
    - [ ] Guaranteed line constraints require the approved physical-asset relationship.
    - [ ] Preference-only lines cannot accidentally carry a blocking physical-asset promise.
    - [ ] Amount/currency constraints follow existing finance rules.

- [ ] **FIT-BE-022 — Add concurrency/exclusion constraints**
  - **Acceptance:**
    - [ ] Guaranteed fitting garments participate in canonical `asset_allocation` overlap exclusion.
    - [ ] Capacity/resource overlap protection follows the approved FIT-BE-000 model.
    - [ ] Adjacent non-overlapping intervals are allowed.
    - [ ] Blocking versus released/non-blocking semantics are explicit.
    - [ ] Constraint behavior is verified in PostgreSQL integration tests, not only TypeScript unit tests.

- [ ] **FIT-BE-023 — Add fitting schedule and closure persistence**
  - **Acceptance:**
    - [ ] Weekly hours support all seven weekdays and multiple windows where approved.
    - [ ] Default duration persists at the correct tenant/branch scope.
    - [ ] Date-specific breaks/closures use the approved canonical representation.
    - [ ] Invalid/overlapping configuration is rejected according to BE-0 rules.
    - [ ] Branch timezone determines local schedule interpretation.

- [ ] **FIT-BE-024 — Add RLS and least-privilege database policies**
  - **Acceptance:**
    - [ ] Every tenant-owned fitting table has read/write RLS consistent with the existing tenant GUC pattern.
    - [ ] Worker/system access, if needed, is explicit and minimal.
    - [ ] No fitting table is accidentally accessible through a global role.
    - [ ] Cross-tenant SQL integration tests fail closed.

- [ ] **FIT-BE-025 — Add fitting indexes and migration rehearsal**
  - **Acceptance:**
    - [ ] Index tenant/branch/period/status/customer access patterns used by list/calendar queries.
    - [ ] Add supporting indexes for guaranteed-asset/capacity conflict checks.
    - [ ] Rehearse migration on an isolated Neon branch with synthetic/anonymized data.
    - [ ] Run migration invariants and explain any lock-sensitive operation.
    - [ ] Prefer roll-forward correction; do not assume app rollback reverses data migration safely.

---

# Backend Phase BE-3: Read repositories and query services

- [ ] **FIT-BE-030 — Implement tenant-scoped fitting list repository**
  - **Acceptance:**
    - [ ] Query is tenant/branch scoped from server context.
    - [ ] Search/filter behavior supports approved customer/garment/status/date needs.
    - [ ] Pagination is bounded and deterministic.
    - [ ] Query does not produce N+1 customer/garment/payment lookups.
    - [ ] Response projection does not expose internal capacity/resource fields unless intentionally part of contract.

- [ ] **FIT-BE-031 — Implement fitting detail repository**
  - **Acceptance:**
    - [ ] Loads appointment, customer, lines, approved asset guarantee data, and fee/payment summary in one bounded domain read.
    - [ ] Returns not-found for inaccessible/cross-tenant IDs without leaking existence.
    - [ ] Historical snapshot fields are used where later mutable settings must not rewrite appointment meaning.

- [ ] **FIT-BE-032 — Implement schedule-setting reads**
  - **Acceptance:**
    - [ ] Returns weekly hours, default duration, and breaks/closures for the correct branch/business scope.
    - [ ] No weekly availability-preview query is introduced for `/fittings/schedule`.
    - [ ] Data shape supports the approved frontend without exposing backend-only concurrency machinery.

- [ ] **FIT-BE-033 — Add read repository tests**
  - **Acceptance:**
    - [ ] Empty, filtered, paginated, past/upcoming, and multi-garment cases are covered.
    - [ ] Cross-tenant and unauthorized branch reads fail.
    - [ ] Query count/performance stays bounded for representative seeded data.

---

# Backend Phase BE-4: Appointment creation, update, and atomic allocation

- [ ] **FIT-BE-040 — Implement staff fitting creation service**
  - **Acceptance:**
    - [ ] Existing-customer and approved walk-in flow follow FIT-BE-002.
    - [ ] Period, timezone snapshot, branch, and duration are derived/validated server-side.
    - [ ] Garment lines are validated against tenant catalogue/variant ownership.
    - [ ] Optional fee snapshot follows FIT-BE-004.
    - [ ] Creation is one transaction and one idempotent business effect.

- [ ] **FIT-BE-041 — Implement schedule/capacity validation**
  - **Acceptance:**
    - [ ] Appointment falls inside approved operating hours unless an explicitly authorized override exists.
    - [ ] Breaks/closures are enforced.
    - [ ] Capacity/resource claim follows the approved atomic concurrency model.
    - [ ] Simultaneous requests cannot overbook one capacity slot/resource.

- [ ] **FIT-BE-042 — Implement preference-only garment lines**
  - **Acceptance:**
    - [ ] Store variant preference without claiming a physical asset.
    - [ ] No `asset_allocation` row is created for preference-only lines.
    - [ ] API response cannot imply guaranteed availability.

- [ ] **FIT-BE-043 — Implement guaranteed garment claim**
  - **Acceptance:**
    - [ ] Resolve/validate a concrete eligible physical asset under the approved allocation rules.
    - [ ] Claim the exact fitting interval atomically with appointment/capacity claim.
    - [ ] Existing rental, maintenance, transfer, or other blocking allocations prevent the claim.
    - [ ] Same-asset concurrent guarantees result in one winning blocker.

- [ ] **FIT-BE-044 — Implement fitting reschedule/update semantics**
  - **Acceptance:**
    - [ ] Validate and claim replacement capacity/garments first.
    - [ ] Release old allocations only after the replacement transaction can win.
    - [ ] Failed reschedule preserves the old period, status, and allocations.
    - [ ] Changed payload with reused idempotency key conflicts.
    - [ ] Mutation writes audit metadata using existing audit conventions.

- [ ] **FIT-BE-045 — Add creation/update integration and contention tests**
  - **Acceptance:**
    - [ ] Duplicate request replay creates one appointment/effect.
    - [ ] Concurrent same-capacity requests cannot overbook.
    - [ ] Concurrent same-guaranteed-asset requests create one blocking allocation.
    - [ ] Adjacent periods succeed.
    - [ ] Preference-only fitting can coexist with unrelated physical-asset allocation because it claims no asset.

---

# Backend Phase BE-5: Appointment lifecycle commands

- [ ] **FIT-BE-050 — Implement explicit status action services**
  - **Acceptance:**
    - [ ] Implement only the canonical actions approved in FIT-BE-001.
    - [ ] Each action checks current state/version inside the transaction.
    - [ ] Arbitrary client-provided status replacement is not allowed.
    - [ ] Unauthorized actors receive the standard permission failure.

- [ ] **FIT-BE-051 — Implement confirmation semantics**
  - **Acceptance:**
    - [ ] Confirmation verifies all required capacity and guaranteed garment claims are still valid.
    - [ ] Payment prerequisites, if any, follow FIT-BE-004 and do not infer payment from appointment state.
    - [ ] Confirmation is idempotent and race-safe.

- [ ] **FIT-BE-052 — Implement reject/cancel/no-show allocation behavior**
  - **Acceptance:**
    - [ ] Release or retain capacity/asset blocks exactly according to the canonical state machine.
    - [ ] Fee/payment/refund side effects follow the approved financial policy rather than UI assumptions.
    - [ ] Repeated terminal action requests are duplicate-safe.

- [ ] **FIT-BE-053 — Implement completion semantics**
  - **Acceptance:**
    - [ ] Completion records the winning terminal transition once.
    - [ ] No future blocking fitting allocation remains accidentally active.
    - [ ] Completion does not create rental history unless a separately approved conversion workflow exists.

- [ ] **FIT-BE-054 — Add lifecycle race tests**
  - **Acceptance:**
    - [ ] Confirm versus cancel/reject race yields one valid state.
    - [ ] Complete versus no-show race yields one valid state.
    - [ ] Stale version/status commands return conflict.
    - [ ] Allocation release is not duplicated or leaked after races.

---

# Backend Phase BE-6: Fitting schedule settings

- [ ] **FIT-BE-060 — Implement weekly fitting-hours commands**
  - **Acceptance:**
    - [ ] Owner/front-desk permissions match the approved policy.
    - [ ] Enable/disable weekday behavior is explicit.
    - [ ] Multiple windows per day are validated and normalized.
    - [ ] Invalid or disallowed overlapping windows are rejected.

- [ ] **FIT-BE-061 — Implement persistent default fitting duration**
  - **Acceptance:**
    - [ ] Replace the frontend session-storage prototype setting with a tenant/branch backend source.
    - [ ] New fitting create responses/flows use the current default unless an allowed per-appointment override is supplied.
    - [ ] Existing appointments retain their stored period/duration when the default changes.

- [ ] **FIT-BE-062 — Implement breaks and closures CRUD**
  - **Acceptance:**
    - [ ] Create/edit/remove is tenant/branch scoped and idempotent where applicable.
    - [ ] Date, time, reason, and type constraints are validated server-side.
    - [ ] Closures participate in appointment-capacity validation using the approved BE-0 model.

- [ ] **FIT-BE-063 — Add schedule-setting tests**
  - **Acceptance:**
    - [ ] Seven-day schedule, split windows, unavailable days, and date exceptions are covered.
    - [ ] Timezone and date-boundary cases are covered.
    - [ ] Updating settings cannot silently invalidate or rewrite historical appointments.

---

# Backend Phase BE-7: Fitting fee and finance integration

**Conditional phase:** Implement only if FIT-BE-004 approves a fitting fee/payment flow for the first backend slice.

- [ ] **FIT-BE-070 — Add canonical fitting finance relationships**
  - **Acceptance:**
    - [ ] Add approved `fitting_id` links to existing finance entities through reviewed migrations.
    - [ ] Reuse existing payment/charge/allocation/reversal rules instead of creating a parallel fitting-payment system.
    - [ ] Same booking and currency invariants apply.

- [ ] **FIT-BE-071 — Implement fitting fee charge/payment creation**
  - **Acceptance:**
    - [ ] Fee amount is snapshotted from the approved source.
    - [ ] No-fee fitting creates no unnecessary payment obligation.
    - [ ] Payment evidence does not imply verified funds.
    - [ ] Cash/manual evidence follows existing verification permission rules.

- [ ] **FIT-BE-072 — Keep payment state independent from fitting lifecycle**
  - **Acceptance:**
    - [ ] Appointment status changes never automatically fabricate a payment result.
    - [ ] Payment verification never silently confirms a fitting unless an explicit approved domain command does so.
    - [ ] API exposes both states separately as the frontend prototype expects.

- [ ] **FIT-BE-073 — Implement cancellation/refund/reversal rules**
  - **Acceptance:**
    - [ ] Refundability follows FIT-BE-004.
    - [ ] Concurrent refund/reversal totals cannot exceed the refundable balance.
    - [ ] Failed/manual refunds preserve accurate state and require explicit operator resolution.

- [ ] **FIT-BE-074 — Add fitting-finance tests**
  - **Acceptance:**
    - [ ] No-fee, pending evidence, verified payment, rejected evidence, cancellation, and refund cases are covered as applicable.
    - [ ] Cross-tenant finance links reject.
    - [ ] Appointment/payment independence has explicit regression tests.

---

# Backend Phase BE-8: Calendar, Dashboard, Availability, and Payments integration

- [ ] **FIT-BE-080 — Add production fitting events to Calendar**
  - **Acceptance:**
    - [ ] Calendar queries include persisted fitting events in bounded date windows.
    - [ ] Remove `Prototype` labeling only after the backend release gate is complete.
    - [ ] Calendar does not depend on a second duplicate fitting schedule store.
    - [ ] Existing pickup/return/reservation calendar behavior remains intact.

- [ ] **FIT-BE-081 — Add production fitting summary to Dashboard**
  - **Acceptance:**
    - [ ] Today/upcoming/pending-review counts come from authoritative fitting data.
    - [ ] No utilization/revenue analytics are added unless separately approved.
    - [ ] Query remains bounded and tenant-scoped.

- [ ] **FIT-BE-082 — Integrate guaranteed fittings with garment availability**
  - **Acceptance:**
    - [ ] Only guaranteed physical-asset fitting allocations block asset availability.
    - [ ] Preference-only fitting lines never make a garment appear unavailable.
    - [ ] Conflict reason identifies fitting allocation without exposing private customer data to public callers.

- [ ] **FIT-BE-083 — Integrate fitting finance into Payments if enabled**
  - **Acceptance:**
    - [ ] Central Payments can distinguish fitting versus reservation source.
    - [ ] Existing reservation finance behavior is unchanged.
    - [ ] Permissions and evidence privacy remain identical to the underlying finance policy.

---

# Backend Phase BE-9: Security, reliability, observability, and hardening

- [ ] **FIT-BE-090 — Complete fitting authorization matrix**
  - **Acceptance:**
    - [ ] Owner and Front desk capabilities are explicit for create/read/update/status/schedule/finance actions.
    - [ ] Every route checks active membership and tenant/branch scope.
    - [ ] Cross-tenant IDs fail without leaking object existence.

- [ ] **FIT-BE-091 — Complete fitting RLS and pooled-connection isolation tests**
  - **Acceptance:**
    - [ ] Reused pooled connections cannot retain another tenant context.
    - [ ] Missing/empty tenant context fails closed.
    - [ ] Rollback and revoked membership cases do not leak fitting/customer/payment data.

- [ ] **FIT-BE-092 — Complete concurrency falsification suite**
  - **Acceptance:**
    - [ ] Same capacity/resource contention has one winner.
    - [ ] Same guaranteed garment contention has one winner.
    - [ ] Adjacent intervals succeed; true overlaps fail.
    - [ ] Failed replacement/reschedule preserves the old winning state.
    - [ ] Duplicate idempotent retries produce one business effect.

- [ ] **FIT-BE-093 — Add audit and safe observability**
  - **Acceptance:**
    - [ ] Create/reschedule/status/schedule/finance actions emit appropriate audit metadata.
    - [ ] Logs contain IDs and safe summaries, not unrestricted customer PII, receipts, bearer secrets, or private URLs.
    - [ ] Conflict/error metrics distinguish validation, state, capacity, and garment contention where useful.

- [ ] **FIT-BE-094 — Run representative fitting load and query tests**
  - **Acceptance:**
    - [ ] Seed enough appointments to exercise list/calendar windows and contention.
    - [ ] Verify indexes with representative query plans.
    - [ ] No new cache is allowed to become authority for fitting availability writes.

---

# Backend Phase BE-10: Frontend cutover and release gate

- [ ] **FIT-BE-100 — Wire `/fittings` to production contracts/API**
  - **Acceptance:**
    - [ ] Replace fixture list/detail/create/status data with API client calls.
    - [ ] Preserve approved loading, empty, error, filters, pagination, Details Sheet, and New Fitting UX.
    - [ ] Remove local status mutation as production authority.

- [ ] **FIT-BE-101 — Wire `/fittings/schedule` to persisted settings**
  - **Acceptance:**
    - [ ] Weekly hours, default duration, and breaks/closures load/save through backend contracts.
    - [ ] Remove session-storage duration as production authority.
    - [ ] Do not reintroduce the removed weekly availability section.

- [ ] **FIT-BE-102 — Replace fitting prototype data in Calendar/Dashboard/Payments**
  - **Acceptance:**
    - [ ] Production surfaces read authoritative fitting data only after the release flag/gate is enabled.
    - [ ] Prototype labels and mock records are removed in the same controlled cutover.
    - [ ] No mixed mock/production fitting state remains.

- [ ] **FIT-BE-103 — Run end-to-end staff workflow verification**
  - **Acceptance:**
    - [ ] Find today/upcoming fittings.
    - [ ] Create existing-customer fitting.
    - [ ] Create approved walk-in fitting.
    - [ ] Create preference-only garment line.
    - [ ] Create guaranteed garment fitting and verify physical asset block.
    - [ ] Reschedule successfully and verify old allocation release.
    - [ ] Exercise approved status transitions.
    - [ ] Update hours/default duration/break/closure and verify create validation.
    - [ ] Exercise fitting payment flow if enabled.

- [ ] **FIT-BE-104 — Complete rollout documentation and release gate**
  - **Acceptance:**
    - [ ] Canonical PRD/TRD/Data Model/ERD match shipped behavior.
    - [ ] Migration and restore/recovery notes are reviewed.
    - [ ] Backend and frontend checks pass in CI.
    - [ ] Known limitations and deferred public/resource/notification features are documented.
    - [ ] Fittings are marked production-ready only after tenant isolation, contention, and operator workflow checks pass.

---

# Backend completion definition

The fitting backend is complete when:

- Canonical fitting states, capacity model, customer rules, fee/payment rules, and garment-guarantee semantics are documented and implemented consistently.
- Contracts, migrations, RLS, repositories, services, routes, idempotency, and audit behavior are production-ready.
- Preference-only fitting lines never block physical inventory.
- Guaranteed garment fittings atomically claim a real eligible asset and cannot double-book under concurrency.
- Capacity/closure conflicts are enforced by database-safe or otherwise approved atomic concurrency primitives.
- Reschedule failure preserves the previous winning appointment/allocation.
- Schedule hours/default duration/breaks/closures are persisted and enforced server-side.
- Payment state remains separate from appointment state, with finance behavior reused rather than duplicated when fees are enabled.
- Calendar/Dashboard/Availability/Payments integration uses authoritative fitting data without duplicating the schedule-settings feature.
- Cross-tenant, RLS, idempotency, race, timezone, and migration tests pass.
- The frontend no longer depends on fitting fixture data or session storage for production behavior.
