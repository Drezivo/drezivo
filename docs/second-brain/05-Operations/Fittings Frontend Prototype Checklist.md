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
  - **Evidence:**
    - `app/src/components/fittings/fittings-page.tsx` renders one responsive appointment list source: stacked two-column appointment rows below `lg`, and a six-column operational row layout at `lg` and above.
    - Visible list fields are limited to date/time, customer, garment summary, fee/payment, appointment status, and attention. Phone, email, payment evidence, measurements, long notes, and all room/staff/resource concepts stay out of the list.
    - Appointment status and payment state use separate badges and separate fixture fields; no payment state mutates appointment state in the frontend.
    - Clicking or keyboard-activating an appointment row opens a minimal `Fitting Details` Sheet preview. Phase 3 remains responsible for the richer details layout.
    - `app/tests/unit/fittings-page.test.tsx` defines coverage for the list fields, absence of fitting room/staff labels, and row-to-sheet opening.
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

- [ ] **FIT-FE-040 — Define the New Fitting interaction pattern**
  - **Acceptance:**
    - [ ] Choose a route or large Sheet/Dialog based on existing dashboard patterns.
    - [ ] Keep grouping clear and mobile-friendly.
    - [ ] Draft reset/restore behavior is intentional.

- [ ] **FIT-FE-041 — Add customer selection/input prototype**
  - **Acceptance:**
    - [ ] Existing-customer search uses synthetic fixtures only.
    - [ ] New customer input stays minimal.
    - [ ] No customer account required.
    - [ ] No real create-customer request.

- [ ] **FIT-FE-042 — Add date/time selection prototype**
  - **Acceptance:**
    - [ ] Select date and start time.
    - [ ] Show prototype duration/end time where useful.
    - [ ] Past/invalid selections are handled locally.
    - [ ] Do not display authoritative `Available` from local calculations.

- [ ] **FIT-FE-043 — Add garment preference/guarantee selection prototype**
  - **Acceptance:**
    - [ ] Search/select synthetic clothing.
    - [ ] Allow multiple garment lines.
    - [ ] Each line can be preference-only or guaranteed intent.
    - [ ] Guaranteed intent explains future backend validation.
    - [ ] Frontend does not claim a physical garment.

- [ ] **FIT-FE-045 — Add optional fee/payment section prototype**
  - **Acceptance:**
    - [ ] Fee is a mock configured value, not canonical price.
    - [ ] No real payment intake.
    - [ ] No-fee fitting remains representable.
    - [ ] PHP formatting matches existing conventions.

- [ ] **FIT-FE-046 — Add review/create prototype state**
  - **Depends on:** FIT-FE-041, FIT-FE-042, FIT-FE-043, FIT-FE-045.
  - **Acceptance:**
    - [ ] Review shows customer, period, garments, guarantee labels, and fee if present.
    - [ ] Final CTA is explicitly prototype/local-only.
    - [ ] Double-click cannot create duplicate mock records.
    - [ ] Refresh may lose prototype-only state unless intentionally documented.

---

# Phase 5: `/fittings/schedule` hours and availability prototype

- [ ] **FIT-FE-050 — Create Fitting Schedule & Availability page shell**
  - **Acceptance:**
    - [ ] Route is `/fittings/schedule`.
    - [ ] Navigation back to `/fittings` exists.
    - [ ] Page stays business-level and does not expose rooms/staff/resources.
    - [ ] Hours, duration, breaks, and availability are visually separated.

- [ ] **FIT-FE-051 — Build weekly fitting operating-hours editor/visualizer**
  - **Acceptance:**
    - [ ] Monday–Sunday schedule.
    - [ ] Multiple windows per day can be visualized if useful.
    - [ ] A day can be unavailable.
    - [ ] Validate start < end locally.
    - [ ] Mobile editing avoids horizontal overflow.

- [ ] **FIT-FE-052 — Add appointment-duration setting prototype**
  - **Acceptance:**
    - [ ] Duration is clearly labeled as prototype/configuration-driven.
    - [ ] Use a small bounded set of sensible options or one validated numeric control.
    - [ ] No duration value is promoted to canonical product truth yet.

- [ ] **FIT-FE-053 — Visualize breaks and date-specific closures**
  - **Acceptance:**
    - [ ] Show examples such as lunch break, holiday closure, or private event.
    - [ ] Closure includes date/time and short reason.
    - [ ] Create/edit/remove remains local-state-only.

- [ ] **FIT-FE-054 — Build bounded fitting availability visualization**
  - **Acceptance:**
    - [ ] Use a bounded day/week view.
    - [ ] Distinguish working hours, booked mock appointments, and closures.
    - [ ] Appointment block can open the mock Fitting Details Sheet where practical.
    - [ ] UI never claims local rendering is authoritative backend capacity enforcement.
    - [ ] Avoid excessive slot rendering.

---

# Phase 6: Cross-page prototype consistency

- [ ] **FIT-FE-060 — Keep fitting fixture identities consistent across screens**
  - **Acceptance:**
    - [ ] `/fittings` row and Details Sheet share the same fixture source.
    - [ ] `/fittings/schedule` appointment blocks resolve the same fixture.
    - [ ] Customer/garment/status/payment labels remain consistent.
    - [ ] No duplicate fitting objects are maintained across components.

- [ ] **FIT-FE-061 — Prevent prototype fittings from becoming V1 Calendar authority**
  - **Acceptance:**
    - [ ] No production Calendar contract changes.
    - [ ] `/calendar` does not imply fitting events are tenant production data.
    - [ ] Future integration remains deferred backend work.

- [ ] **FIT-FE-062 — Prevent prototype fittings from becoming V1 Dashboard authority**
  - **Acceptance:**
    - [ ] No real Dashboard fitting query/API work.
    - [ ] Existing fitting metrics remain clearly mock/future-facing.

- [ ] **FIT-FE-063 — Keep fitting payment presentation separate from Payments production behavior**
  - **Acceptance:**
    - [ ] No Payments API/client contract changes.
    - [ ] Fitting fee/payment fixtures stay inside the prototype.
    - [ ] Appointment status never mirrors payment automatically.

---

# Phase 7: UX, accessibility, responsive behavior, and polish

- [ ] **FIT-FE-070 — Complete responsive fitting pages**
  - **Acceptance:**
    - [ ] `/fittings` works at 360px.
    - [ ] `/fittings/schedule` works at 360px.
    - [ ] No unnecessary page-level horizontal scrolling.
    - [ ] Date/time controls do not overflow.
    - [ ] Primary actions remain reachable.
    - [ ] Details Sheet is readable without nested horizontal scrolling.

- [ ] **FIT-FE-071 — Complete keyboard and accessibility pass**
  - **Acceptance:**
    - [ ] Search/filter/forms have accessible names.
    - [ ] Appointment rows expose an accessible details action.
    - [ ] Sheets/dialogs have title, description, focus management, and close behavior.
    - [ ] Status/attention is not color-only.
    - [ ] Schedule controls are keyboard reachable.
    - [ ] No essential information is hover-only.

- [ ] **FIT-FE-072 — Complete light/dark theme review**
  - **Acceptance:**
    - [ ] Text/background contrast remains clear.
    - [ ] Status badges retain meaning.
    - [ ] Active filters remain distinguishable.
    - [ ] Schedule working/booked/closed states remain distinguishable with text/icons as needed.

- [ ] **FIT-FE-073 — Remove unnecessary text and enterprise complexity**
  - **Acceptance:**
    - [ ] Main page is operational and scan-first.
    - [ ] Avoid dashboard-within-dashboard layout.
    - [ ] Avoid excessive cards.
    - [ ] Avoid exposing ERD terms such as `resource_allocation` or `fitting_line`.
    - [ ] Do not expose room/staff/resource concepts in fitting UI.

---

# Phase 8: Prototype review gate before backend implementation

- [ ] **FIT-FE-080 — Run owner/front-desk workflow review**
  - **Acceptance:**
    - [ ] Reviewer can find today's/upcoming fittings.
    - [ ] Reviewer can understand customer, garments, fee/payment state, and appointment status.
    - [ ] Reviewer understands preference-only versus guaranteed garment.
    - [ ] Reviewer can visualize creating a fitting.
    - [ ] Reviewer understands operating hours, duration, breaks, and closures.
    - [ ] Confusing fields/actions are removed rather than justified only by the ERD.

- [ ] **FIT-FE-081 — Resolve product decisions exposed by the prototype**
  - **Acceptance:**
    - [ ] Decide exact fitting statuses/transitions.
    - [ ] Decide whether `No-show` belongs in initial V1.1.
    - [ ] Decide fitting duration source/default.
    - [ ] Decide fitting fee source/default.
    - [ ] Decide whether appointment notes are required.
    - [ ] Decide staff-only versus public fitting booking.
    - [ ] Decide payment requirement before confirmation.
    - [ ] Decide fitting cancellation/rejection/refund behavior.

- [ ] **FIT-FE-082 — Freeze approved frontend prototype for backend handoff**
  - **Acceptance:**
    - [ ] Route hierarchy approved.
    - [ ] List fields approved.
    - [ ] Details Sheet sections approved.
    - [ ] New Fitting inputs approved.
    - [ ] Hours/availability interactions approved.
    - [ ] Prototype-only labels that should not become wire enums are identified.
    - [ ] Fixture shapes are not blindly copied into API contracts.
    - [ ] Backend checklist is created only after product decisions are canonicalized.

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
