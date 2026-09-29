---
title: Rental Calendar End-to-End Implementation Checklist
type: implementation-checklist
status: in-progress
owner: Drezivo team
updated: 2026-09-29
tags: [drezivo, calendar, schedule, reservations, fittings, operations, checklist]
---

# Rental Calendar End-to-End Implementation Checklist

**Status:** Backend Calendar projection and its PostgreSQL verification gate are complete. FE-0 through FE-4 now resolve the active branch context, render Week/Month from the production Calendar endpoint, provide real period summaries and filters, and show the live branch-local Day Agenda. Shared detail sheets and the final frontend test/release gate remain open. No backend checklist item is complete until the required PostgreSQL evidence passes; existing implementation code alone is not sufficient evidence.

**Implementation order:** **Backend first → frontend API client → existing Calendar UI wiring → shared detail sheets → tests/release gate.**

**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), [ERD](../../architecture/Drezivo-ERD.dbml), [[Reservations Checklist]], [[Fittings Implementation Checklist]], and [[Availability Checklist]].

## Goal

The Rental Calendar must be one read-only operational projection over authoritative Reservation and Fitting records.

For every selected Calendar range, it must show:

- every eligible Reservation **Pickup** at its canonical `pickup_at`;
- every eligible Reservation **Return** at its canonical `due_at`;
- every eligible persisted **Fitting** over its canonical appointment period;
- the same reservation/fitting status and source identity used by their owning modules;
- the same source record when staff opens details from Calendar.

The Calendar must **not** store or invent a second copy of reservation, fitting, customer, clothing, payment, custody, or availability state.

## Evidence boundary before implementation

The repository already contains useful production evidence, but it does not close this checklist. Extend and rerun the existing operations integration suites before checking any backend item:

- `api/tests/integration/fittings-phase8-integrations.test.ts` covers the current mixed Reservation/Fitting Calendar projection foundation.
- `api/tests/integration/fittings-phase9-load-query-plan.test.ts` covers representative fitting load and query-plan behavior.
- [[Fittings Implementation Checklist]] records the passed FIT-BE-080/BE-8 and BE-9 security, isolation, observability, and load evidence; Calendar-specific state, truncation, bounded reservation-line aggregation, and frontend cutover evidence remain open here.
- `TEST_DATABASE_URL` is required for the PostgreSQL evidence gate. Existing code, unit tests, or a successful build must not be treated as a substitute.

## Source-of-truth map

```text
Reservation
  pickup_at ───────────────► Calendar Pickup event
  due_at ──────────────────► Calendar Return event
  status/customer/lines ───► Calendar display projection
  id ──────────────────────► Reservation Details Sheet

Fitting Appointment
  period.start/end ─────────► Calendar Fitting event
  status/customer/lines ────► Calendar display projection
  id ──────────────────────► Fitting Details Sheet

Calendar
  stores no booking state
  performs no calendar-specific booking mutation
```

## Calendar visibility rules

The Calendar projection keeps the owning module's state machine and does not invent a Calendar-specific status. The current inclusion rules are:

- Reservations emit Pickup and Return events only for `pending_confirmation`, `confirmed`, `picked_up`, `returned`, and `completed` records.
- Reservation `held`, `cancelled`, `expired`, and `rejected` records are excluded from the operational projection.
- Fittings emit events only for `pending`, `confirmed`, `completed`, and `no_show` appointments.
- Fitting `cancelled` and `rejected` appointments are excluded. Hidden capacity slots and other non-customer appointments are never exposed.
- Returned and completed historical records remain visible when their authoritative event instant is inside the requested range.
- Pickup and Return event starts are authoritative `pickup_at` and `due_at` instants. Their 30-minute end periods are synthetic display windows only; they do not represent a stored custody duration or change the source record.

These rules must be covered by the backend integration evidence before any Calendar checklist item is marked complete.

## Non-negotiable rules

- Tenant and active branch come from authenticated actor context, never browser-supplied authority fields.
- Calendar range queries are bounded. The backend accepts validated UTC instants; the frontend derives Week, Month, and day boundaries from the active branch timezone before calling the endpoint.
- Week, Month, and Day Agenda use the same event projection; no separate business logic per view.
- Pickup is derived from Reservation `pickup_at`; Return is derived from Reservation `due_at`.
- Fitting is derived from persisted `fitting_appointment.period`; FIT-BE-080 makes those persisted appointments production-authoritative. FE-1 has removed prototype fitting data from the production Schedule UI.
- Calendar event `source_id` must resolve to the same Reservation/Fitting record shown on its owning page.
- Calendar actions delegate to Reservation/Fitting command APIs and refetch authoritative state after success.
- No production Calendar card may display fabricated customer contact data, prices, statuses, or timelines.
- Clothing Availability remains a separate projection at `GET /api/v1/calendar/availability` and is not duplicated here.
- The current hard-coded **Issues** count is hidden and deferred. This slice adds no issue/disruption table or endpoint; it must remain absent until a canonical definition and source identity are approved.

---

# Backend Phase BE-0 — Freeze Calendar contracts and source semantics

- [x] **CAL-BE-000 — Confirm the production Calendar event taxonomy**
  - **Outcome:** One explicit mapping exists from owning modules to Calendar events.
  - **Acceptance:**
    - [x] Reservation `pickup_at` produces exactly one `pickup` event for an eligible reservation.
    - [x] Reservation `due_at` produces exactly one `return` event for an eligible reservation.
    - [x] Fitting `period` produces exactly one `fitting` event for an eligible appointment.
    - [x] Reservation inclusion is limited to `pending_confirmation`, `confirmed`, `picked_up`, `returned`, and `completed`; `held`, `cancelled`, `expired`, and `rejected` are excluded.
    - [x] Fitting inclusion is limited to `pending`, `confirmed`, `completed`, and `no_show`; `cancelled` and `rejected` are excluded.
    - [x] Pickup and Return start at authoritative `pickup_at` and `due_at`; any 30-minute end period is display-only.
    - [x] Returned/completed historical events remain visible when their event instant falls inside the requested range.
    - [x] Calendar event color/type is presentation only and is not persisted domain state.
  - **Evidence:** `contracts/tests/operations.test.ts` and `api/tests/integration/fittings-phase8-integrations.test.ts` validate the source-specific status sets, exact instants, synthetic display periods, historical states, and duplicate-free event identity.

- [x] **CAL-BE-001 — Confirm the bounded operational Calendar contract**
  - **Outcome:** `@drezivo/contracts` fully owns the Schedule read contract.
  - **Acceptance:**
    - [x] Query accepts required `start` and `end` ISO instants.
    - [x] Query rejects `start >= end`.
    - [x] Query enforces the approved maximum window.
    - [x] Response returns a stable event `id`, `source`, `source_id`, `event_type`, `branch_id`, `period`, customer display name, item names, category IDs, source status, and tenant category facets.
    - [x] Reservation and Fitting event shapes remain discriminated so status types cannot be mixed accidentally.
    - [x] Dense ranges expose explicit `truncated` metadata; the response never silently presents a partial range as complete.
    - [x] Browser input cannot supply `tenant_id`, authoritative `branch_id`, customer identity, or event state.
  - **Evidence:** `contracts/src/operations/calendar.ts` owns the strict 62-day query and response schemas; `contracts/tests/operations.test.ts` covers valid events, cross-source status rejection, unknown authority fields, offset-bearing instants, range bounds, and truncation metadata.

---

# Backend Phase BE-1 — Reservation pickup and return projection

- [x] **CAL-BE-010 — Verify all eligible Reservation pickup dates are projected**
  - **Depends on:** CAL-BE-000, CAL-BE-001.
  - **Outcome:** Calendar can show every pickup inside the requested range without querying the Reservations UI separately.
  - **Acceptance:**
    - [x] Query is tenant scoped.
    - [x] Query is active-branch scoped.
    - [x] `pickup_at >= start AND pickup_at < end` defines event inclusion.
    - [x] Event period starts at `pickup_at`; the synthetic 30-minute display end is not a custody fact.
    - [x] Event `source = reservation`.
    - [x] Event `source_id` equals the authoritative reservation ID.
    - [x] Customer display name comes from the linked customer/snapshot policy already used by Reservations.
    - [x] Item names come from authoritative reservation lines.
    - [x] One reservation cannot emit duplicate pickup events for the same Calendar projection.
  - **Existing foundation:** `readOperationalCalendarEvents()` already projects Reservation pickup events from `reservation.pickup_at`.

- [x] **CAL-BE-011 — Verify all eligible Reservation return dates are projected**
  - **Depends on:** CAL-BE-010.
  - **Outcome:** Calendar can show every scheduled return inside the requested range.
  - **Acceptance:**
    - [x] `due_at >= start AND due_at < end` defines scheduled Return inclusion.
    - [x] Event period starts at `due_at`; the synthetic 30-minute display end is not a custody fact.
    - [x] Event `source = reservation`.
    - [x] Event `source_id` equals the same Reservation source used by Pickup.
    - [x] Return projection does not fabricate a second reservation or allocation record.
    - [x] Actual late/early return custody facts do not rewrite the historical scheduled due instant in this projection.
    - [x] Returned/completed reservations still show their scheduled Return when that due instant is in range.
  - **Existing foundation:** `readOperationalCalendarEvents()` already projects Reservation return events from `reservation.due_at`.

- [x] **CAL-BE-012 — Prove Reservation Calendar identity matches `/reservations`**
  - **Depends on:** CAL-BE-010, CAL-BE-011.
  - **Outcome:** Calendar never disagrees with Reservation detail for the same source.
  - **Acceptance:**
    - [x] Pickup/Return `source_id` can be fetched through `GET /api/v1/reservations/:reservationId`.
    - [x] Calendar status equals the authoritative reservation status at read time.
    - [x] Calendar customer/item summaries correspond to the same accepted reservation snapshot/lines.
    - [x] Foreign-tenant and foreign-branch reservation IDs remain concealed.
  - **Tests/evidence:** `fittings-phase8-integrations.test.ts` (5 passed) and `reservation-list-read-model.test.ts` (7 passed) against the disposable PostgreSQL database.

---

# Backend Phase BE-2 — Fitting schedule projection

- [x] **CAL-BE-020 — Verify persisted Fitting appointments are projected**
  - **Depends on:** CAL-BE-000, CAL-BE-001, Fittings backend production gate.
  - **Outcome:** Calendar consumes the Fittings module directly instead of Calendar prototype fixtures.
  - **Acceptance:**
    - [x] Query reads persisted `fitting_appointment` rows only.
    - [x] Appointment inclusion uses overlap with the requested Calendar window.
    - [x] Event `source = fitting`.
    - [x] Event `source_id` equals the authoritative fitting ID.
    - [x] Event period uses the stored fitting appointment start/end exactly.
    - [x] Customer display name comes from the linked production customer.
    - [x] Item names come from active fitting lines.
    - [x] Hidden fitting capacity slots are never exposed to Calendar.
    - [x] No duplicate Calendar fitting store/table is introduced.
  - **Existing foundation:** FIT-BE-080 is implemented and `readOperationalCalendarEvents()` projects persisted fittings. Those persisted rows are the production authority; FE-1 removed prototype fitting data from the Calendar UI.

- [x] **CAL-BE-021 — Prove Fitting Calendar identity matches `/fittings`**
  - **Depends on:** CAL-BE-020.
  - **Outcome:** Clicking a Calendar fitting resolves the same production appointment as `/fittings`.
  - **Acceptance:**
    - [x] `source_id` can be fetched through `GET /api/v1/fittings/:id`.
    - [x] Calendar fitting status equals the authoritative fitting status at read time.
    - [x] Garment summary corresponds to active fitting lines.
    - [x] Preference-only fitting garments are display data only and do not imply physical allocation.
    - [x] Guaranteed fitting asset identities remain inside the Fitting detail contract, not Calendar event summaries.
  - **Tests/evidence:** `fittings-phase8-integrations.test.ts` (7 passed) against the disposable PostgreSQL database; the test covers eligible/terminal fitting states, exact periods, source identity, production detail alignment, and preference-only lines.

---

# Backend Phase BE-3 — Range, timezone, ordering, and scale hardening

- [x] **CAL-BE-030 — Prove active-branch timezone range construction**
  - **Outcome:** Week/month/day boundaries include the correct business-local events.
  - **Acceptance:**
    - [x] Backend accepts only validated UTC `start/end` instants, enforces the approved window, and never treats a client-supplied timezone as authority.
    - [x] Frontend obtains the active branch IANA timezone from actor context and converts local Week/Month/day boundaries to UTC instants before calling Calendar.
    - [x] Tests cover Asia/Manila and at least one DST-observing timezone at the API boundary.
    - [x] Events around local midnight are grouped into the expected branch-local business date by the frontend mapper.
  - **Evidence:** `contracts/tests/operations.test.ts` validates Asia/Manila and America/New_York offset-bearing instants; `app/src/components/calendar/calendar-schedule-data.ts` resolves branch-local boundaries and event dates, and the schedule page obtains the active branch timezone from actor context.

- [x] **CAL-BE-031 — Verify deterministic event ordering and deduplication**
  - **Acceptance:**
    - [x] Results order by event start then stable tie-breakers.
    - [x] One Reservation may legitimately produce Pickup + Return, but never two identical Pickup or two identical Return events.
    - [x] One Fitting produces one fitting event.
    - [x] Concurrent unrelated inserts do not make ordering unstable for equal timestamps.

- [x] **CAL-BE-032 — Harden dense-range result limits**
  - **Outcome:** Calendar never silently presents an incomplete month/week as complete.
  - **Acceptance:**
    - [x] Representative supported tenant scale is tested against the current event cap.
    - [x] The repository queries up to 2,001 ordered rows (`2000 + 1`) and returns at most 2,000 events.
    - [x] The response exposes `truncated: boolean`, set only when the extra row exists; no dense range is silently presented as complete.
    - [x] The frontend visibly warns or otherwise prevents a truncated range from appearing complete.
    - [x] Week and 42-day visible Month-grid windows remain supported within the server range limit.
    - [x] Reservation line aggregation is bounded to the candidate reservations that survive tenant, branch, status, and date filtering; all tenant reservation lines are not scanned before the bounded event page is selected.
    - [x] Queries use relevant reservation/fitting tenant/branch/time indexes.
  - **Tests/evidence:** `fittings-phase9-load-query-plan.test.ts` proves a 3,000-appointment range returns 2,000 events with `truncated: true`; the schedule page shows a visible warning whenever the API marks the response truncated.

- [x] **CAL-BE-033 — Verify Calendar authorization and isolation**
  - **Acceptance:**
    - [x] Staff authentication is required.
    - [x] Tenant context is required.
    - [x] Existing rental read policy is applied.
    - [x] `reservations.manage` operational permission is required.
    - [x] Missing actor context fails closed.
    - [x] Cross-tenant Calendar reads return no foreign events.
    - [x] Active branch cannot read another branch's schedule.
  - **Tests/evidence:** `fittings-phase8-integrations.test.ts` covers permission failure, tenant isolation, branch isolation, and deterministic ordering; route middleware supplies staff/tenant/lifecycle enforcement.

---

# Backend Phase BE-4 — API verification and release gate

- [x] **CAL-BE-040 — Complete Calendar contract tests**
  - **Acceptance:**
    - [x] Valid Reservation Pickup event parses.
    - [x] Valid Reservation Return event parses.
    - [x] Valid Fitting event parses.
    - [x] Reservation status cannot be used in a Fitting event shape and vice versa.
    - [x] More-than-max range fails validation.
    - [x] Unknown/authority fields are rejected.
  - **Evidence:** `contracts/tests/operations.test.ts` passes with the full contracts suite (150 tests).

- [x] **CAL-BE-041 — Complete PostgreSQL Calendar integration tests**
  - **Acceptance:**
    - [x] Seed one reservation and prove both Pickup and Return appear at the expected instants.
    - [x] Seed one fitting and prove its exact appointment period appears.
    - [x] Mixed Reservation + Fitting window returns all three expected event kinds.
    - [x] Reservation states `pending_confirmation`, `confirmed`, `picked_up`, `returned`, and `completed` follow CAL-BE-000 inclusion rules; `held`, `cancelled`, `expired`, and `rejected` do not appear.
    - [x] Fitting states `pending`, `confirmed`, `completed`, and `no_show` follow CAL-BE-000 inclusion rules; `cancelled` and `rejected` do not appear.
    - [x] Pickup and Return begin at `pickup_at` and `due_at`, with only a synthetic 30-minute display period.
    - [x] Tenant/branch isolation is falsified with at least two workspaces/branches.
    - [x] Midnight/timezone boundary coverage passes.
    - [x] Dense-range behavior from CAL-BE-032 is covered, including the 2,001-row probe, 2,000-row cap, and `truncated` flag.
    - [x] Reservation line aggregation is bounded to date-filtered candidate reservations and does not scan all tenant lines first.
  - **Evidence references:** `api/tests/integration/fittings-phase8-integrations.test.ts` (10 passing tests) covers the mixed projection, all eligible/terminal states, exact periods, identity, tenant/branch isolation, ordering, and a branch-local midnight boundary. `api/tests/integration/fittings-phase9-load-query-plan.test.ts` (1 passing test) covers 3,000 fitting appointments, the 2,001-row probe, 2,000-row cap, truncation, and intended indexes. The focused Calendar gate passed 11/11 against the disposable PostgreSQL database.

- [x] **CAL-BE-042 — Mark backend Calendar projection ready for frontend cutover**
  - **Depends on:** CAL-BE-010 through CAL-BE-041.
  - **Acceptance:**
    - [x] `GET /api/v1/calendar` is the one Schedule event read endpoint.
    - [x] Reservation Pickup and Return are authoritative.
    - [x] Fitting schedule is authoritative.
    - [x] OpenAPI matches implemented contracts/routes.
    - [x] No backend work is required to fabricate UI-only Calendar records.
  - **Evidence:** API typecheck, lint, build, unit tests (90 passing), focused Calendar PostgreSQL integration (11 passing), contracts typecheck/tests (150 passing), and `git diff --check` passed. Full-suite integration remains subject to the pre-existing catalogue-scale timeout cascade; no Calendar-specific failure was observed. The frontend timezone and truncation-warning boundaries under CAL-BE-030/CAL-BE-032 were completed in FE-1/FE-2.

---

# Frontend Phase FE-0 — Add the production Calendar API client

- [x] **CAL-FE-000 — Add `getOperationalCalendar()` to `app/src/lib/drezivo-api.ts`**
  - **Depends on:** CAL-BE-042.
  - **Outcome:** The app consumes the shared Calendar contract instead of handwritten response types.
  - **Acceptance:**
    - [x] Import `operationalCalendarQuery` and `operationalCalendarResponse` from `@drezivo/contracts`.
    - [x] Serialize validated `start` and `end` query parameters.
    - [x] Validate the API envelope/response through the shared contract.
    - [x] Preserve the response `truncated` flag so the UI can warn or prevent a dense range from appearing complete.
    - [x] Add focused API-client unit coverage.
  - **Evidence:** `app/src/lib/drezivo-api.ts` exposes the typed Calendar read method; `app/tests/unit/drezivo-api-calendar.test.ts` covers query serialization, envelope validation, and `truncated` preservation (2 passing tests). App typecheck and `git diff --check` passed.

- [x] **CAL-FE-001 — Resolve active branch timezone and permissions**
  - **Acceptance:**
    - [x] Calendar uses `GET /api/v1/actor-context` like other authenticated operational pages.
    - [x] Active branch timezone is the display/range basis.
    - [x] Browser timezone is fallback presentation only while context is unavailable; it is not business authority.
    - [x] Permission-restricted state is explicit.

---

# Frontend Phase FE-1 — Replace Calendar prototype data

- [x] **CAL-FE-010 — Create one production Calendar presentation mapper**
  - **Depends on:** CAL-FE-000, CAL-FE-001.
  - **Outcome:** Week, Month, Day Agenda, cards, and filters share one mapped event model.
  - **Acceptance:**
    - [x] Map `pickup` → Pickup.
    - [x] Map `return` → Return.
    - [x] Map `fitting` → Fitting.
    - [x] Preserve `source`, `source_id`, status, customer name, item names, and exact event period.
    - [x] Derive event duration from `period.start/end`; do not restrict real fittings to only 30/60 minutes.
    - [x] Derive branch-local `dateKey` from the event start instant.
  - **Implementation:** `app/src/components/calendar/calendar-schedule-data.ts` is the shared mapper used by Week, Month, and the live day agenda.

- [x] **CAL-FE-011 — Remove `CALENDAR_ACTIVITIES` as production authority**
  - **Acceptance:**
    - [x] Delete production dependence on `CALENDAR_MOCK_TODAY`.
    - [x] Delete production dependence on fixed September 2026 dates.
    - [x] Remove fake Calendar reservation/customer/contact/payment data.
    - [x] Remove `Fitting · Prototype`, `Prototype fitting activity`, and mock-only fitting copy during the same controlled cutover.
    - [x] Keep only reusable visual constants/helpers in `calendar-schedule-data.ts`, or replace the file entirely if no longer needed.
  - **Implementation:** `app/src/components/calendar/calendar-schedule-page.tsx` now loads the authenticated API projection and contains no prototype reservation/fitting detail data.

---

# Frontend Phase FE-2 — Wire Week and Month views

- [x] **CAL-FE-020 — Wire Week Schedule to the production Calendar endpoint**
  - **Acceptance:**
    - [x] Visible Monday–Sunday branch-local range becomes the API query range.
    - [x] Previous/next Week refetches that bounded range.
    - [x] `Today` jumps to the actual branch-local current week.
    - [x] Day header activity counts derive from the current production events.
    - [x] Existing side-by-side overlap layout remains functional for dense simultaneous activity.
    - [x] Events outside the normal visual-hour window are not silently lost.
    - [x] A truncated response is visibly marked and is never presented as a complete week.

- [x] **CAL-FE-021 — Wire Month view to the same production projection**
  - **Acceptance:**
    - [x] Query covers only the visible Month grid including explicit spillover cells.
    - [x] A six-week grid fits within the backend range limit.
    - [x] Each day cell previews a bounded number of activities.
    - [x] `+N more` reflects the production event set for that day.
    - [x] Month never uses a second mock or alternate Calendar source.
    - [x] A truncated response is visibly marked and does not imply that the six-week grid is complete.
  - **Implementation:** App typecheck passed. Calendar unit tests have not been run; the existing prototype assertions are expected to be replaced during CAL-FE-070.

---

# Frontend Phase FE-3 — Summary cards and filters

- [x] **CAL-FE-030 — Wire real period summary cards**
  - **Acceptance:**
    - [x] Pickups count = visible-range `pickup` events.
    - [x] Returns count = visible-range `return` events.
    - [x] Fittings count = visible-range `fitting` events.
    - [x] Loading does not display fake authoritative zeroes.
    - [x] Remove/hide the hard-coded `Issues = 3` until an approved issue projection exists.
  - **Evidence:** `CalendarSummaryCards` counts the loaded production events by `eventType` and is rendered only after a successful range response; loading, forbidden, and error states do not show authoritative-looking zeroes. UI behavior tests remain scheduled for CAL-FE-070.

- [x] **CAL-FE-031 — Wire Activity filter**
  - **Acceptance:**
    - [x] `All Activity`, `Pickup`, `Return`, and `Fitting` operate on authoritative events.
    - [x] Filtering does not mutate backend/domain state.
    - [x] Day/Week/Month use consistent filtering semantics.
  - **Evidence:** The global activity filter selects from the shared mapped response for Week/Month and the same day-scoped source list for Day Agenda; day tabs update the shared selection.

- [x] **CAL-FE-032 — Wire Category filter**
  - **Acceptance:**
    - [x] Category options come from tenant-scoped Calendar facets, not one dropdown entry per garment.
    - [x] Filtering matches event `category_ids`; a reservation/fitting with items in multiple categories remains visible when any line belongs to the selected category.
    - [x] Category names, IDs, and active/inactive status are authoritative API data; no category values are inferred from item names.
    - [x] Category filtering uses the Calendar permission boundary and does not require a separate catalogue request.
  - **Evidence:** `GET /api/v1/calendar` returns tenant category facets and category IDs for reservation/fitting event lines. The app selects by category ID and filters events by membership in that ID list, avoiding up to 200 product-name options. App typecheck passed; UI interaction tests remain scheduled for CAL-FE-070.

- [x] **CAL-FE-033 — Wire Status filter**
  - **Acceptance:**
    - [x] Filter supports the authoritative Reservation/Fitting states represented in the Calendar response.
    - [x] Human-friendly labels may group states, but raw domain states remain unchanged.
    - [x] Reservation state is never applied to a Fitting as if the state machines were identical.
  - **Evidence:** Status options are derived from returned events, keyed by `source:status`, and labeled with their owning source; filtering compares both source and raw status.

---

# Frontend Phase FE-4 — Real Day Agenda

- [x] **CAL-FE-040 — Replace `CALENDAR_DAY_AGENDA` mock data**
  - **Outcome:** Clicking a date opens the authoritative activities for that branch-local day.
  - **Acceptance:**
    - [x] Group loaded events by branch-local `dateKey`.
    - [x] Agenda items are chronological.
    - [x] `All/Pickup/Return/Fitting` tab counts come from the real day event set after current clothing/status filters.
    - [x] Day header and Month `+N more` open the same Day Agenda source.
    - [x] Previous/next day navigation preserves Calendar context and fetches a new range only when needed.
    - [x] Empty day state is explicit.
  - **Evidence:** `DayAgendaSheet` renders chronologically sorted production events, count-bearing All/Pickup/Return/Fitting tabs, explicit loading/error/empty/filtered-empty states, and previous/next controls. Navigation reuses the loaded range for visible dates and shifts the existing Week/Month range only when crossing its boundary. App typecheck passed; UI interaction tests remain scheduled for CAL-FE-070.

---

# Frontend Phase FE-5 — Authoritative Reservation and Fitting details

- [ ] **CAL-FE-050 — Reuse the production Reservation Details Sheet**
  - **Depends on:** CAL-FE-010, Reservations production detail API.
  - **Outcome:** Calendar Reservation events open the same source/detail used by `/reservations`.
  - **Acceptance:**
    - [ ] Reservation event click uses `source_id`.
    - [ ] Fetch through existing `getReservationDetail()`.
    - [ ] Reuse `app/src/components/reservations/reservation-details-sheet.tsx`.
    - [ ] Delete Calendar's fabricated `reservationDetailsFor()` implementation.
    - [ ] No fake phone/email/price/status timeline remains.
    - [ ] Reservation mutations use existing Reservation commands and shared submit/idempotency guards.
    - [ ] Successful mutation refetches Calendar and detail state.

- [ ] **CAL-FE-051 — Extract and reuse the production Fitting Details Sheet**
  - **Depends on:** CAL-FE-010, Fittings production detail API.
  - **Outcome:** Calendar Fitting events open the same appointment used by `/fittings`.
  - **Acceptance:**
    - [ ] Extract the current production Fitting Details Sheet from `fittings-page.tsx` into a reusable component.
    - [ ] `/fittings` continues using the extracted component without behavior regression.
    - [ ] Calendar fitting event click uses `source_id` and existing `getFittingDetail()`.
    - [ ] Existing confirm/reject/cancel/complete/no-show/reschedule behavior remains delegated to Fittings APIs.
    - [ ] Prototype fitting detail code is removed from Calendar.
    - [ ] Successful mutation refetches Calendar and Fitting detail state.

---

# Frontend Phase FE-6 — Loading, empty, error, accessibility, and responsive states

- [ ] **CAL-FE-060 — Add production loading/error/empty states**
  - **Acceptance:**
    - [ ] Initial loading state preserves the Calendar layout where practical.
    - [ ] Range refetch state does not flash fake old-period counts as new-period authority.
    - [ ] Empty period clearly states there are no scheduled activities.
    - [ ] Empty filtered state differs from truly empty Calendar data.
    - [ ] API errors provide retry.
    - [ ] `403` explains restricted Calendar access.
    - [ ] Detail-loading/detail-error states are handled by the shared detail components.

- [ ] **CAL-FE-061 — Preserve responsive and accessible Calendar behavior**
  - **Acceptance:**
    - [ ] Week grid horizontal scroll remains understandable on narrow screens.
    - [ ] Day headers, event cards, filters, and `+N more` are keyboard/touch accessible.
    - [ ] No essential action depends only on hover.
    - [ ] Sheets have accessible titles/descriptions and expected focus behavior.
    - [ ] Semantic Pickup/Return/Fitting colors maintain dark/light theme contrast.

---

# Frontend Phase FE-7 — Tests and production cutover

- [ ] **CAL-FE-070 — Replace prototype Calendar unit tests with API-backed behavior tests**
  - **Acceptance:**
    - [ ] Actor-context timezone resolution.
    - [ ] Week query boundaries.
    - [ ] Month visible-grid query boundaries.
    - [ ] Previous/next navigation refetch.
    - [ ] Pickup/Return/Fitting event mapping.
    - [ ] Branch-local Today behavior.
    - [ ] Activity/Clothing/Status filters.
    - [ ] Day Agenda counts/filtering/navigation.
    - [ ] Month `+N more` drill-down.
    - [ ] Overlap layout with real-period durations.
    - [ ] Reservation event → `getReservationDetail()` identity.
    - [ ] Fitting event → `getFittingDetail()` identity.
    - [ ] Mutation success → Calendar refetch.
    - [ ] Loading/empty/error/403 states.
    - [ ] No tests assert prototype-only Calendar labels or fake reservation numbers.

- [ ] **CAL-FE-071 — Complete authenticated browser verification**
  - **Acceptance:**
    - [ ] Desktop Week view with seeded Pickup/Return/Fitting data.
    - [ ] Desktop Month view with dense day overflow.
    - [ ] Day Agenda drill-down.
    - [ ] Reservation detail/action from Calendar.
    - [ ] Fitting detail/action from Calendar.
    - [ ] 360px usability.
    - [ ] Keyboard walkthrough.
    - [ ] Light and dark theme review.

- [x] **CAL-FE-072 — Remove all Schedule prototype production paths**
  - **Acceptance:**
    - [x] No `CALENDAR_ACTIVITIES` production dependency remains.
    - [x] No fixed September 2026 Calendar authority remains.
    - [x] No prototype fitting labels remain.
    - [x] No fabricated Reservation Details Sheet remains inside Calendar.
    - [x] No hard-coded Issues count remains.

---

# Completion Gate

- [ ] **CAL-REL-000 — Mark Rental Calendar end-to-end slice complete**
  - **Depends on:** CAL-BE-042 and CAL-FE-072.
  - **Acceptance:**
    - [ ] Every eligible Reservation Pickup in the selected range appears at its authoritative `pickup_at`.
    - [ ] Every eligible Reservation Return in the selected range appears at its authoritative `due_at`.
    - [ ] Every eligible persisted Fitting in the selected range appears at its authoritative appointment period.
    - [ ] Week, Month, and Day Agenda all consume one production Calendar projection.
    - [ ] Reservation event drill-down opens the authoritative Reservation record.
    - [ ] Fitting event drill-down opens the authoritative Fitting record.
    - [ ] Calendar mutations delegate to owning modules and refetch authoritative data.
    - [ ] Tenant/branch/timezone isolation tests pass.
    - [ ] Contracts, API, app typecheck/lint/tests/build are green.
    - [ ] OpenAPI is synchronized.
    - [ ] Schedule/Fittings documentation reflects the production cutover with no stale “Fitting prototype only” language.

## Deferred / separate follow-up

- Canonical **Issues / disruption / overdue** summary and event cues. Define exact predicates and source IDs first; do not revive the hard-coded `Issues = 3` card.
- Drag-and-drop rescheduling. Any future implementation must call the owning Reservation/Fitting reschedule commands and preserve their atomic concurrency rules.
- Multi-branch combined Calendar — V2.
- Predictive workload/analytics.
