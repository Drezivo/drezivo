---
title: Availability V1 End-to-End Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, v1, availability, allocations, calendar, checklist]
---

# Availability V1 End-to-End Checklist

**Status:** Planned; current Clothing Availability calendar is prototype/mock-data driven.
**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).
**Dependencies:** [[Clothing Checklist]] and [[Reservations Checklist]].

## How to use this checklist

Implement in order. Availability is not a UI-only concern and must not be represented as a manually editable `Available/Reserved/Rented` flag. The authoritative planned-unavailability structure is `asset_allocation`; actual custody/readiness is separate physical truth.

Before marking a task complete:

- Planned booking/maintenance/manual blocks are backed by canonical allocation data.
- Actual pickup/return/readiness remains separate from planned allocation.
- Availability reads may lag, but final booking correctness is always protected by the reservation transaction and database exclusion constraint.
- Every availability mutation is tenant scoped, permission checked, idempotent, and concurrency tested.
- Calendar windows are bounded; no endpoint returns an unbounded tenant history.
- Fitting allocation is deferred to V1.1 even if the prototype UI currently includes `Fitting` blocks.

## Non-negotiable outcomes

- `asset_allocation` is the only source of planned physical-asset unavailability.
- A blocking allocation has exactly one canonical source: reservation line, maintenance/manual work order, or later V1.1/V2 source.
- Blocking periods are finite nonempty half-open ranges.
- Overlapping blocking periods for the same tenant/asset are impossible in PostgreSQL.
- `Reserved` means a future/current blocking reservation allocation, not a mutable garment status.
- `Rented`/picked-up is derived from actual custody/reservation lifecycle, not just the planned date block.
- Cleaning inside booked turnaround does not create a second overlapping block.
- Unexpected damage/readiness problems create operational unready/disruption truth instead of pretending future bookings disappeared.
- Search can locate a clothing item even if it has no agenda in the selected date range.

## Phase 0: Allocation foundation audit

- [ ] **AVL-000 — Audit allocation and work-order schema**
  - **Depends on:** Clothing/Reservation schema review complete.
  - **Outcome:** Existing `asset_allocation`, maintenance/manual-block, custody, and readiness structures are mapped before API work.
  - **Acceptance:**
    - [ ] Confirm allocation has tenant, branch, physical asset, source FK, kind, range period, blocking flag, and release semantics.
    - [ ] Confirm exactly-one-source invariant has a database/service enforcement plan.
    - [ ] Confirm GiST overlap exclusion exists or is covered by a forward migration.
    - [ ] Confirm range shape/bounds checks exist or are planned.
    - [ ] Confirm cleaning-within-turnaround does not require a duplicate overlap record.
  - **Tests/evidence:** Schema review against Data Model §5 and TRD §5.

- [ ] **AVL-001 — Define availability contracts**
  - **Depends on:** AVL-000.
  - **Outcome:** Shared contracts own staff/public availability query and manual-block commands.
  - **Acceptance:**
    - [ ] Define bounded staff timeline query by date range, category, size, status projection, clothing search, page/cursor, and page size.
    - [ ] Define item-level availability response that distinguishes planned block, custody/readiness, and safe display state.
    - [ ] Define manual unavailable/maintenance commands if required by accepted V1 scope.
    - [ ] Define stable errors for invalid range, overlap conflict, stale state, unresolved custody, and foreign asset.
    - [ ] Reject tenant ID, arbitrary availability override, and client-selected authoritative allocation source.
  - **Tests/evidence:** Contract tests reject unknown states/authority fields.

## Phase 1: Authoritative availability read service

- [ ] **AVL-010 — Implement bounded asset-availability query**
  - **Depends on:** AVL-001, canonical allocation tables.
  - **Outcome:** Server can answer which physical assets are blocked/free within a requested time window.
  - **Acceptance:**
    - [ ] Query is tenant/branch scoped from actor context.
    - [ ] Requested date range is bounded and validated.
    - [ ] Allocation periods use canonical half-open semantics.
    - [ ] Released/nonblocking allocations do not make an asset unavailable.
    - [ ] Current custody/readiness is projected separately from future planned blocks.
    - [ ] Query does not become final booking authority; write transaction rechecks constraints.
  - **Tests/evidence:** Adjacent interval, released allocation, current custody, and cross-tenant tests.

- [ ] **AVL-011 — Implement Clothing Availability calendar projection**
  - **Depends on:** AVL-010, Clothing CLT-010.
  - **Outcome:** Current `/calendar/availability` UI can be driven by real tenant data.
  - **Acceptance:**
    - [ ] Default query returns only clothing with relevant activity/block/readiness events in selected range.
    - [ ] Search queries the full tenant catalogue and may return an item with no agenda.
    - [ ] An agenda-free search result explicitly communicates no scheduled activity for the selected range.
    - [ ] Server pagination supports bounded page sizes with maximum 50 rows per render as approved by UI design.
    - [ ] Result includes enough stable identifiers for block Sheet details without exposing internal authority fields.
    - [ ] Sorting is deterministic under concurrent inserts/archives.
  - **Tests/evidence:** Seed 200+ items; search/no-agenda/pagination/filter tests.

- [ ] **AVL-012 — Define safe display-state derivation**
  - **Depends on:** AVL-010.
  - **Outcome:** UI labels/colors are derived consistently from canonical domain truth.
  - **Acceptance:**
    - [ ] Reserved derives from blocking reservation allocation.
    - [ ] Rented derives from picked-up custody/reservation state.
    - [ ] Pickup/Return display events derive from reservation deadlines/actual workflow rather than allocations alone.
    - [ ] Maintenance/Unavailable derive from canonical work-order/manual-block sources.
    - [ ] Cleaning is derived from turnaround/readiness workflow without creating invalid overlapping allocations.
    - [ ] Available is computed for a specified interval/context; it is not persisted as authoritative future truth.
  - **Tests/evidence:** Projection matrix tests across reservation/custody/readiness combinations.

## Phase 2: Maintenance and manual unavailable blocks

- [ ] **AVL-020 — Implement manual unavailable/maintenance command**
  - **Depends on:** AVL-000, AVL-001, entitlement/actor context.
  - **Outcome:** Authorized staff can block a garment for a real operational reason without bypassing allocation rules.
  - **Acceptance:**
    - [ ] Command accepts asset, bounded period, closed reason/kind, and allowed notes only.
    - [ ] Server resolves tenant/branch/permission and validates asset ownership.
    - [ ] Create work-order/manual-block source and allocation atomically.
    - [ ] GiST conflict with an existing blocking allocation returns clean conflict.
    - [ ] Same intent is idempotent; changed payload under same key fails.
    - [ ] Audit records actor, reason code, request ID, and UTC time without sensitive payloads.
  - **Tests/evidence:** Sequential/concurrent duplicate and overlap conflict tests.

- [ ] **AVL-021 — Implement edit/release of future manual blocks**
  - **Depends on:** AVL-020.
  - **Outcome:** Future manual downtime can be corrected safely without rewriting historical reservation truth.
  - **Acceptance:**
    - [ ] Only allowed source types can be edited/released through this command.
    - [ ] Reservation-owned allocations cannot be manually released through generic availability UI.
    - [ ] Update uses conditional version/state guard.
    - [ ] Historical work-order/audit context remains retained.
  - **Tests/evidence:** Foreign-source, stale-version, and duplicate release tests.

## Phase 3: Reservation integration

- [ ] **AVL-030 — Integrate availability candidate reads into reservation quote**
  - **Depends on:** AVL-010, Reservations RSV-020.
  - **Outcome:** Reservation quote/candidate selection uses the same interval semantics as the authoritative allocation layer.
  - **Acceptance:**
    - [ ] Candidate reads filter only lifecycle/readiness-eligible physical assets.
    - [ ] Preparation and turnaround are included in blocked interval calculations.
    - [ ] Read response does not bypass final lock/exclusion check.
  - **Tests/evidence:** Read/write consistency and stale-availability race tests.

- [ ] **AVL-031 — Ensure reservation lifecycle updates allocation state correctly**
  - **Depends on:** Reservations RSV-021 through RSV-052.
  - **Outcome:** Holds, confirmation, cancellation, expiry, reschedule, return/turnaround, and release remain reflected in availability.
  - **Acceptance:**
    - [ ] Held/pending/confirmed allocations stay blocking.
    - [ ] Confirmation retains allocation rather than replacing it.
    - [ ] Expiry/cancellation releases only when lifecycle/policy permits.
    - [ ] Reschedule atomically replaces old allocation after valid new claim.
    - [ ] Actual late return does not fail because of future planned allocation.
    - [ ] Early return does not automatically free turnaround without explicit safe release/readiness validation.
  - **Tests/evidence:** Reservation lifecycle-to-allocation integration suite.

## Phase 4: Clothing Availability staff UI

- [ ] **AVL-040 — Replace availability calendar mock data**
  - **Depends on:** AVL-011.
  - **Outcome:** `/calendar/availability` displays authoritative server projection.
  - **Acceptance:**
    - [ ] Date range/filter/search/page size/pagination query API instead of local mock arrays.
    - [ ] Default view shows only clothing with agenda/activity in selected range.
    - [ ] Search surfaces full-catalogue clothing even when no activity exists.
    - [ ] 25/page default and 50/page option remain bounded.
    - [ ] Fixed-height scroll, sticky date header, and sticky clothing column remain functional.
    - [ ] Mobile compact clothing column remains usable at 360px.
  - **Tests/evidence:** Component/browser tests against seeded 75–200 item tenant.

- [ ] **AVL-041 — Connect agenda block details Sheet**
  - **Depends on:** AVL-011, Reservation RSV-011.
  - **Outcome:** Clicking Reserved/Rented/Pickup/Return/Maintenance/etc. shows real related operational details.
  - **Acceptance:**
    - [ ] Sheet is hidden until a block is selected.
    - [ ] Reservation-owned block can link to authoritative reservation detail.
    - [ ] Maintenance/manual block shows its own source/reason, not fake reservation data.
    - [ ] Dark mode keeps semantic status colors while preserving contrast.
  - **Tests/evidence:** Block-source detail tests.

- [ ] **AVL-042 — Connect manual availability actions**
  - **Depends on:** AVL-020, AVL-021.
  - **Outcome:** Authorized staff can create/release maintenance/manual blocks from Clothing/Availability UI.
  - **Acceptance:**
    - [ ] Mutating controls use shared submit guard and one idempotency key per intent.
    - [ ] Conflict response identifies date conflict safely without exposing another tenant.
    - [ ] UI refetches authoritative timeline after success.
  - **Tests/evidence:** UI double-fire/conflict tests.

## Phase 5: Performance and security

- [ ] **AVL-050 — Prove availability query scale**
  - **Depends on:** AVL-011, AVL-040.
  - **Outcome:** Availability remains usable at the Business plan asset ceiling.
  - **Acceptance:**
    - [ ] No unbounded all-time allocation scan for normal calendar requests.
    - [ ] Queries use tenant/asset/period indexes and bounded calendar windows.
    - [ ] Representative test includes 1,000 physical assets in busiest tenant.
    - [ ] Staff availability p95 target aligns with TRD proposal of ≤500 ms under representative load.
  - **Tests/evidence:** Query plans/load measurements with documented environment.

- [ ] **AVL-051 — Complete availability isolation/concurrency suite**
  - **Depends on:** All Availability API tasks.
  - **Outcome:** Availability cannot leak tenant data or double-book under race.
  - **Acceptance:**
    - [ ] Missing tenant context denies.
    - [ ] Foreign assets/allocations are concealed.
    - [ ] Same-asset concurrent blockers yield one winner.
    - [ ] Manual block versus reservation race yields one valid blocking outcome.
    - [ ] Released block does not resurrect under stale retry.
  - **Tests/evidence:** Real Postgres RLS/GiST/idempotency tests.

- [ ] **AVL-052 — Mark Availability vertical slice complete**
  - **Depends on:** AVL-050, AVL-051.
  - **Outcome:** Clothing Availability is an authoritative operational view rather than a mock calendar.
  - **Acceptance:**
    - [ ] Real Clothing + Reservation state appears in timeline.
    - [ ] Search/no-agenda behavior is correct.
    - [ ] Manual downtime uses canonical blocks.
    - [ ] No production code relies on mutable fake availability state.
    - [ ] Docs/checklist reflect implemented behavior.
  - **Tests/evidence:** API/app/e2e suite, typecheck, lint, build, browser walkthrough.

## Deferred from Availability V1

- Fitting appointment/resource/garment allocation — V1.1.
- Multi-location transfer availability — V2.
- Predictive availability/demand forecasting.
- Any client-side-only conflict checker presented as authoritative booking safety.
