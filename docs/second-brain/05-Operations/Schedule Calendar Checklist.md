---
title: Schedule Calendar V1 End-to-End Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, v1, calendar, schedule, operations, checklist]
---

# Schedule Calendar V1 End-to-End Checklist

**Status:** Planned; current `/calendar` Schedule UI, Day Agenda Sheet, and Reservation Details Sheet are prototype/mock-data driven.
**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).
**Dependencies:** [[Reservations Checklist]] and [[Availability Checklist]].

## How to use this checklist

Implement in order. The Schedule Calendar is an operational projection over canonical reservation/custody/readiness data. It must not become a second store of booking state.

Before marking a task complete:

- Calendar reads are derived from authoritative reservation/allocation/custody records.
- Date windows are bounded and timezone-safe.
- Day/week/month views share one projection model instead of implementing inconsistent business logic per view.
- Calendar event clicks resolve the actual reservation/activity source.
- Frontend filters affect presentation/query only; they do not alter domain state.
- Fitting agenda remains V1.1 unless canonical scope is explicitly changed.
- Schedule mutations delegate to Reservation/Availability services, never duplicate them in the calendar module.

## Non-negotiable outcomes

- V1 Schedule answers: “What operational rental work happens on this date?”
- Reservation, pickup, return, overdue/disruption, cleaning/maintenance work may be represented only from canonical sources.
- Pickup/return event time uses booking/custody facts with explicit timezone interpretation.
- Day Agenda Sheet and Reservation Details Sheet show the same records as `/reservations`.
- Clicking a calendar event never opens a separate mock copy of a reservation.
- Event type color is presentation only and remains theme-aware.
- Fitting cards in the current prototype are placeholders for V1.1, not V1 backend commitments.

## Phase 0: Schedule projection definition

- [ ] **SCH-000 — Define canonical V1 schedule event taxonomy**
  - **Depends on:** Reservation lifecycle model finalized.
  - **Outcome:** One documented event taxonomy maps domain records to calendar activities.
  - **Acceptance:**
    - [ ] Define Reservation/booking review event semantics if shown in V1.
    - [ ] Define Pickup event from confirmed reservation pickup deadline/workflow.
    - [ ] Define Return event from due deadline and actual returned state.
    - [ ] Define overdue/disruption/issue projection where operationally useful.
    - [ ] Define maintenance/cleaning operational events only when backed by canonical work/readiness data.
    - [ ] Mark Fitting as V1.1 and keep it out of real V1 query contracts unless scope changes canonically.
  - **Tests/evidence:** Product/architecture review; no conflicting event semantics.

- [ ] **SCH-001 — Define schedule contracts**
  - **Depends on:** SCH-000.
  - **Outcome:** Shared contracts own schedule/day-agenda queries.
  - **Acceptance:**
    - [ ] Define bounded `from`/`to` query with timezone-safe semantics.
    - [ ] Define event summary with source type, source ID, event type, timestamp, clothing/customer-safe display fields, and status projection.
    - [ ] Define daily aggregate counts and optional issue counts.
    - [ ] Define filters for activity type, clothing, and allowed status values.
    - [ ] Reject tenant/branch authority fields from browser input.
  - **Tests/evidence:** Contract validation and bounded-window tests.

## Phase 1: Schedule read service

- [ ] **SCH-010 — Implement bounded schedule projection service**
  - **Depends on:** SCH-001, Reservations read model.
  - **Outcome:** Server returns operational events for a requested calendar range.
  - **Acceptance:**
    - [ ] Resolve tenant/default branch through actor context.
    - [ ] Query only records intersecting requested bounded date range.
    - [ ] Convert stored UTC instants using reservation/branch timezone snapshot for display grouping.
    - [ ] Deduplicate event projection so one domain fact does not appear twice.
    - [ ] Return stable source IDs used for detail navigation.
    - [ ] Keep customer/contact projection minimal and authorized.
  - **Tests/evidence:** Date boundary, timezone, duplicate-source, cross-tenant tests.

- [ ] **SCH-011 — Implement daily agenda query**
  - **Depends on:** SCH-010.
  - **Outcome:** Clicking a day/date or `+ more` can load all operational activities for that local date.
  - **Acceptance:**
    - [ ] Query accepts one local date plus actor context/timezone, not a browser-computed untrusted UTC range alone.
    - [ ] Results are chronological and bounded.
    - [ ] Counts by event type equal the returned/filtered source set.
    - [ ] Day navigation can request previous/next date without reopening unrelated state.
  - **Tests/evidence:** Day boundary/DST/order/count tests.

- [ ] **SCH-012 — Implement schedule aggregate metrics**
  - **Depends on:** SCH-010.
  - **Outcome:** Pickups/Returns/Issues summary cards use real data for the selected range.
  - **Acceptance:**
    - [ ] Metric definition is explicit: period total vs today vs week.
    - [ ] Counts use the same canonical predicates as schedule events.
    - [ ] Fittings metric is removed/hidden for real V1 unless V1.1 is enabled canonically.
  - **Tests/evidence:** Projection/count consistency tests.

## Phase 2: Week view integration

- [ ] **SCH-020 — Replace Week Schedule mock data**
  - **Depends on:** SCH-010, SCH-012.
  - **Outcome:** Current `/calendar` week grid displays real operational events.
  - **Acceptance:**
    - [ ] Previous/next week controls request real bounded ranges.
    - [ ] Week header activity counts come from server projection.
    - [ ] All Activity/Clothing/Status filters query or filter authoritative events consistently.
    - [ ] `+ more` count reflects hidden events for that day.
    - [ ] Loading, empty, partial/error states preserve grid usability.
  - **Tests/evidence:** Component/browser tests with dense seeded week.

- [ ] **SCH-021 — Connect individual event click to Reservation Details Sheet**
  - **Depends on:** SCH-020, Reservations RSV-011.
  - **Outcome:** Clicking a reservation/pickup/return event opens real reservation details.
  - **Acceptance:**
    - [ ] Source reservation ID comes from server event projection.
    - [ ] Details Sheet fetches/reuses the same reservation detail contract as `/reservations`.
    - [ ] Calendar does not maintain a duplicate reservation-detail mock model.
    - [ ] Stale/deleted/foreign source fails safely.
  - **Tests/evidence:** Event-to-reservation identity tests.

- [ ] **SCH-022 — Connect day header and `+ more` to Day Agenda Sheet**
  - **Depends on:** SCH-011, SCH-020.
  - **Outcome:** Current approved Day Agenda Sheet shows all real day activities.
  - **Acceptance:**
    - [ ] Day/date header and `+ more` open same day source.
    - [ ] Activity type tabs use real counts.
    - [ ] `View details` opens authoritative Reservation Details Sheet.
    - [ ] Previous/next day navigation preserves calendar context.
    - [ ] Sheet remains responsive/full-width enough on mobile.
  - **Tests/evidence:** Header/more/filter/navigation/detail transition tests.

## Phase 3: Month and Day views

- [ ] **SCH-030 — Implement Month projection UI from same service**
  - **Depends on:** SCH-010, SCH-011.
  - **Outcome:** Month view summarizes daily activity without creating a new backend truth source.
  - **Acceptance:**
    - [ ] Month query is bounded to visible grid plus explicit spillover days only.
    - [ ] Cells show a small bounded preview plus `+N more`.
    - [ ] Clicking cell/date opens Day Agenda Sheet.
    - [ ] Dense days do not render hundreds of DOM event cards.
  - **Tests/evidence:** Dense-month rendering and day drill-down tests.

- [ ] **SCH-031 — Implement Day timeline view from daily agenda service**
  - **Depends on:** SCH-011.
  - **Outcome:** Day mode presents chronological operations with no duplicate query logic.
  - **Acceptance:**
    - [ ] Reuses daily agenda contract and event components where practical.
    - [ ] Timezone/time labels match Week and Day Agenda Sheet.
    - [ ] Event click opens same detail source.
  - **Tests/evidence:** Week/Day consistency tests.

## Phase 4: Operational actions from calendar

- [ ] **SCH-040 — Wire allowed reservation actions through domain services**
  - **Depends on:** Reservations mutation phases.
  - **Outcome:** Calendar surfaces can trigger allowed pickup/return/etc. without implementing calendar-specific business writes.
  - **Acceptance:**
    - [ ] Reservation Details Sheet calls Reservation API commands only.
    - [ ] Shared pending/idempotency guard used for mutations.
    - [ ] Success refetches schedule, reservations, dashboard, and affected availability projections.
    - [ ] Stale/conflict state prompts refresh rather than optimistic authority override.
  - **Tests/evidence:** Calendar-triggered mutation integration tests.

- [ ] **SCH-041 — Surface disruption/overdue operational cues**
  - **Depends on:** Reservations RSV-051/052.
  - **Outcome:** Schedule makes late/unready issues visible without altering underlying reservation facts.
  - **Acceptance:**
    - [ ] Overdue/due-soon rules are documented and derived from canonical dates/custody state.
    - [ ] Threatened next booking links to disruption/reservation context.
    - [ ] Actual return remains recordable even when late.
  - **Tests/evidence:** Late return/disruption projection tests.

## Phase 5: Mobile, accessibility, and performance

- [ ] **SCH-050 — Complete responsive calendar behavior**
  - **Depends on:** SCH-020 through SCH-031.
  - **Outcome:** Calendar remains usable at 360px without requiring desktop-only hover behavior.
  - **Acceptance:**
    - [ ] Day/date, event, and `+ more` targets are keyboard and touch accessible.
    - [ ] Horizontal scroll has clear context and does not trap page navigation.
    - [ ] Sheets provide accessible titles/descriptions/focus handling.
    - [ ] No essential action depends on hover.
  - **Tests/evidence:** Keyboard/mobile browser walkthrough.

- [ ] **SCH-051 — Validate schedule query/render scale**
  - **Depends on:** SCH-010, SCH-030.
  - **Outcome:** Dense operational periods remain fast and bounded.
  - **Acceptance:**
    - [ ] Calendar APIs enforce max range/row bounds.
    - [ ] Month/week views cap preview payload and use day drill-down for dense data.
    - [ ] Queries use reservation date/status indexes.
    - [ ] UI avoids rendering hidden full-day datasets until requested.
  - **Tests/evidence:** Representative load and render measurements.

## Phase 6: Completion evidence

- [ ] **SCH-060 — Complete schedule isolation and consistency tests**
  - **Depends on:** All Schedule API tasks.
  - **Outcome:** Calendar cannot leak data or disagree with Reservations.
  - **Acceptance:**
    - [ ] Foreign tenant events never appear.
    - [ ] Missing actor context fails closed.
    - [ ] Schedule event source resolves to same reservation snapshot/status as `/reservations`.
    - [ ] Counts remain consistent after create/reschedule/cancel/pickup/return.
  - **Tests/evidence:** API/RLS/cross-surface integration suite.

- [ ] **SCH-061 — Mark Schedule Calendar vertical slice complete**
  - **Depends on:** SCH-050, SCH-051, SCH-060.
  - **Outcome:** Schedule is a real operational projection of Drezivo rental state.
  - **Acceptance:**
    - [ ] Week + Day Agenda + Reservation Details use real API data.
    - [ ] Month/Day modes use same canonical projection when enabled.
    - [ ] No production mock agenda data remains.
    - [ ] Calendar and Reservations stay consistent after mutations.
    - [ ] Docs/checklist reflect implemented behavior.
  - **Tests/evidence:** API/app/e2e suites, typecheck, lint, build, browser walkthrough.

## Deferred from Schedule V1

- Real fitting appointments/resources/capacity and Fitting agenda events — V1.1.
- Drag-and-drop rescheduling unless it can preserve the full atomic reschedule contract.
- Multi-branch calendars — V2.
- Predictive workload/analytics.
