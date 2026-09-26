---
title: Fittings V1.1 Implementation Checklist
type: implementation-checklist
status: in-progress
owner: Drezivo team
updated: 2026-09-26
tags: [drezivo, v1.1, fittings, frontend, backend, implementation, checklist]
---

# Fittings V1.1 Implementation Checklist

**Status:** Frontend prototype approved. Backend Phases BE-0 and BE-1 are complete; BE-2 is in progress with FIT-BE-020 through FIT-BE-024 complete. FIT-BE-025 indexes/local PostgreSQL rehearsal are implemented; the isolated Neon-branch rehearsal remains the final BE-2 acceptance item.

This file is the feature-wide implementation checklist for `/fittings` and `/fittings/schedule`. The original frontend prototype phases are retained below as implementation history; the backend phases are appended after the frontend section.

**Canonical specifications:** [[Fittings Backend Decision Record]], [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).

**Related operational checklists:** [[Schedule Calendar Checklist]], [[Dashboard Checklist]], [[Availability Checklist]], [[Reservations Checklist]], and [[Core Rental Operations Checklist]].

## How to use this checklist

Use the frontend phases to preserve the approved staff workflow and UI constraints. Use the backend phases at the bottom of this file to turn that prototype into production behavior without copying mock fixture shapes or prototype labels directly into contracts.

The frontend prototype remains the interaction reference. The PRD, TRD, Data Model, migrations, contracts, and API conventions remain authoritative for production behavior. Where the prototype and canonical backend documents disagree, resolve the product/domain decision explicitly before implementing the affected backend phase.

For the retained frontend-history phases, the original prototype boundary still applies: mock data stays isolated and no production behavior should be inferred from fixture shapes. For backend phases, implementation must follow [[Fittings Backend Decision Record]], the canonical architecture docs, existing tenant/idempotency/audit conventions, and the phase dependencies below. Cross-product fitting mocks remain non-authoritative until their staged BE-8/BE-10 cutover.

## Frontend product decision: no fitting resources

The fitting frontend will **not** expose rooms, staff assignment, capacity-slot resources, resource filters, resource management, or resource-specific availability.

This frontend decision is now matched by the approved backend model: capacity is enforced with hidden branch capacity slots that are never exposed as room/staff/resource management. Reintroducing named resources requires a new coordinated product/architecture decision.

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
- Branch-scoped fitting settings: enabled state, maximum simultaneous capacity, strict duration, optional fixed fee, weekly hours, and date-specific closures.
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

## Prototype-to-production decisions

The backend behavior is now frozen in [[Fittings Backend Decision Record]]. Important production differences from the local prototype are intentional:

- Canonical persisted states are `pending`, `confirmed`, `completed`, `rejected`, `cancelled`, and `no_show`.
- Fitting duration is a strict branch setting, not a per-appointment override; start times and durations use 30-minute multiples.
- Branch fitting capacity is maximum simultaneous overlap and is enforced with hidden internal capacity slots.
- New production walk-ins require full name plus phone or email.
- Fitting fee is an optional fixed branch setting; staff cannot override it per appointment.
- Payment does not gate appointment confirmation and remains in the existing finance domain.
- Rejection/cancellation require an internal reason; no-show and completion have timing guards.
- Public fitting booking and customer-facing fitting reminders are deferred from the first backend slice.

Prototype-only strings such as `Guaranteed intent` and fixture payment labels still must not be copied blindly into wire contracts.

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

- [ ] **FIT-FE-035 — Align appointment actions with canonical backend lifecycle** _(reopened after BE-0; production wiring verification pending)_
  - **Acceptance:**
    - [x] Actions are disabled, mock-only, or local-state-only.
    - [x] Use only useful actions such as Confirm, Complete, Cancel, Reject, or Mark no-show.
    - [x] Destructive local actions require confirmation.
    - [x] Local mock mutations use an in-flight guard.
    - [x] No network request occurs in the original prototype.
    - [ ] Production actions use explicit backend commands rather than local status replacement.
    - [ ] Reject and Cancel require a bounded internal reason.
    - [ ] No-show is unavailable before scheduled start; Complete is unavailable before scheduled end.
    - [ ] Once scheduled start is reached, reschedule, garment-plan edits, Reject, and normal Cancel are unavailable.
    - [ ] Future `pending`/`confirmed` fittings expose the approved Reschedule and garment-plan edit paths where applicable.
    - [ ] Optional internal staff note is readable/editable through the production fitting contract.
  - **Evidence:** The original prototype correctly demonstrated the basic status vocabulary and local confirmation pattern. BE-0 later tightened timing guards, terminal reasons, reschedule/edit boundaries, and the internal-note contract; this item is reopened until the production UI is aligned and wired.
  - **Validation:** Prettier, TypeScript transpile, and `git diff --check` pass. Targeted Vitest still fails before test collection because the repository root cannot resolve `vitest` from `@testing-library/jest-dom/dist/vitest.mjs`; the suite reports `0 test` before that existing dependency-resolution failure.

---

# Phase 4: New Fitting prototype flow

- [ ] **FIT-FE-040 — Define the New Fitting interaction pattern** _(reopened for production wiring verification)_
  - **Acceptance:**
    - [x] Choose a route or large Sheet/Dialog based on existing dashboard patterns.
    - [x] Keep grouping clear and mobile-friendly.
    - [x] Draft reset/restore behavior is intentional.
    - [ ] Production submit uses the canonical fitting create contract and authoritative server result; local-only record creation is removed as authority.
  - **Evidence:** `New Fitting` opens a large right-side Sheet using the existing dashboard overlay language. The flow is split into Appointment → Garments → Review and uses stacked controls below `sm`. The interaction pattern remains approved, but the item is reopened until the local prototype mutation is replaced by the production backend flow.

- [ ] **FIT-FE-041 — Align customer selection/input with production customer rules** _(reopened after BE-0)_
  - **Acceptance:**
    - [x] Existing-customer search uses synthetic fixtures only.
    - [x] New customer input stays minimal.
    - [x] No customer account required.
    - [x] No real create-customer request in the original prototype.
    - [ ] New walk-in requires full name plus at least one usable contact method: phone or email.
    - [ ] Possible duplicate customer matches are advisory; staff can choose the existing customer or deliberately create a new customer.
    - [ ] No automatic merge/reuse occurs from phone/email similarity alone.
    - [ ] Production flow creates/reuses a real customer through the approved backend path.
  - **Evidence:** Existing customer search already supports name/email/phone, but the original prototype allowed name-only walk-ins. BE-0 now requires a real customer with full name plus phone or email and advisory duplicate handling, so this item is reopened.

- [ ] **FIT-FE-042 — Align date/time selection with canonical fitting schedule** _(reopened after BE-0)_
  - **Acceptance:**
    - [x] Select date and start time.
    - [x] Show prototype duration/end time where useful.
    - [x] Past/invalid selections are handled locally.
    - [x] Do not display authoritative `Available` from local calculations.
    - [ ] Start-time choices align to the 30-minute scheduling grid.
    - [ ] Duration is inherited from the strict branch fitting setting and is not editable per appointment.
    - [ ] End time is derived from the authoritative configured duration.
    - [ ] Production availability/conflict result comes from the backend schedule/capacity validation path.
  - **Evidence:** The original prototype already uses date/time controls and 30/60/90 examples, but it still exposes a per-appointment duration choice. BE-0 makes branch duration strict and server-authoritative, so this item is reopened.

- [ ] **FIT-FE-043 — Align garment preference/guarantee selection with real allocation semantics** _(reopened after BE-0)_
  - **Acceptance:**
    - [x] Search/select synthetic clothing.
    - [x] Allow multiple garment lines.
    - [x] Each line can be preference-only or guaranteed intent.
    - [x] Guaranteed intent explains future backend validation.
    - [x] Frontend does not locally claim a physical garment.
    - [ ] `Preference only` remains a variant preference with no physical-asset block.
    - [ ] Selecting `Guaranteed garment` requests a real backend guarantee at create/edit time.
    - [ ] UI handles garment-allocation conflict without presenting a false guarantee or losing the previous winning guarantee during an edit/reschedule.
    - [ ] Staff still chooses the variant/garment, not a hidden physical asset or capacity slot.
  - **Evidence:** The original prototype intentionally used `Guaranteed intent` because no backend claim existed. BE-0 now defines a real guaranteed garment as an atomically claimed physical asset, so this item is reopened for production semantics and conflict handling.

- [ ] **FIT-FE-045 — Align fitting fee/payment presentation with branch finance settings** _(reopened after BE-0)_
  - **Acceptance:**
    - [x] Fee is a mock configured value, not canonical price.
    - [x] No real payment intake.
    - [x] No-fee fitting remains representable.
    - [x] PHP formatting matches existing conventions.
    - [ ] New Fitting does not allow staff to toggle or edit the fee per appointment.
    - [ ] Fee/no-fee state is read from the current branch fitting settings and shown read-only in the creation/review flow.
    - [ ] Payment/evidence state remains separate from appointment status and does not gate confirmation.
    - [ ] Positive fitting fee is represented through the existing finance domain after backend wiring; the UI does not create a parallel fitting payment source of truth.
  - **Evidence:** The original prototype intentionally used editable ₱300 fixture data. BE-0 now makes the fee an optional fixed branch setting snapshotted at creation, so this item is reopened.

- [ ] **FIT-FE-046 — Align review/create state with canonical production create** _(reopened after BE-0)_
  - **Depends on:** FIT-FE-041, FIT-FE-042, FIT-FE-043, FIT-FE-045.
  - **Acceptance:**
    - [x] Review shows customer, period, garments, guarantee labels, and fee if present.
    - [x] Final CTA is explicitly prototype/local-only.
    - [x] Double-click cannot create duplicate mock records.
    - [x] Refresh may lose prototype-only state unless intentionally documented.
    - [ ] Review reflects strict configured duration and read-only branch fee.
    - [ ] Create always produces canonical initial status `pending` from the server.
    - [ ] Server conflict responses for schedule capacity or guaranteed garments are surfaced without creating a partial local appointment.
    - [ ] Successful create uses the authoritative returned fitting/customer/fee/guarantee state.
  - **Evidence:** The original local review/create behavior is preserved as interaction history, but BE-0 now defines atomic production creation and canonical initial `pending` state. This item is reopened until backend wiring replaces the local-only authority.
  - **Validation:** Prettier, source transpile checks, and `git diff --check` pass. Typecheck reports no `src/components/fittings/*` source errors after the Phase 4 fixes; the remaining fitting-test diagnostics are the repository-wide missing jest-dom matcher typings. Targeted Vitest still fails before test collection because the repository root cannot resolve `vitest` from `@testing-library/jest-dom/dist/vitest.mjs`.

---

# Phase 5: `/fittings/schedule` hours and schedule-settings prototype

- [ ] **FIT-FE-050 — Align Fitting Schedule & Availability page with canonical branch settings** _(reopened after BE-0)_
  - **Acceptance:**
    - [x] Route is `/fittings/schedule`.
    - [x] Navigation back to `/fittings` exists.
    - [x] Page stays simple and does not expose rooms/staff/resources; the current single/default-branch UI does not need a branch selector.
    - [x] Hours, duration, and breaks/closures are visually separated.
    - [ ] Add Owner-only `Fittings enabled` configuration.
    - [ ] Add Owner-only `Maximum simultaneous fittings` configuration without exposing hidden slot identities.
    - [ ] Add Owner-only fixed fitting-fee/no-fee configuration.
    - [ ] Keep room/staff/named-resource and hidden capacity-slot management out of the UI.
    - [ ] Production settings load/save through the canonical branch fitting-settings contract.
  - **Evidence:** The current page shell remains the approved route/layout, but BE-0 added canonical branch settings for enabled state, simultaneous capacity, strict duration, and fixed fee. The item is reopened until those settings are represented and wired.

- [ ] **FIT-FE-051 — Build weekly fitting operating-hours editor/visualizer** _(reopened for backend wiring verification)_
  - **Acceptance:**
    - [x] Monday–Sunday schedule.
    - [x] Multiple windows per day can be visualized if useful.
    - [x] A day can be unavailable.
    - [x] Validate start < end locally.
    - [x] Mobile editing avoids horizontal overflow.
    - [ ] Persisted weekly windows load/save through the branch fitting-settings API.
    - [ ] Recurring breaks remain represented as gaps between multiple windows rather than a second recurring-break model.
    - [ ] Backend rejection is handled if an hours change would invalidate an existing future fitting.
  - **Evidence:** The local weekly-hours UX remains approved. This item is reopened only for production persistence and backend conflict verification.

- [ ] **FIT-FE-052 — Align strict fitting-duration setting with canonical rules** _(reopened after BE-0)_
  - **Acceptance:**
    - [x] Duration is clearly labeled as prototype/configuration-driven.
    - [x] Use a small bounded set of sensible options or one validated numeric control.
    - [x] No duration value was promoted to canonical product truth during prototyping.
    - [ ] Production label communicates that this is the strict duration for every new fitting, not merely a default.
    - [ ] `45` minutes is removed; allowed values are multiples of 30 with a minimum of 30 minutes.
    - [ ] New Fitting cannot override the configured duration.
    - [ ] Duration loads/saves from the branch fitting-settings backend instead of session storage.
  - **Evidence:** BE-0 supersedes the prototype behavior: duration is now a strict branch setting, so the original default/override behavior must be replaced.

- [ ] **FIT-FE-053 — Visualize breaks and date-specific closures** _(reopened for canonical model/backend wiring verification)_
  - **Acceptance:**
    - [x] Show examples such as lunch break, holiday closure, or private event.
    - [x] Closure includes date/time and short reason.
    - [x] Create/edit/remove remains local-state-only in the original prototype.
    - [ ] Recurring lunch/break behavior is represented through gaps between weekly operating windows rather than persisted recurring closure records.
    - [ ] Date-specific partial/full-day closures load/save through the canonical closure API.
    - [ ] Backend rejection is surfaced if a closure would invalidate an existing future fitting.
  - **Evidence:** The current closure UX remains useful for one-off exceptions, but BE-0 clarified that recurring breaks belong in weekly-window gaps and date-specific closures are the persisted exception model. This item is reopened for that alignment and backend wiring.

- [x] **FIT-FE-054 — De-scope duplicate fitting availability visualization**
  - **Acceptance:**
    - [x] Do not duplicate the main Calendar page inside `/fittings/schedule`.
    - [x] Keep `/fittings/schedule` focused on fitting configuration and do not duplicate Calendar scheduling visualization.
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

- [ ] **FIT-FE-070 — Complete responsive fitting pages** _(reopened for regression verification after BE-0 UI alignment)_
  - **Acceptance:**
    - [x] `/fittings` works at 360px.
    - [x] `/fittings/schedule` works at 360px.
    - [x] No unnecessary page-level horizontal scrolling.
    - [x] Date/time controls do not overflow in the responsive implementation.
    - [x] Primary actions remain reachable.
    - [x] Details Sheet is readable without nested horizontal scrolling.
    - [ ] Re-verify 360px behavior after adding branch capacity/enabled/fee settings and production-aligned New Fitting fields/actions.
  - **Evidence:** The original responsive pass remains valid for the prototype. This item is reopened only because the BE-0 alignment adds/removes controls that must be regression-checked after implementation.

- [x] **FIT-FE-071 — Complete keyboard and accessibility pass**
  - **Acceptance:**
    - [x] Search/filter/forms have accessible names.
    - [x] Appointment rows expose an accessible details action.
    - [x] Sheets/dialogs have title, description, focus management, and close behavior.
    - [x] Status/attention is not color-only.
    - [x] Schedule controls are keyboard reachable.
    - [x] No essential information is hover-only.
  - **Evidence:** Filter triggers expose purpose plus current value, pagination is a named navigation region with an `aria-current` page, customer selection uses a named radiogroup, progress exposes the current step, appointment rows and weekly fitting blocks have explicit details-action labels, and schedule switches/date/time controls remain keyboard-focusable. Shared Radix Sheets retain title/description, focus trapping, Escape/close behavior, and visible close controls. Status, payment, attention, working-hours, and closure meaning are all present as text rather than color alone.

- [ ] **FIT-FE-072 — Complete light/dark theme review** _(reopened for regression verification after BE-0 UI alignment)_
  - **Acceptance:**
    - [x] Text/background contrast remains clear.
    - [x] Status badges retain meaning.
    - [x] Active filters remain distinguishable.
    - [x] Schedule working/booked/closed states remain distinguishable with text/icons as needed.
    - [ ] Re-run light/dark visual review after the reopened Phase 3–5 controls and backend states are wired.
  - **Evidence:** The original theme-token pass remains valid. This item is reopened for regression verification of newly aligned controls, conflict/error states, and settings.

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

- [ ] **FIT-FE-080 — Run owner/front-desk workflow review** _(reopened for production-aligned regression review after backend wiring)_
  - **Acceptance:**
    - [x] Reviewer can find today's/upcoming fittings.
    - [x] Reviewer can understand customer, garments, fee/payment state, and appointment status.
    - [x] Reviewer understands preference-only versus guaranteed garment.
    - [x] Reviewer can visualize creating a fitting.
    - [x] Reviewer understands operating hours, duration, breaks, and closures.
    - [x] Confusing fields/actions are removed rather than justified only by the ERD.
    - [ ] Regression review verifies the production-aligned walk-in requirement (name + phone/email).
    - [ ] Regression review verifies strict configured duration with no per-appointment override and 30-minute start grid.
    - [ ] Regression review verifies branch-configured enabled/capacity/fee settings and no hidden-slot/resource leakage.
    - [ ] Regression review verifies guaranteed-garment conflict handling, required cancel/reject reasons, and lifecycle timing guards.
    - [ ] Regression review verifies the wired backend remains understandable without reintroducing prototype-only controls.
  - **Evidence:** The original workflow review remains historical evidence. This item is reopened for a focused production-aligned regression review after the reopened frontend work is wired to the backend.

- [x] **FIT-FE-081 — Resolve product decisions exposed by the prototype**
  - **Acceptance:**
    - [x] Decide exact fitting statuses/transitions. (`pending`, `confirmed`, `completed`, `rejected`, `cancelled`, `no_show`; strict transition/timing guards)
    - [x] Decide whether `No-show` belongs in initial V1.1. (yes, persisted as `no_show`)
    - [x] Decide fitting duration source/default. (strict branch setting; >=30 and divisible by 30; no per-appointment override)
    - [x] Decide fitting fee source/default. (optional fixed branch setting; ₱300 fixture is not canonical)
    - [x] Decide whether appointment notes are required. (one optional bounded internal staff note)
    - [x] Decide staff-only versus public fitting booking. (staff-created first; domain remains channel-neutral)
    - [x] Decide payment requirement before confirmation. (payment never gates confirmation)
    - [x] Decide fitting cancellation/rejection/refund behavior. (cancel/reject require reason; no automatic refunds; timing guards apply)
  - **Evidence:** [[Fittings Backend Decision Record]] records the approved production behavior and canonical PRD/TRD/Data Model/ERD have been aligned.

- [x] **FIT-FE-082 — Freeze approved frontend prototype for backend handoff**
  - **Acceptance:**
    - [x] Route hierarchy approved. (`/fittings`, `/fittings/schedule`)
    - [x] List fields approved. (date/time, customer, garment summary, fee/payment, status, attention)
    - [x] Details Sheet sections approved. (customer, appointment, garments, fee/payment, local actions)
    - [x] New Fitting inputs approved. (customer, period, garments/intents, optional fee/payment, review)
    - [x] Original schedule interaction pattern approved; production-alignment deltas are explicitly reopened in FIT-FE-050 through FIT-FE-053 and the duplicate weekly availability view remains removed.
    - [x] Prototype-only labels that should not become wire enums are identified.
    - [x] Fixture shapes are not blindly copied into API contracts. _(explicit freeze rule documented)_
    - [x] Backend implementation remains blocked until product decisions are canonicalized; BE-0 now satisfies that gate.
  - **Evidence:** `Fittings Prototype Review Gate.md` and [[Fittings Backend Decision Record]] distinguish the frozen frontend UX from the approved production backend behavior. BE-1 may begin after BE-0 documentation validation.

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
   - Production lifecycle semantics are frozen in [[Fittings Backend Decision Record]].

# Frontend completion definition

The fitting frontend prototype is complete when:

- `/fittings` is visually complete using isolated mock data.
- `/fittings/schedule` is visually complete using isolated mock data.
- Fitting Details Sheet communicates customer, appointment, garment guarantee/preference, and optional fee/payment clearly.
- New Fitting can be walked through locally without a network request.
- The fitting settings surface remains understandable as branch-scoped configuration without exposing hidden capacity-slot implementation details.
- No room/staff/resource management appears in the fitting frontend.
- The prototype works at 360px and with keyboard navigation.
- No real fitting backend/contract/database behavior has been introduced.
- Existing V1 Calendar/Dashboard/Payments behavior has not been expanded accidentally.
- Open domain decisions discovered through the prototype are documented before backend planning begins.

---

# Backend implementation checklist

**Backend status:** BE-0 complete. Contracts/API work may begin from BE-1 using the approved decision record; no migration or route should invent behavior outside that record.

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
- Public fitting booking, analytics, entitlement gating, and customer-facing automated reminders stay out of the first fitting backend slice.
- Backend capacity uses hidden branch capacity slots only; room/staff/named fitting resources are not canonical for this slice.
- [[Fittings Backend Decision Record]] is the approved BE-0 behavior source. PRD, TRD, Data Model and ERD have been aligned to it.

---

# Backend Phase BE-0: Freeze product and domain behavior

- [x] **FIT-BE-000 — Resolve the fitting capacity/resource backend model**
  - **Acceptance:**
    - [x] Choose hidden internal branch capacity slots; no room/staff/named-resource product model.
    - [x] Keep room/staff/resource concepts out of the current frontend unless a later product decision reintroduces them.
    - [x] Update PRD, TRD, Data Model, and ERD together with the canonical model.
    - [x] Define branch settings, weekly windows, recurring-break gaps, date-specific closures, and maximum simultaneous capacity.
    - [x] Define concurrency: one slot allocation per fitting with PostgreSQL overlap exclusion plus serialized branch fitting-setting/booking mutation; no unguarded `count then insert`.
  - **Evidence:** [[Fittings Backend Decision Record]] §Capacity and concurrency model; PRD FR11; TRD release evolution; Data Model §9; fitting tables in the ERD.

- [x] **FIT-BE-001 — Freeze canonical fitting appointment states and transitions**
  - **Acceptance:**
    - [x] Persist `pending`, `confirmed`, `completed`, `rejected`, `cancelled`, `no_show`.
    - [x] Allowed transitions: `pending -> confirmed|rejected|cancelled`; `confirmed -> completed|cancelled|no_show` with the approved time guards.
    - [x] Frontend labels map to those canonical states; wire value for No-show is `no_show`.
    - [x] Payment/evidence status remains independent from appointment status and never gates confirmation.
    - [x] Completed/rejected/cancelled/no_show are terminal; release semantics are state-specific and documented.
    - [x] Use conditional/locked transition guards plus appointment versioning; arbitrary status replacement is forbidden.
  - **Evidence:** [[Fittings Backend Decision Record]] §Appointment lifecycle and §Allocation release rules.

- [x] **FIT-BE-002 — Freeze staff creation and customer rules**
  - **Acceptance:**
    - [x] First production slice is staff-created only; domain remains channel-neutral for future public booking.
    - [x] Staff may select an existing customer.
    - [x] New walk-in requires full name plus phone or email; name-only prototype intake is tightened for production.
    - [x] New walk-in creates a normal `customer` record; no fitting-only identity model.
    - [x] Duplicate detection is advisory; staff chooses existing or deliberately creates new; no automatic merge/reuse by contact alone.
  - **Evidence:** [[Fittings Backend Decision Record]] §Release boundary and §Customers and walk-ins.

- [x] **FIT-BE-003 — Freeze duration and schedule-setting semantics**
  - **Acceptance:**
    - [x] Persist one strict branch fitting duration; no per-appointment override.
    - [x] Start grid is 30 minutes; duration is >=30 and divisible by 30. Prototype `45` is not canonical.
    - [x] Appointment stores the actual bounded period and timezone snapshot; later duration changes do not rewrite history.
    - [x] Weekly hours allow multiple windows; gaps are recurring breaks; date-specific closures handle exceptions; fitting must fit fully within one window and outside closures.
    - [x] Branch timezone is authoritative.
    - [x] Configuration changes cannot invalidate existing future fittings; enabled=false blocks new create/reschedule but preserves existing lifecycle.
  - **Evidence:** [[Fittings Backend Decision Record]] §Branch fitting configuration and §Time, duration, hours, and closures.

- [x] **FIT-BE-004 — Freeze fitting fee, payment, cancellation, and refund rules**
  - **Acceptance:**
    - [x] Fitting fee is optional per branch and fixed for all new fittings in that branch.
    - [x] Current `₱300` fixture is not canonical; configured branch fee is snapshotted with currency.
    - [x] Payment is not required before confirmation.
    - [x] Reuse existing finance charge/payment/evidence/refund domain; no duplicate fitting payment-status source of truth.
    - [x] Positive fee creates immutable `fitting_fee` charge at fitting creation; rejection/cancellation/no-show never infer payment outcome.
    - [x] No automatic refunds; refund/reversal remains an explicit finance action.
  - **Evidence:** [[Fittings Backend Decision Record]] §Fee and finance rules.

- [x] **FIT-BE-005 — Freeze garment preference versus guarantee semantics**
  - **Acceptance:**
    - [x] Preference-only requires a variant but no physical asset assignment/block.
    - [x] Guaranteed requires an eligible concrete physical asset and canonical blocking allocation for exactly the fitting period.
    - [x] Backend deterministically chooses/claims the asset at fitting creation; pending already represents a real guarantee.
    - [x] Guaranteed-asset claim is part of atomic creation/change; conflict fails the command without a partial/fake guarantee.
    - [x] Reschedule/replacement claims new capacity/assets before releasing old. Reject/cancel release immediately; no-show after start; complete at/after end.
  - **Evidence:** [[Fittings Backend Decision Record]] §Garment preference and guarantee, §Atomic creation and reschedule, and §Allocation release rules.

- [x] **FIT-BE-006 — Produce the backend decision record**
  - **Acceptance:**
    - [x] Every BE-0 decision is recorded in [[Fittings Backend Decision Record]] and reflected in canonical PRD/TRD/Data Model/ERD.
    - [x] `Fittings Prototype Review Gate.md` is updated to point to the approved backend decisions and production deltas.
    - [x] No unresolved behavior required for BE-1/BE-2 schema and contract design remains implicit.
  - **Evidence:** `docs/second-brain/05-Operations/Fittings Backend Decision Record.md`, plus the aligned canonical documents.

**BE-0 exit gate:** **PASSED 2026-09-26.** BE-1 contract/API-surface work may begin. Database migrations still wait for the BE-1 contracts to be approved as required by BE-2.

---

# Backend Phase BE-1: Contracts and API surface

**Implementation status:** Complete. The fittings contract surface, generated OpenAPI paths, stable error semantics, and contract tests are implemented and validated. The contracts package is pinned to the Zod-3-compatible `@asteasolutions/zod-to-openapi@7.3.x` line and TypeScript 6.0.3 so OpenAPI generation, `typescript-eslint`, build, and typecheck use a compatible toolchain.

- [x] **FIT-BE-010 — Create the fittings contract module**
  - **Depends on:** BE-0 complete.
  - **Acceptance:**
    - [x] Add `contracts/src/fittings/` with explicit exports from the contracts package index.
    - [x] Define canonical fitting IDs, appointment state, garment-line semantics, fee/payment summary, and schedule-setting DTOs.
    - [x] Reuse common money, pagination, time, error, and idempotency contracts.
    - [x] Do not copy `FittingPrototypeAppointment` or frontend fixture types into contracts.
    - [x] Do not use `Guaranteed intent` as a wire value unless deliberately approved as a domain concept.
  - **Evidence:** `contracts/src/fittings/{state,fitting,intake,list,create,actions,schedule,index}.ts`, shared fitting IDs in `common/ids.ts`, package barrel export in `src/index.ts`.

- [x] **FIT-BE-011 — Define fitting list and detail contracts**
  - **Acceptance:**
    - [x] List response supports bounded pagination using existing API conventions.
    - [x] Filters cover only approved operational needs: customer/garment search, status, and date window.
    - [x] Detail response contains customer, period, garment lines, fee/payment summary, status, and approved actions/state metadata.
    - [x] No hidden capacity-slot identifiers or room/staff/resource fields leak into staff/public fitting contracts.
  - **Evidence:** `fittingListQuery`, `fittingListResponse`, `fittingDetail`, strict schemas and tests in `contracts/tests/fittings.test.ts`.

- [x] **FIT-BE-012 — Define create/update/action contracts**
  - **Acceptance:**
    - [x] Existing-customer and approved walk-in creation paths are explicit.
    - [x] Appointment start is accepted as an ISO instant while strict duration/end-time and the branch-local 30-minute grid remain server-derived/validated.
    - [x] Garment lines distinguish preference-only from guaranteed physical-asset intent using canonical semantics; clients never choose the physical asset.
    - [x] Status changes use explicit confirm/reject/cancel/complete/no-show/reschedule commands rather than arbitrary client state replacement.
    - [x] Mutating API paths require the standard `Idempotency-Key` header contract.
    - [x] Existing-customer lookup is bounded/advisory and does not auto-merge a possible duplicate.
  - **Evidence:** `create.ts`, `actions.ts`, `intake.ts`, and fitting OpenAPI path registrations in `contracts/openapi/generate.ts`.

- [x] **FIT-BE-013 — Define schedule-setting contracts**
  - **Acceptance:**
    - [x] Read/update contract covers approved weekly fitting hours.
    - [x] Strict branch duration, enabled state, simultaneous capacity, and fixed optional fee are included using the canonical BE-0 representation.
    - [x] Weekly-window update and date-specific closure create/edit/remove contracts are explicit; recurring breaks are represented by window gaps.
    - [x] There is no separate weekly availability-preview API solely to recreate the removed frontend section.
  - **Evidence:** `schedule.ts` plus `/fittings/settings`, `/fittings/settings/hours`, and `/fittings/closures*` registrations in the OpenAPI generator.

- [x] **FIT-BE-014 — Define stable fitting error semantics**
  - **Acceptance:**
    - [x] Validation, not-found, forbidden, state-conflict, schedule-conflict, capacity-conflict, and garment-conflict cases map to stable existing error-envelope conventions (`ASSET_UNAVAILABLE` is the existing safe garment-conflict code).
    - [x] Conflict responses are safe and do not expose cross-tenant identifiers or private customer data.
    - [x] Same idempotency key with different validated payload remains the platform-standard `IDEMPOTENCY_KEY_REUSED` conflict.
  - **Evidence:** shared `SCHEDULE_CONFLICT` addition in `common/errors.ts` and fitting path response registrations using the existing `errorEnvelope`.

- [x] **FIT-BE-015 — Add contract tests and package build coverage**
  - **Acceptance:**
    - [x] Contract schemas reject invalid dates, durations, money, state values, malformed lines, browser-owned fee/duration/status/asset authority, and invalid guarantee/asset combinations.
    - [x] Valid list/detail/create/action/intake/schedule examples parse.
    - [x] Package build, lint, and full contract/OpenAPI/test TypeScript checking pass with the compatible contracts toolchain.
    - [x] API and app can load the new `@drezivo/contracts` fitting exports without circular dependencies.
  - **Evidence:** `contracts/tests/fittings.test.ts` plus the full contracts suite (`119/119`), `npm run lint --workspace @drezivo/contracts`, `npm run build --workspace @drezivo/contracts`, `npm run typecheck --workspace @drezivo/contracts`, generated `contracts/openapi/drezivo.v1.yaml` with deterministic regeneration, API typecheck, and App runtime import smoke checks. The App workspace's broader typecheck still has pre-existing `@testing-library/jest-dom` matcher-typing failures unrelated to fittings/contracts.

**BE-1 exit gate:** **PASSED 2026-09-26.** BE-2 database-schema/migration work may begin from the approved fitting contracts and canonical model.

---

# Backend Phase BE-2: Database schema, migration, and invariants

**Implementation status:** FIT-BE-020 persistence expansion, FIT-BE-021 tenant/branch/FK/state integrity, and FIT-BE-022 concurrency/exclusion protection are complete. FIT-BE-023 through FIT-BE-025 still own schedule/closure integrity, RLS/runtime grants, operational indexes, and migration rehearsal required before fitting routes may rely on this schema.

- [x] **FIT-BE-020 — Design the fitting persistence migration from the approved model**
  - **Depends on:** BE-1 contracts approved.
  - **Acceptance:**
    - [x] Add `fitting_appointment` with tenant/branch/customer, canonical status column, bounded-period storage shape, timezone snapshot, currency, fee snapshot, business key, timestamps, and optimistic/version field. Canonical state/range CHECKs are deliberately deferred to FIT-BE-021 rather than being implied by table creation.
    - [x] Add `fitting_line` with variant reference, optional physical asset reference, and canonical guarantee flag. Guarantee/asset/allocation integrity is tightened in FIT-BE-021/FIT-BE-022.
    - [x] Add `fitting_settings`, `fitting_capacity_slot`, `fitting_slot_allocation`, branch-scoped `fitting_hours`, and `fitting_closure` from the approved ERD; no obsolete `fitting_resource`/`resource_allocation` entities are deployed.
    - [x] Activate release-boundary fitting links in canonical `asset_allocation`, `payment`, and `charge`; expand charge kind with `fitting_fee` without introducing a fitting-specific payment-status table.
  - **Evidence:** `api/src/db/migrations/0041_fittings_persistence.sql`, typed Drizzle mappings in `api/src/db/schema/fittings.ts`, schema barrel export, and finance mapping alignment. The complete migration chain through `0041` applied successfully on a disposable PostgreSQL 17.11 database and introspection confirmed all seven fitting tables, `tstzrange` appointment/closure/allocation periods, bigint fitting fee/version columns, and the activated same-tenant fitting FKs.

- [x] **FIT-BE-021 — Add tenant, branch, FK, and state integrity constraints**
  - **Acceptance:**
    - [x] Appointment/customer/variant/asset/capacity references cannot cross tenants.
    - [x] Branch relationships match the appointment branch where required.
    - [x] Period is finite, non-empty, and normalized to canonical `[)` semantics.
    - [x] Guaranteed line constraints require the approved physical-asset relationship.
    - [x] Preference-only lines cannot accidentally carry a blocking physical-asset promise.
    - [x] Amount/currency constraints follow existing finance rules.
  - **Evidence:** `api/src/db/migrations/0042_fittings_integrity.sql` adds canonical state/channel/range/fee/version/reason checks, guarantee/asset semantics, immutable fitting snapshot guards, same-branch slot and guaranteed-asset checks, active-guarantee asset-move protection, and fitting-linked finance currency/fee guards. Existing tenant-paired FKs from `0041` remain the tenant boundary. `api/tests/integration/fittings-phase2-integrity.test.ts` verifies cross-tenant references, same-tenant cross-branch relationships, malformed state/range/guarantee cases, illegal lifecycle edges, and fitting-linked finance snapshot mismatches against PostgreSQL.

- [x] **FIT-BE-022 — Add concurrency/exclusion constraints**
  - **Acceptance:**
    - [x] Guaranteed fitting garments participate in canonical `asset_allocation` overlap exclusion.
    - [x] Hidden capacity-slot overlap protection follows the approved FIT-BE-000 model.
    - [x] Adjacent non-overlapping intervals are allowed.
    - [x] Blocking versus released/non-blocking semantics are explicit.
    - [x] Constraint behavior is verified in PostgreSQL integration tests, not only TypeScript unit tests.
  - **Evidence:** `api/src/db/migrations/0043_fittings_exclusion.sql` adds GiST overlap exclusion for hidden capacity slots, one-current-blocking-claim partial uniqueness for capacity and guaranteed fitting lines, released/history semantics, and deferred final-state validation requiring scheduled fittings to own exactly one active same-branch slot plus one matching canonical asset allocation for each guaranteed line. PostgreSQL integration tests race two transactions for the same final capacity slot and the same physical garment, verify one valid winner, verify adjacent `[)` periods succeed, and verify released allocation history remains while the slot/asset becomes reusable.

- [x] **FIT-BE-023 — Add fitting schedule and closure persistence**
  - **Acceptance:**
    - [x] Weekly hours support ISO weekdays Monday=1 through Sunday=7 and multiple local windows per day, with an eight-window technical safety bound aligned to BE-1 contracts.
    - [x] Strict duration, maximum simultaneous capacity, enabled state, fixed fee/currency and optimistic version persist in the branch-scoped `fitting_settings` row; tenant currency mismatch is rejected.
    - [x] Recurring breaks are represented only by gaps between weekly windows; date-specific partial/full-day closures persist in `fitting_closure` as finite `[)` instants plus a bounded reason/timezone snapshot.
    - [x] Invalid weekday/order/second-precision windows and true same-day overlaps are rejected in PostgreSQL while adjacent half-open windows remain valid; active hidden slots cannot exceed configured branch capacity.
    - [x] Branch timezone is authoritative for local fitting schedule interpretation, and new/edited closure timezone snapshots must match the owning branch timezone.
  - **Evidence:** `api/src/db/migrations/0044_fitting_schedule_persistence.sql`, aligned Drizzle checks in `api/src/db/schema/fittings.ts`, and PostgreSQL integration coverage in `api/tests/integration/fittings-phase2-schedule.test.ts`. Operational command authorization/version checks and guards that reject settings/closure changes which would invalidate already-accepted future fittings remain intentionally owned by BE-6 (`FIT-BE-060`–`FIT-BE-063`), rather than being hidden inside persistence-only triggers.

- [x] **FIT-BE-024 — Add RLS and least-privilege database policies**
  - **Acceptance:**
    - [x] Every tenant-owned fitting table has read/write RLS consistent with the existing tenant GUC pattern.
    - [x] Worker/system access, if needed, is explicit and minimal.
    - [x] No fitting table is accidentally accessible through a global role.
    - [x] Cross-tenant SQL integration tests fail closed.
  - **Evidence:** `api/src/db/migrations/0045_fittings_rls_privileges.sql` enables and forces RLS on all seven fitting tables, installs the existing `NULLIF(current_setting('app.tenant_id', true), '')::uuid` tenant policy for `drezivo_app`, explicitly revokes `PUBLIC` and `drezivo_worker`, and grants only the HTTP runtime operations required by the approved first slice. Appointment/settings/current-slot history are not hard-deletable through the runtime. `api/tests/integration/fittings-phase2-rls-indexes.test.ts` proves unscoped app reads return zero rows, cross-tenant writes fail with `42501`, worker/global access is absent, and all fitting tables report forced RLS.

- [ ] **FIT-BE-025 — Add fitting indexes and migration rehearsal**
  - **Acceptance:**
    - [x] Index tenant/branch/period/status/customer access patterns used by list/calendar queries.
    - [x] Add supporting indexes for guaranteed-asset/capacity conflict checks.
    - [ ] Rehearse migration on an isolated Neon branch with synthetic/anonymized data.
    - [x] Run migration invariants and explain any lock-sensitive operation.
    - [x] Prefer roll-forward correction; do not assume app rollback reverses data migration safely.
  - **Evidence:** `api/src/db/migrations/0046_fittings_indexes.sql` adds bounded list/calendar/customer/status/detail/schedule/closure indexes plus active hidden-capacity and guaranteed-asset lookup support without adding redundant indexes to the existing production-hot `asset_allocation` table. Representative `EXPLAIN` assertions in `api/tests/integration/fittings-phase2-rls-indexes.test.ts` verify the calendar GiST, active-capacity, and fitting-line paths. The full migration chain `0000` through `0046` was rehearsed from scratch on a disposable local PostgreSQL 17.11 database with synthetic fitting data and all migration/invariant tests passing. Ordinary transactional `CREATE INDEX` is intentional while fitting tables are pre-release; the migration documents that a post-traffic replay must use a rehearsed roll-forward/concurrent-index strategy rather than assuming application rollback can undo schema/data changes. A safe isolated Neon branch is not configured in this checkout, so that environment-specific rehearsal remains unchecked instead of being claimed.

---

# Backend Phase BE-3: Read repositories and query services

- [x] **FIT-BE-030 — Implement tenant-scoped fitting list repository**
  - **Acceptance:**
    - [x] Query is tenant/branch scoped from server context.
    - [x] Search/filter behavior supports approved customer/garment/status/date needs.
    - [x] Pagination is bounded and deterministic.
    - [x] Query does not produce N+1 customer/garment/payment lookups.
    - [x] Response projection never exposes hidden capacity-slot IDs or backend-only slot allocation details.
  - **Evidence:** `api/src/modules/fittings/fittings.repository.ts` performs one tenant/branch-scoped statement per page with bounded contract pagination, stable `(time,id)` cursors, customer/garment/status/period search/filtering, lateral garment/payment aggregation, and no capacity-slot projection.

- [x] **FIT-BE-031 — Implement fitting detail repository**
  - **Acceptance:**
    - [x] Loads appointment, customer, lines, approved asset guarantee data, and fee/payment summary in one bounded domain read.
    - [x] Returns not-found for inaccessible/cross-tenant IDs without leaking existence.
    - [x] Historical snapshot fields are used where later mutable settings must not rewrite appointment meaning.
  - **Evidence:** `readFittingDetailModel` branch/tenant-scopes the ID and projects the immutable appointment period/timezone/fee/currency snapshot plus customer, garment guarantee/asset and shared-finance summary in one statement. `fittings.service.ts` maps the result through the approved contracts and turns an inaccessible ID into the same not-found result.

- [x] **FIT-BE-032 — Implement schedule-setting reads**
  - **Acceptance:**
    - [x] Returns branch fitting enabled state, simultaneous capacity, strict duration, fixed optional fee, weekly windows, and date-specific closures.
    - [x] No weekly availability-preview query is introduced for `/fittings/schedule`.
    - [x] Data shape supports the approved frontend without exposing backend-only concurrency machinery.
  - **Evidence:** `api/src/modules/fittings/fittings.schedule.repository.ts` reads scalar settings + branch timezone + recurring windows and separately provides bounded closure history. It never reads or returns `fitting_capacity_slot` / `fitting_slot_allocation` and deliberately contains no weekly availability-preview query.

- [x] **FIT-BE-033 — Add read repository tests**
  - **Acceptance:**
    - [x] Empty, filtered, paginated, past/upcoming, and multi-garment cases are covered.
    - [x] Cross-tenant and unauthorized branch reads fail.
    - [x] Query count/performance stays bounded for representative seeded data.
  - **Evidence:** `api/tests/integration/fittings-phase3-read-repositories.test.ts` seeds multiple fittings/garment lines and covers empty branch scope, deterministic two-page reads, status/date/garment search, cross-tenant detail concealment, schedule windows and closure reads. Repository shape is one SQL statement per list/detail/settings/closure invocation, so representative query count is constant rather than item-dependent. API typecheck and lint pass. The PostgreSQL test suite is present but could not be executed in this turn because no `TEST_DATABASE_URL` is configured and the guessed local postgres credential was correctly rejected; this is an environment validation gap, not claimed passing evidence.

---

# Backend Phase BE-4: Appointment creation, update, and atomic allocation

- [ ] **FIT-BE-040 — Implement staff fitting creation service**
  - **Acceptance:**
    - [x] Existing-customer and approved walk-in flow follow FIT-BE-002; new walk-ins require full name plus phone or email.
    - [x] Start aligns to the 30-minute grid; period is derived from the branch strict duration and branch timezone, never a client override.
    - [x] Creation always starts `pending`.
    - [x] Garment lines are validated against tenant catalogue/variant ownership.
    - [x] Fee/currency snapshot comes from branch fitting settings; positive fee creates the immutable `fitting_fee` charge.
    - [ ] Appointment, one hidden capacity-slot allocation, all lines/guaranteed asset allocations, finance charge when applicable, audit metadata and approved outbox intent commit as one idempotent transaction.
  - **Progress:** `api/src/modules/fittings/fittings.command.{service,repository}.ts` now implements the staff create orchestration, existing/new customer handling, branch-local 30-minute grid check, strict-duration period derivation, tenant catalogue validation, pending-only appointment insertion, fitting fee charge snapshot, audit event, and tenant idempotency replay/conflict semantics. Guaranteed requests fail closed rather than creating a fake guarantee. The final acceptance item remains intentionally open until FIT-BE-041/FIT-BE-043 provide the atomic hidden capacity-slot and guaranteed-asset claim seams; first-slice fitting notifications/outbox are explicitly deferred by the decision record. Typecheck, lint, and 83 non-integration API tests pass.

- [ ] **FIT-BE-041 — Implement schedule/capacity validation**
  - **Acceptance:**
    - [ ] Appointment falls fully inside one approved operating window; there is no first-slice schedule override.
    - [ ] Weekly-window gaps and date-specific closures are enforced.
    - [ ] One hidden capacity-slot claim follows the approved atomic concurrency model.
    - [ ] Simultaneous requests cannot overbook a hidden capacity slot or exceed branch capacity.

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

- [ ] **FIT-BE-044 — Implement fitting reschedule and future garment-plan update semantics**
  - **Acceptance:**
    - [ ] Reschedule is a dedicated command allowed only for future `pending`/`confirmed` fittings before scheduled start.
    - [ ] Validate and claim replacement capacity/guaranteed garments before releasing old claims.
    - [ ] Failed reschedule preserves the old period, status, guaranteed assets, and capacity allocation.
    - [ ] Future `pending`/`confirmed` garment-line edits are allowed before start; guaranteed replacement claims the new asset before releasing the old guarantee.
    - [ ] Once start is reached or the appointment is terminal, period/garment planning is immutable.
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
    - [ ] Implement only `confirm`, `reject`, `cancel`, `complete`, and `mark-no-show` according to FIT-BE-001.
    - [ ] `reject` is pending-only and `reject`/`cancel` require a bounded internal reason.
    - [ ] Normal `cancel` is allowed only before scheduled start; `no_show` only after start; `complete` only at/after end.
    - [ ] Each action checks current state/version inside the transaction; no automatic clock-driven transition exists.
    - [ ] Arbitrary client-provided status replacement is not allowed.
    - [ ] Owner and Front Desk may perform operational actions subject to timing/state guards; finance permissions remain separate.

- [ ] **FIT-BE-051 — Implement confirmation semantics**
  - **Acceptance:**
    - [ ] Confirmation verifies the pending fitting still owns its required hidden capacity slot and guaranteed garment claims; it does not allocate them for the first time.
    - [ ] Payment/evidence never gates confirmation and is never inferred from appointment state.
    - [ ] Confirmation is idempotent and race-safe.

- [ ] **FIT-BE-052 — Implement reject/cancel/no-show allocation behavior**
  - **Acceptance:**
    - [ ] Reject/cancel release hidden capacity and guaranteed asset allocations immediately.
    - [ ] No-show is available only after scheduled start and releases remaining active capacity/asset blocks immediately.
    - [ ] None of these appointment actions automatically refunds, verifies, voids, or otherwise fabricates a payment outcome.
    - [ ] Repeated terminal action requests are duplicate-safe.

- [ ] **FIT-BE-053 — Implement completion semantics**
  - **Acceptance:**
    - [ ] Completion is accepted only for `confirmed` fittings at/after scheduled end and records the winning terminal transition once.
    - [ ] Capacity/guaranteed asset allocations are closed/released without deleting allocation history.
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
    - [ ] Owner-only mutation and Owner/Front Desk read permissions match the approved policy.
    - [ ] Enable/disable weekday behavior is explicit.
    - [ ] Multiple windows per day are validated and normalized.
    - [ ] Invalid or disallowed overlapping windows are rejected.

- [ ] **FIT-BE-061 — Implement branch fitting settings**
  - **Acceptance:**
    - [ ] Replace the frontend session-storage prototype setting with one branch-scoped settings source.
    - [ ] Persist `fittings_enabled`, maximum simultaneous capacity, strict duration, optional fixed fee/currency, and version.
    - [ ] New fittings always use the configured strict duration and fee; no per-appointment override exists.
    - [ ] Duration/fee changes affect new fittings only; existing appointments retain stored period/fee snapshots.
    - [ ] Disabling fittings blocks new create/reschedule while preserving existing lifecycle actions.
    - [ ] Capacity reduction is rejected when existing future fittings require more simultaneous slots.

- [ ] **FIT-BE-062 — Implement weekly-window and date-specific closure persistence**
  - **Acceptance:**
    - [ ] Weekly window replacement and closure create/edit/remove are tenant/branch scoped and idempotent where applicable.
    - [ ] Weekly windows validate weekday/start/end/non-overlap; their gaps represent recurring breaks.
    - [ ] Closure period and bounded reason are validated server-side in branch timezone.
    - [ ] Hours/closure changes that would invalidate existing future fittings are rejected.
    - [ ] Closures participate in appointment schedule validation using the approved BE-0 model.

- [ ] **FIT-BE-063 — Add schedule-setting tests**
  - **Acceptance:**
    - [ ] Seven-day schedule, split windows, unavailable days, and date exceptions are covered.
    - [ ] Timezone and date-boundary cases are covered.
    - [ ] Capacity reductions, shortened hours, and new closures that would invalidate future fittings are rejected; duration/fee changes do not rewrite existing appointment snapshots.

---

# Backend Phase BE-7: Fitting fee and finance integration

**Approved phase:** FIT-BE-004 approved an optional fixed branch fitting fee. Positive snapshotted fees create immutable `fitting_fee` charges; payment/refund behavior reuses the existing finance domain.

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

- [ ] **FIT-BE-073 — Implement explicit fitting finance correction/refund behavior**
  - **Acceptance:**
    - [ ] Appointment rejection/cancellation/no-show never automatically creates a refund or finance reversal.
    - [ ] Any fitting-fee refund/reversal is an explicit existing-finance command with existing authorization.
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
    - [ ] Owner and Front Desk may perform approved operational fitting actions; Owner alone may mutate enabled/capacity/duration/fee/hours/closures.
    - [ ] Fitting permissions do not grant payment verification/refund authority beyond the existing finance policy.
    - [ ] Every route checks active membership and tenant/branch scope.
    - [ ] Cross-tenant IDs fail without leaking object existence.

- [ ] **FIT-BE-091 — Complete fitting RLS and pooled-connection isolation tests**
  - **Acceptance:**
    - [ ] Reused pooled connections cannot retain another tenant context.
    - [ ] Missing/empty tenant context fails closed.
    - [ ] Rollback and revoked membership cases do not leak fitting/customer/payment data.

- [ ] **FIT-BE-092 — Complete concurrency falsification suite**
  - **Acceptance:**
    - [ ] With branch capacity `N`, `N + 1` truly overlapping create/reschedule attempts cannot produce more than `N` winners; slot exclusion remains authoritative under races.
    - [ ] Same guaranteed garment contention has one winner.
    - [ ] Capacity/hour/closure configuration racing a booking cannot commit a booking that violates the winning configuration.
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
    - [ ] Tighten walk-in creation to require full name plus phone or email.
    - [ ] Remove per-appointment duration/fee overrides; New Fitting reads the active branch strict duration and fee.
    - [ ] Replace prototype `Guaranteed intent` with the canonical guarantee request/result presentation without exposing physical capacity slots.
    - [ ] Remove local status mutation as production authority.

- [ ] **FIT-BE-101 — Wire `/fittings/schedule` to persisted settings**
  - **Acceptance:**
    - [ ] Add simple branch-level controls for fittings enabled, maximum simultaneous fittings, strict duration, and optional fixed fee without exposing hidden slot/resource identities.
    - [ ] Weekly windows and date-specific closures load/save through backend contracts; recurring breaks are represented by split windows.
    - [ ] Remove session-storage duration and local-only fee/schedule state as production authority.
    - [ ] Surface server rejection when a settings change would invalidate existing future fittings.
    - [ ] Do not reintroduce the removed weekly availability section.

- [ ] **FIT-BE-102 — Replace fitting prototype data in Calendar/Dashboard/Availability/Payments**
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
    - [ ] Update enabled/capacity/duration/fee/weekly windows/closure and verify configuration guards plus create validation.
    - [ ] Exercise approved fitting-fee charge/payment flow.

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
- Branch enabled/capacity/strict duration/fixed fee/weekly windows/date-specific closures are persisted and enforced server-side.
- Payment state remains separate from appointment state, with existing finance behavior reused rather than duplicated.
- Calendar/Dashboard/Availability/Payments integration uses authoritative fitting data without duplicating the schedule-settings feature.
- Cross-tenant, RLS, idempotency, race, timezone, and migration tests pass.
- The frontend no longer depends on fitting fixture data or session storage for production behavior.
