---
title: Fittings V1.1 Frontend Prototype Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-26
tags: [drezivo, v1.1, fittings, frontend, prototype, checklist]
---

# Fittings V1.1 Frontend Prototype Checklist

**Status:** Planned; this checklist is intentionally **frontend-only**. The goal is to visualize and validate the staff fitting experience before any fitting contracts, API routes, migrations, or backend services are implemented.

**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).

**Related operational checklists:** [[Schedule Calendar Checklist]], [[Dashboard Checklist]], [[Availability Checklist]], [[Reservations Checklist]], and [[Core Rental Operations Checklist]].

## How to use this checklist

Implement the fitting staff experience as a **V1.1 visual prototype** using local mock data only. The prototype should answer whether the proposed fitting workflow is understandable for a clothing-rental owner/front desk before Drezivo commits to fitting backend behavior.

Do not use this checklist to create or imply production fitting behavior.

Before marking a task complete:

- No fitting API route is added.
- No fitting database migration/table is added.
- No fitting contract/schema is added to `@drezivo/contracts`.
- No fitting payment, slot, garment, or resource mutation is presented as authoritative.
- Mock data is clearly isolated from production API clients and easy to delete later.
- The UI follows the current Drezivo dashboard visual language and reuses existing shared components where practical.
- Any fitting status, fee, duration, note field, or public-booking behavior that is not canonical is marked as a **prototype assumption**, not silently promoted to product truth.
- Existing V1 rental pages continue to behave as V1 surfaces; this prototype must not make Fittings appear production-ready in Dashboard, Schedule, Payments, or Availability.

## Frontend-only boundary

### In scope

- `/fittings` staff page.
- Fitting appointment list/table.
- Summary indicators useful for fitting operations.
- Search and presentation-only filters.
- Fitting Details Sheet.
- New Fitting prototype flow.
- Garment preference versus guaranteed-garment presentation.
- Assigned room/staff/resource presentation.
- Fitting fee/payment-state presentation where useful.
- `/fittings/schedule` staff page.
- Resource list and resource detail/edit prototype.
- Working-hours visualization.
- Break/closure visualization.
- Resource availability visualization.
- Loading, empty, error, disabled, responsive, keyboard, and dark-mode states.
- Mock scenarios needed to visualize conflicts and attention states.

### Explicitly out of scope

- Fitting contracts in `contracts/`.
- API routes/services/repositories.
- PostgreSQL fitting tables or migrations.
- Real `fitting_appointment`, `fitting_line`, `fitting_resource`, `resource_allocation`, or `fitting_hours` persistence.
- Real slot claiming or overlap enforcement.
- Real garment allocation for fittings.
- Real payment creation/verification/refunds.
- Real email/guest links.
- Public customer fitting booking.
- Calendar/Dashboard production fitting queries.
- Entitlement enforcement.
- Analytics/reporting.

## Canonical model the UI must visualize

The frontend prototype should reflect the V1.1 model without pretending to implement it:

```text
Fitting Appointment
  ├── Customer
  ├── Date / time period
  ├── Garment line(s)
  │    ├── Variant preference
  │    └── Optional guaranteed physical garment
  ├── Resource assignment(s)
  │    ├── Room
  │    ├── Staff
  │    └── Capacity slot where applicable
  └── Optional fitting fee / payment state
```

Important visual rule:

```text
Garment preference ≠ Guaranteed garment
```

A preferred garment with no physical asset assignment must never be presented as guaranteed. The prototype must make this distinction understandable to staff.

## Prototype assumptions that must remain visibly non-canonical

The current canonical docs do **not** fully decide the following. The frontend may visualize them, but must keep them centralized in mock constants/types and easy to replace:

- Exact fitting appointment status enum/state machine.
- Whether `no-show` is a fitting status in the first V1.1 release.
- Default fitting duration source.
- Default fitting fee source.
- Whether appointment notes persist directly on the fitting appointment.
- Whether the first V1.1 release includes customer self-booking or staff-only creation.
- Exact payment requirement for a fitting.
- Exact cancellation/rejection/refund policy for fitting fees.

For prototype presentation, labels such as **Pending**, **Confirmed**, **Completed**, **Cancelled**, **Rejected**, and **No-show** may be used only as mock UI vocabulary until the product state machine is approved.

---

# Phase 0: Audit current fitting prototype surface

**Phase status:** Complete for frontend prototyping. No fitting backend/contracts/schema were added.

- [x] **FIT-FE-000 — Inventory all current fitting UI references**
  - **Outcome:** We know every place the current app already visually implies fitting functionality.
  - **Acceptance:**
    - [x] Record the existing `/fittings` sidebar link.
    - [x] Record current Dashboard fitting mock metrics/cards.
    - [x] Record current Schedule/Calendar fitting mock events and filters.
    - [x] Record current Availability fitting mock blocks if still present.
    - [x] Review `RootResource/Business/(6) fitting/Fitting Page.png` as a historical page reference alongside the historical fitting page specification.
    - [x] Review `RootResource/Business/(6) fitting/Fitting Details.png` as a historical details reference alongside the historical fitting details specification.
    - [x] Review `RootResource/Business/(6) fitting/Fitting Schedule & Availability.png` as a historical schedule reference alongside the historical fitting schedule specification.
    - [x] Identify which pieces are still useful visual references versus outdated product behavior.
  - **Evidence:**
    - `app/src/components/shell/dashboard-sidebar.tsx` already exposes `/fittings`; there is still no fitting page route, so the link currently points at an unimplemented surface.
    - `app/src/components/dashboard/dashboard-data.ts` currently contains a `Fittings Today` metric plus fitting entries in `TODAY_SCHEDULE`. These remain historical mock references and must not be treated as V1 production data.
    - `app/src/components/calendar/calendar-schedule-data.ts` and `calendar-schedule-page.tsx` include fitting activities, fitting counts, a fitting activity filter, and generic fitting detail behavior. The calendar prototype currently maps a fitting activity to a generic `Pending` status in places; this is not an approved fitting state machine.
    - `app/src/components/calendar/calendar-availability-data.ts` and `calendar-availability-page.tsx` include `Fitting` as an availability state and render fitting blocks against garments. This is too broad for the canonical V1.1 model: only an explicitly guaranteed physical garment may justify a fitting-linked asset allocation. A preference-only garment must not become unavailable merely because it appears on a fitting.
    - `app/src/components/reservations/reservation-availability-calendar.tsx` can display `Fitting` when an availability projection reports fitting assets. This is an existing future-facing projection hook, not authority for the new prototype data model.
    - The three `RootResource/Business/(6) fitting/*.png` files are retained as historical visual references. Their related historical product docs describe appointment lists, customer/date/time/status, fee/payment/notes details, and schedule settings such as operating hours, duration, breaks, and maximum appointments per slot. Current PRD/data-model rules supersede those behaviors where they conflict.
    - **Retain as useful UI inspiration:** operational appointment list, date/time/customer/status scanning, a details sheet, visible fee/payment state, schedule/availability entry point, operating-hour and break visualization.
    - **Reject or redesign:** `max appointments per slot` as a single counter; blanket `Fitting` garment-unavailability blocks; treating appointment status and payment status as one concept; assuming every fitting requires payment; assuming customer self-booking/receipt upload is already approved; treating notes/default duration/default fee as canonical fields before those decisions are approved.

- [x] **FIT-FE-001 — Confirm frontend-only prototype data boundary**
  - **Depends on:** FIT-FE-000.
  - **Outcome:** Mock fitting data cannot accidentally become a fake production data source.
  - **Acceptance:**
    - [x] Create fitting mock data in a clearly named frontend-only mock/fixture module.
    - [x] Do not place fitting mock arrays inside shared production API client modules.
    - [x] Do not copy fitting mock types into `@drezivo/contracts`.
    - [x] Add a concise code comment where needed stating that the data is V1.1 visualization only.
    - [x] Use stable synthetic IDs so list/detail interactions feel realistic.
    - [x] No real customer PII or payment evidence is used in fixtures.
  - **Evidence:**
    - Prototype source: `app/src/components/fittings/fitting-prototype-data.ts`.
    - The module has no API-client or `@drezivo/contracts` imports and labels itself as V1.1 frontend visualization data only.
    - Appointment IDs use stable `fit-proto-*` identifiers; resource IDs use stable `fit-resource-*` identifiers.
    - Contacts use reserved `example.test` email addresses and obviously synthetic phone numbers.
    - Fixture scenarios include guaranteed garments, preference-only garments, payment review, missing resources, completed appointments, and a prototype no-show state so later screens can expose product questions instead of hiding them.
    - `app/tests/unit/fitting-prototype-data.test.ts` checks route constants, stable unique IDs, synthetic contacts, attention scenarios, and the invariant that preference-only garments never carry a guaranteed asset code.

- [x] **FIT-FE-002 — Define the prototype information architecture**
  - **Depends on:** FIT-FE-000.
  - **Outcome:** Fittings has a simple staff navigation model before component work begins.
  - **Acceptance:**
    - [x] `/fittings` is the appointment operations page.
    - [x] `/fittings/schedule` is the fitting resources/schedule page.
    - [x] Appointment details open in a Sheet from `/fittings`.
    - [x] `+ New Fitting` launches one clearly defined prototype flow.
    - [x] `Schedule & Availability` navigates from `/fittings` to `/fittings/schedule`.
    - [x] Settings/configuration is not mixed into the main appointment table.
  - **Evidence:**

```text
/fittings
  FittingsPage
    ├── operational summary
    ├── search + filters
    ├── appointment list
    ├── FittingDetailsSheet
    └── NewFittingSheet / prototype flow

/fittings/schedule
  FittingSchedulePage
    ├── resource list
    ├── working hours
    ├── breaks / closures
    └── resource availability visualization
```

  - `FITTING_PROTOTYPE_ROUTES` centralizes the two frontend prototype routes without creating production API contracts.
  - Appointment operations and fitting resource configuration remain separate surfaces so the main fitting page stays operational rather than becoming a settings dashboard.

---

# Phase 1: `/fittings` page shell and operational hierarchy

- [ ] **FIT-FE-010 — Create the Fittings route and page shell**
  - **Depends on:** FIT-FE-002.
  - **Outcome:** Sidebar `/fittings` no longer lands on a missing route.
  - **Acceptance:**
    - [ ] Page uses the authenticated dashboard shell already used by Reservations/Clothing/Calendar.
    - [ ] Page title is `Fittings`.
    - [ ] Supporting copy is short and operational, not marketing-heavy.
    - [ ] Primary action is `New Fitting`.
    - [ ] Secondary action is `Schedule & Availability`.
    - [ ] Layout remains usable at 360px.
    - [ ] No backend-ready/production-ready wording is shown.
  - **Evidence:** Browser screenshot/walkthrough in desktop and mobile widths.

- [ ] **FIT-FE-011 — Add compact fitting summary indicators**
  - **Depends on:** FIT-FE-010.
  - **Outcome:** Staff can quickly understand the prototype fitting workload.
  - **Acceptance:**
    - [ ] Keep indicators limited to operationally useful values such as `Today`, `Upcoming`, and `Pending Review`.
    - [ ] Avoid analytics-heavy metrics such as conversion/revenue/utilization in this first prototype.
    - [ ] Counts come from the local fitting fixture, not duplicated hard-coded totals.
    - [ ] Indicator click behavior is either functional filtering or intentionally non-interactive; no fake clickable cards.
    - [ ] Labels do not imply an approved backend status model beyond the prototype.
  - **Evidence:** Summary values match visible fixture data.

- [ ] **FIT-FE-012 — Add search and fitting list filters**
  - **Depends on:** FIT-FE-010.
  - **Outcome:** Dense appointment data can be explored like an operational staff page.
  - **Acceptance:**
    - [ ] Search matches customer name and garment display name from mock data.
    - [ ] Status filter uses prototype-only labels.
    - [ ] Date filter supports a small useful set such as Today / Upcoming / All or an existing date control pattern.
    - [ ] Resource filter is included only if it improves the prototype with the seeded resource data.
    - [ ] Reset/clear behavior works.
    - [ ] Empty filtered results show a useful state.
    - [ ] Filter controls wrap cleanly on small screens.
  - **Evidence:** Browser interaction demonstrates search, each filter, reset, and empty result state.

---

# Phase 2: Appointment list/table

- [ ] **FIT-FE-020 — Build the fitting appointment table/list**
  - **Depends on:** FIT-FE-011, FIT-FE-012.
  - **Outcome:** `/fittings` becomes a believable operational appointment view.
  - **Acceptance:**
    - [ ] Show appointment date/time.
    - [ ] Show customer name.
    - [ ] Show garment summary such as one garment name or `2 garments`.
    - [ ] Show primary assigned resource when useful.
    - [ ] Show fitting fee/payment summary only where present in the fixture.
    - [ ] Show appointment status separately from payment status.
    - [ ] Avoid placing phone, email, receipt/evidence, measurements, or long notes directly in the table.
    - [ ] Row click/button opens the Fitting Details Sheet.
    - [ ] Dense desktop rows remain easy to scan.
    - [ ] Mobile layout becomes a compact stacked list rather than an unusable wide table where needed.
  - **Evidence:** Desktop and 360px browser walkthrough.

- [ ] **FIT-FE-021 — Add meaningful attention states**
  - **Depends on:** FIT-FE-020.
  - **Outcome:** The prototype can visualize why a fitting may need staff attention.
  - **Acceptance:**
    - [ ] Seed at least one fitting with payment review attention.
    - [ ] Seed at least one fitting with unassigned required resource or another prototype conflict state.
    - [ ] Seed at least one fitting with a garment preference that is not guaranteed.
    - [ ] Attention state is communicated by text/icon, not color alone.
    - [ ] Do not claim the frontend detected a real backend conflict.
  - **Evidence:** At least three fixture scenarios are visibly distinguishable.

- [ ] **FIT-FE-022 — Add list empty/loading/error prototype states**
  - **Depends on:** FIT-FE-020.
  - **Outcome:** Page behavior is designed before future API integration.
  - **Acceptance:**
    - [ ] Empty tenant state explains that there are no fitting appointments yet.
    - [ ] Empty filtered state differs from the first-use empty state.
    - [ ] Loading skeleton follows the table/list structure.
    - [ ] Error state includes retry UI even though prototype data may simulate the state locally.
    - [ ] No fake zero counts are presented as authoritative while loading.
  - **Evidence:** Each state can be intentionally rendered/tested during development.

---

# Phase 3: Fitting Details Sheet

- [ ] **FIT-FE-030 — Build the Fitting Details Sheet shell**
  - **Depends on:** FIT-FE-020.
  - **Outcome:** Staff can inspect one appointment without leaving the main list.
  - **Acceptance:**
    - [ ] Sheet uses the same interaction language as existing Reservation/Calendar detail sheets.
    - [ ] Accessible title and description are present.
    - [ ] Appointment status appears prominently but separately from payment state.
    - [ ] Date and time period are easy to scan.
    - [ ] Sheet supports direct opening from any fitting list row fixture.
    - [ ] Sheet has a sensible mobile/full-width treatment.
  - **Evidence:** Keyboard and pointer open/close behavior works.

- [ ] **FIT-FE-031 — Add customer section**
  - **Depends on:** FIT-FE-030.
  - **Outcome:** Details provide the minimum staff-facing customer context.
  - **Acceptance:**
    - [ ] Show customer name.
    - [ ] Show only the mock contact fields needed to visualize the future staff experience.
    - [ ] Avoid identity documents or excessive private information.
    - [ ] Do not imply a customer account is required.
  - **Evidence:** Customer section remains concise and consistent with Drezivo privacy direction.

- [ ] **FIT-FE-032 — Add garment section with preference/guarantee distinction**
  - **Depends on:** FIT-FE-030.
  - **Outcome:** The UI correctly visualizes fitting garments according to the V1.1 model.
  - **Acceptance:**
    - [ ] Each fitting garment displays style/variant information needed by staff.
    - [ ] `Preference only` is clearly distinguishable from `Guaranteed garment`.
    - [ ] Guaranteed fixture may display a synthetic physical asset code.
    - [ ] Preference-only fixture must not display language such as `Reserved`, `Held`, or `Guaranteed`.
    - [ ] Multiple fitting lines can be visualized without making the sheet noisy.
  - **Evidence:** One fixture contains both a guaranteed garment and a preference-only garment.

- [ ] **FIT-FE-033 — Add assigned resources section**
  - **Depends on:** FIT-FE-030.
  - **Outcome:** Staff can see which room/staff/capacity resources the fitting uses.
  - **Acceptance:**
    - [ ] Display resource name and kind.
    - [ ] Support more than one resource per fitting in the fixture.
    - [ ] Missing/unassigned resource is a visible attention state rather than silently omitted.
    - [ ] Resource presentation does not imply frontend ownership of availability.
  - **Evidence:** Fixtures include room-only, room+staff, and missing-resource scenarios.

- [ ] **FIT-FE-034 — Add fitting fee/payment presentation**
  - **Depends on:** FIT-FE-030.
  - **Outcome:** UI explores how fitting money could appear while keeping payment truth separate.
  - **Acceptance:**
    - [ ] Show fitting fee only when configured in the mock appointment.
    - [ ] Payment state is visually separate from fitting appointment status.
    - [ ] Use safe mock labels such as `Awaiting payment`, `Under review`, or `Verified` only as presentation fixtures.
    - [ ] Do not show uploaded receipt bytes or fake automatic verification behavior.
    - [ ] Do not automatically change fitting status because payment state changes in the frontend.
  - **Evidence:** At least one paid/review and one no-fee or unpaid scenario are visualized.

- [ ] **FIT-FE-035 — Add prototype appointment actions**
  - **Depends on:** FIT-FE-030.
  - **Outcome:** We can evaluate action placement without implementing real mutations.
  - **Acceptance:**
    - [ ] Actions are clearly disabled, mock-only, or local-state-only during this phase.
    - [ ] Potential actions such as Confirm, Complete, Cancel, Reject, or Mark no-show are not all shown unless useful to the prototype.
    - [ ] Destructive actions use an explicit confirmation pattern if enabled locally.
    - [ ] Local mock handlers include in-flight/double-submit guard structure if they simulate a mutating experience.
    - [ ] No action sends a network request.
  - **Evidence:** UI makes it impossible to mistake a prototype action for a persisted backend change.

---

# Phase 4: New Fitting prototype flow

- [ ] **FIT-FE-040 — Define the staff New Fitting interaction pattern**
  - **Depends on:** FIT-FE-010.
  - **Outcome:** One creation pattern is used consistently for the prototype.
  - **Acceptance:**
    - [ ] Choose either a dedicated route or a large Sheet/Dialog based on existing dashboard patterns.
    - [ ] Avoid an overly long single form when grouping improves clarity.
    - [ ] Flow can be completed comfortably on mobile.
    - [ ] Closing/reopening intentionally resets or restores local draft according to the chosen prototype behavior.
  - **Evidence:** Interaction decision is reflected consistently in the implementation.

- [ ] **FIT-FE-041 — Add customer selection/input prototype**
  - **Depends on:** FIT-FE-040.
  - **Outcome:** Staff can visualize selecting an existing customer or entering a walk-in customer.
  - **Acceptance:**
    - [ ] Existing-customer search uses synthetic fixtures only.
    - [ ] New customer input stays minimal.
    - [ ] No customer account is required.
    - [ ] No real create-customer request is sent.
  - **Evidence:** Existing and new-customer paths can both be demonstrated locally.

- [ ] **FIT-FE-042 — Add date/time selection prototype**
  - **Depends on:** FIT-FE-040.
  - **Outcome:** Staff can visualize the fitting period without pretending frontend availability is authoritative.
  - **Acceptance:**
    - [ ] Select date.
    - [ ] Select start time.
    - [ ] Show a prototype end time/duration where useful.
    - [ ] Clearly label any duration as prototype/configuration-driven rather than canonical.
    - [ ] Past/invalid local selections are handled gracefully in the mock UI.
    - [ ] Do not display `Available` as an authoritative guarantee from local calculations.
  - **Evidence:** Date/time controls work across desktop/mobile without date shifting.

- [ ] **FIT-FE-043 — Add garment preference/guarantee selection prototype**
  - **Depends on:** FIT-FE-040.
  - **Outcome:** Staff can visualize adding garments to be tried during the fitting.
  - **Acceptance:**
    - [ ] Search/select clothing from synthetic catalogue fixtures.
    - [ ] Allow more than one garment line for visualization.
    - [ ] Each line can be marked/presented as preference-only or guaranteed in the prototype.
    - [ ] Guarantee selection includes a clear message that real asset availability will require backend validation later.
    - [ ] No frontend-only logic claims a physical garment.
  - **Evidence:** Prototype can demonstrate both preference-only and guaranteed-garment intent.

- [ ] **FIT-FE-044 — Add resource assignment prototype**
  - **Depends on:** FIT-FE-040.
  - **Outcome:** Staff can visualize assigning the room/staff/capacity needed by the fitting.
  - **Acceptance:**
    - [ ] Resource options come from local resource fixtures.
    - [ ] Resource kind is visible where useful.
    - [ ] Multiple required resources can be selected when demonstrating room + staff.
    - [ ] Any `available` resource indication is explicitly mock/prototype data.
    - [ ] Do not implement count-then-insert or any browser capacity authority.
  - **Evidence:** UI can demonstrate one-room and room+staff appointment setup.

- [ ] **FIT-FE-045 — Add optional fee/payment section prototype**
  - **Depends on:** FIT-FE-040.
  - **Outcome:** We can evaluate whether fitting fee information belongs in the creation flow.
  - **Acceptance:**
    - [ ] Fee is presented as a mock configured value, not a hard-coded canonical price.
    - [ ] Payment method/evidence controls are not implemented as real payment intake.
    - [ ] A no-fee fitting scenario remains representable.
    - [ ] Money formatting follows existing PHP presentation conventions.
  - **Evidence:** Fee and no-fee fixture modes can be reviewed visually.

- [ ] **FIT-FE-046 — Add review/create prototype state**
  - **Depends on:** FIT-FE-041 through FIT-FE-045.
  - **Outcome:** Staff can review the full fitting intent before a future backend command exists.
  - **Acceptance:**
    - [ ] Review shows customer, period, garments, guarantee labels, resources, and fee if present.
    - [ ] Final CTA is explicitly prototype/local-state behavior during this phase.
    - [ ] Double-click cannot produce duplicate mock records in local state.
    - [ ] Successful local create adds one fitting to the fixture/session view only if that behavior helps visualization.
    - [ ] Refresh is allowed to lose prototype-only local state unless intentionally documented otherwise.
  - **Evidence:** One local creation produces at most one visible mock appointment.

---

# Phase 5: `/fittings/schedule` resource and availability prototype

- [ ] **FIT-FE-050 — Create Fitting Schedule & Availability page shell**
  - **Depends on:** FIT-FE-002.
  - **Outcome:** Fitting configuration/availability has its own focused screen.
  - **Acceptance:**
    - [ ] Route is `/fittings/schedule`.
    - [ ] Clear navigation back to `/fittings` exists.
    - [ ] Page explains that resources determine fitting capacity without exposing database terminology.
    - [ ] Layout separates resources from hours/availability rather than mixing everything into one giant form.
  - **Evidence:** Desktop/mobile browser walkthrough.

- [ ] **FIT-FE-051 — Build fitting resource list**
  - **Depends on:** FIT-FE-050.
  - **Outcome:** Staff can visualize the rooms/staff/capacity slots that make fitting appointments possible.
  - **Acceptance:**
    - [ ] Show resource name.
    - [ ] Show resource kind.
    - [ ] Show active/inactive presentation state.
    - [ ] Include room and staff examples in fixtures.
    - [ ] Include capacity-slot example only if needed to explain capacity N visually.
    - [ ] Avoid a single `Maximum appointments per slot` setting as the primary capacity model.
  - **Evidence:** Resource list demonstrates at least two kinds.

- [ ] **FIT-FE-052 — Add resource create/edit prototype**
  - **Depends on:** FIT-FE-051.
  - **Outcome:** Resource management can be evaluated without persistence.
  - **Acceptance:**
    - [ ] Name field.
    - [ ] Resource kind selector.
    - [ ] Staff association can be visualized when kind is staff.
    - [ ] Active/inactive control is local-state-only.
    - [ ] Submit follows frontend in-flight guard pattern even for local mock mutation.
    - [ ] No network request occurs.
  - **Evidence:** Add/edit updates local prototype state once per intent.

- [ ] **FIT-FE-053 — Build weekly working-hours editor/visualizer**
  - **Depends on:** FIT-FE-051.
  - **Outcome:** The UI can express multiple availability windows per day for a resource.
  - **Acceptance:**
    - [ ] Select one resource to edit/view.
    - [ ] Show Monday–Sunday schedule.
    - [ ] Allow multiple windows in one day in the prototype, e.g. `09:00–12:00` and `13:00–17:00`.
    - [ ] Allow a day to be unavailable.
    - [ ] Validate start < end locally for usability only.
    - [ ] Do not collapse the model into one global business opening-hours value.
    - [ ] Mobile editing remains usable without horizontal page overflow.
  - **Evidence:** Fixture demonstrates split-day hours.

- [ ] **FIT-FE-054 — Visualize breaks and date-specific closures**
  - **Depends on:** FIT-FE-053.
  - **Outcome:** Staff can understand the difference between recurring working hours and a blocked period.
  - **Acceptance:**
    - [ ] Show examples such as lunch break, staff unavailable, room closure, or private event.
    - [ ] Closure includes resource, date/time period, and short reason.
    - [ ] Presentation makes clear that a closure consumes resource availability in the future backend model.
    - [ ] Create/edit/remove actions remain mock/local-state-only.
  - **Evidence:** Weekly hours plus one date-specific closure can be visualized together.

- [ ] **FIT-FE-055 — Build resource availability visualization**
  - **Depends on:** FIT-FE-051, FIT-FE-053, FIT-FE-054.
  - **Outcome:** We can judge whether staff can understand fitting capacity before backend work.
  - **Acceptance:**
    - [ ] Show a bounded date/day view rather than an unbounded calendar.
    - [ ] Distinguish working hours, booked mock appointments, and closures.
    - [ ] Appointment block can open the corresponding mock Fitting Details Sheet where practical.
    - [ ] Overlap/conflict fixtures are visibly called out as prototype scenarios.
    - [ ] UI never claims that local rendering is authoritative capacity enforcement.
    - [ ] Avoid rendering an excessive number of slots/components for large time ranges.
  - **Evidence:** One normal day and one constrained/conflicted day are reviewable.

---

# Phase 6: Cross-page prototype consistency

- [ ] **FIT-FE-060 — Keep fitting fixture identities consistent across screens**
  - **Depends on:** Phases 2–5.
  - **Outcome:** The same mock fitting looks like the same appointment everywhere.
  - **Acceptance:**
    - [ ] `/fittings` row and Details Sheet share the same fixture ID/source.
    - [ ] `/fittings/schedule` appointment block resolves the same fitting fixture.
    - [ ] Customer/garment/resource/status/payment labels do not contradict each other across fitting screens.
    - [ ] No duplicate copy of the same fitting object is manually maintained in multiple components.
  - **Evidence:** Changing one fixture updates all fitting prototype surfaces that derive from it.

- [ ] **FIT-FE-061 — Prevent prototype fittings from becoming V1 Calendar authority**
  - **Depends on:** FIT-FE-060.
  - **Outcome:** Visualizing fittings does not silently expand the V1 Schedule backend scope.
  - **Acceptance:**
    - [ ] Existing Calendar fitting mock cards remain clearly prototype-only or are isolated behind fixture data.
    - [ ] No production Calendar API contract is changed.
    - [ ] `/calendar` does not imply fitting events are real tenant data.
    - [ ] Any future integration point is documented as deferred backend work.
  - **Evidence:** Schedule checklist remains accurate: real fittings are V1.1.

- [ ] **FIT-FE-062 — Prevent prototype fittings from becoming V1 Dashboard authority**
  - **Depends on:** FIT-FE-060.
  - **Outcome:** Dashboard does not count prototype fittings as production metrics.
  - **Acceptance:**
    - [ ] No real Dashboard query/API work is added.
    - [ ] Existing fitting metric mock, if retained visually, is clearly fixture-driven.
    - [ ] Dashboard checklist remains accurate that real fitting metrics are V1.1.
  - **Evidence:** Dashboard production data paths remain unchanged.

- [ ] **FIT-FE-063 — Keep fitting payment presentation separate from Payments production behavior**
  - **Depends on:** FIT-FE-034, FIT-FE-045.
  - **Outcome:** Prototype fitting money does not create fake accounting/payment behavior.
  - **Acceptance:**
    - [ ] No Payments API/client contract is changed.
    - [ ] Fitting fee/payment fixtures remain inside the fitting prototype boundary.
    - [ ] Appointment status never automatically mirrors mock payment status.
  - **Evidence:** Payments production page behavior remains unchanged.

---

# Phase 7: UX, accessibility, responsive behavior, and polish

- [ ] **FIT-FE-070 — Complete responsive fitting pages**
  - **Depends on:** Main page and schedule page implemented.
  - **Outcome:** The prototype can be validated on the mobile sizes common to Drezivo's target users.
  - **Acceptance:**
    - [ ] `/fittings` works at 360px.
    - [ ] `/fittings/schedule` works at 360px.
    - [ ] Table/list content does not require page-level horizontal scrolling when a stacked mobile representation is more usable.
    - [ ] Date/time controls do not overflow mobile sheets/dialogs.
    - [ ] Primary actions remain easy to reach and do not overlap.
    - [ ] Details Sheet remains readable without nested horizontal scrolling.
  - **Evidence:** 360px, tablet, and desktop browser checks.

- [ ] **FIT-FE-071 — Complete keyboard and accessibility pass**
  - **Depends on:** FIT-FE-070.
  - **Outcome:** Fitting prototype is usable without mouse-only behavior.
  - **Acceptance:**
    - [ ] Search/filter/forms have visible labels or appropriate accessible names.
    - [ ] Appointment rows expose an accessible details action.
    - [ ] Sheets/dialogs have title, description, focus management, and close behavior.
    - [ ] Status/attention is not communicated by color alone.
    - [ ] Resource schedule controls are keyboard reachable.
    - [ ] No essential information exists only on hover.
  - **Evidence:** Keyboard-only walkthrough.

- [ ] **FIT-FE-072 — Complete light/dark theme review**
  - **Depends on:** Main visual components complete.
  - **Outcome:** Semantic statuses and schedule blocks remain readable in both themes.
  - **Acceptance:**
    - [ ] Text/background contrast remains clear.
    - [ ] Status badges retain meaning without overly saturated colors.
    - [ ] Selected resource and active filters remain distinguishable.
    - [ ] Schedule working/booked/closed states remain distinguishable with text/icons as needed.
  - **Evidence:** Screenshots/walkthrough in both themes.

- [ ] **FIT-FE-073 — Remove unnecessary text and enterprise complexity**
  - **Depends on:** FIT-FE-072.
  - **Outcome:** Fittings feels appropriate for a small-to-medium clothing rental shop.
  - **Acceptance:**
    - [ ] Main page is operational and scan-first.
    - [ ] Avoid dashboard-within-dashboard layout.
    - [ ] Avoid excessive cards when table/list or grouped sections are clearer.
    - [ ] Avoid exposing ERD terms such as `resource_allocation` or `fitting_line` to staff.
    - [ ] Use rental-business language such as `Room`, `Staff`, `Garments`, `Fitting time`, and `Schedule`.
  - **Evidence:** Final page can be understood without knowledge of the database model.

---

# Phase 8: Prototype review gate before any backend implementation

- [ ] **FIT-FE-080 — Run owner/front-desk workflow review**
  - **Depends on:** Phases 1–7.
  - **Outcome:** We decide whether the proposed staff fitting workflow is understandable before backend scope is committed.
  - **Acceptance:**
    - [ ] Reviewer can find today's/upcoming fittings.
    - [ ] Reviewer can open an appointment and understand customer, garments, resource assignment, fee/payment state, and appointment status.
    - [ ] Reviewer understands preference-only versus guaranteed garment.
    - [ ] Reviewer can visualize creating a fitting.
    - [ ] Reviewer can understand how rooms/staff working hours and closures affect fitting capacity.
    - [ ] Confusing fields/actions are removed rather than justified only by the ERD.
  - **Evidence:** Recorded design feedback or checklist notes.

- [ ] **FIT-FE-081 — Resolve open product decisions exposed by the prototype**
  - **Depends on:** FIT-FE-080.
  - **Outcome:** Backend planning begins only after the UI reveals which fitting rules actually need to exist.
  - **Acceptance:**
    - [ ] Decide exact fitting appointment statuses/transitions.
    - [ ] Decide whether no-show belongs in initial V1.1.
    - [ ] Decide source/default rules for fitting duration.
    - [ ] Decide source/default rules for fitting fee.
    - [ ] Decide whether appointment notes are required and where they belong.
    - [ ] Decide whether V1.1 starts staff-only or includes public customer fitting booking.
    - [ ] Decide whether payment is required before confirmation and under what merchant policy.
    - [ ] Decide cancellation/rejection/refund behavior for fitting fees if payments are included.
    - [ ] Decide what resource kinds are required at launch: room, staff, explicit capacity slot, or a bounded subset.
  - **Evidence:** Decisions are promoted into canonical product/architecture docs before contracts or migrations are written.

- [ ] **FIT-FE-082 — Freeze approved frontend prototype for backend handoff**
  - **Depends on:** FIT-FE-081.
  - **Outcome:** Backend work receives a validated UI/use-case target instead of reverse-engineering old screenshots.
  - **Acceptance:**
    - [ ] Final route hierarchy is approved.
    - [ ] Final list fields are approved.
    - [ ] Final Details Sheet sections are approved.
    - [ ] Final New Fitting inputs are approved.
    - [ ] Final resource/schedule interactions are approved.
    - [ ] Prototype-only labels that should not become wire enums are identified.
    - [ ] Mock fixture shapes are reviewed as presentation needs only, not copied blindly into API contracts.
    - [ ] Backend checklist is created only after these decisions are canonicalized.
  - **Evidence:** Frontend screenshots/browser walkthrough plus accepted product decisions.

---

# Recommended initial mock scenarios

Use a small set of intentionally different fixtures rather than dozens of repetitive rows:

1. **Confirmed fitting — guaranteed garment**
   - One customer.
   - One guaranteed garment with synthetic asset code.
   - Room + staff assigned.
   - No attention state.

2. **Pending review — payment evidence**
   - Fitting fee shown.
   - Payment under review.
   - Appointment status remains separate.

3. **Preference-only fitting**
   - Two garment preferences.
   - No physical asset guarantee.
   - UI clearly says `Preference only`.

4. **Resource attention**
   - Customer and time selected.
   - Missing staff or room assignment.
   - Clearly marked as prototype attention rather than a real detected backend conflict.

5. **Completed fitting**
   - Past appointment.
   - Useful for visualizing history without adding rental-history logic.

6. **Cancelled/rejected/no-show example**
   - Include only the minimum needed to compare terminal-state presentation.
   - Exact lifecycle remains a product decision until FIT-FE-081.

# Frontend completion definition

The fitting frontend prototype is complete when:

- `/fittings` is visually complete using isolated mock data.
- `/fittings/schedule` is visually complete using isolated mock data.
- Fitting Details Sheet communicates customer, appointment, garment guarantee/preference, resources, and optional fee/payment clearly.
- New Fitting can be walked through locally without a network request.
- Resources, split working hours, breaks/closures, and bounded schedule availability can be understood visually.
- The prototype works at 360px and with keyboard navigation.
- No real fitting backend/contract/database behavior has been introduced.
- Existing V1 Calendar/Dashboard/Payments behavior has not been expanded accidentally.
- Open domain decisions discovered through the prototype are documented before backend planning begins.
