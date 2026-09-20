---
title: Reservations V1 End-to-End Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, v1, reservations, booking, checklist]
---

# Reservations V1 End-to-End Checklist

**Status:** Planned; current `/reservations` UI and Schedule detail drawers are prototype/mock-data driven.
**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).
**Dependencies:** [[Clothing Checklist]] and the tenancy/actor-context foundation.

## How to use this checklist

Implement in order. Reservation correctness depends on database-enforced allocation safety, immutable snapshots, state transitions, and idempotent mutations. Do not wire the current frontend directly to simplistic CRUD tables.

Before marking a task complete:

- Contracts are defined in `contracts/` before route consumers.
- Tenant, membership, branch, permissions, and lifecycle state are server-resolved.
- Every reservation mutation has sequential and concurrent double-fire tests.
- Final availability is protected by the authoritative allocation transaction and PostgreSQL overlap constraints.
- Price/policy/customer offered facts are snapshotted at acceptance and are not silently recomputed later.
- Money uses integer minor units and payment status remains distinct from reservation status.
- Actual pickup/return facts are append-only custody events; late return must remain recordable.
- Targeted integration tests run against real PostgreSQL/RLS.

## Non-negotiable outcomes

- V1 supports one serialized garment per checkout UI, while preserving `reservation_line` structure for future multi-line V1.1.
- Reservation lifecycle uses the canonical states: `held`, `pending_confirmation`, `confirmed`, `picked_up`, `returned`, `completed`, `cancelled`, `expired`, `rejected`.
- Initial hold and all blocking booking states claim a real physical asset through `asset_allocation`.
- Overlapping blocking allocation cannot be created even under concurrent requests.
- Confirmation retains the same allocation; it does not release and recreate the garment block.
- Reschedule acquires replacement capacity atomically; failure preserves the old booking.
- Cancellation before handover releases future blocking allocation according to policy; after handover use return/settlement flow.
- Pickup and return are conditional state transitions backed by immutable custody facts.
- Payment/evidence review is not inferred from uploaded screenshots alone.
- Fitting appointments are V1.1 and do not become real V1 reservations merely because the UI prototype contains fitting labels.

## Phase 0: Contract and lifecycle preparation

- [ ] **RSV-000 — Audit reservation schema and migration readiness**
  - **Depends on:** Clothing catalogue model available.
  - **Outcome:** Existing reservation, line, allocation, customer, payment/evidence, custody, and disruption schema is mapped before adding code.
  - **Acceptance:**
    - [ ] Identify existing tables/constraints and missing V1 pieces.
    - [ ] Confirm one reservation line maps to one serialized garment in V1.
    - [ ] Confirm allocation period uses finite nonempty half-open ranges.
    - [ ] Confirm exclusion constraint/index strategy exists or has a forward migration plan.
    - [ ] Confirm canonical status values match PRD/Data Model exactly.
  - **Tests/evidence:** Schema review against TRD §5 and Data Model §6.

- [ ] **RSV-001 — Define reservation contracts and stable errors**
  - **Depends on:** RSV-000.
  - **Outcome:** Shared schemas own reservation requests/responses before API routes.
  - **Acceptance:**
    - [ ] Define list/detail projections used by Reservations page and detail Sheet.
    - [ ] Define create staff/walk-in request, confirm, reschedule, cancel, pickup, return, complete, and evidence commands required by V1.
    - [ ] Define customer/contact snapshot input and event/pickup/due dates using explicit timezone-safe fields.
    - [ ] Reject client-supplied tenant/branch authority, computed price totals, allocation IDs, server status transitions, and payment verification authority.
    - [ ] Add stable errors for conflict, hold expiry, stale version, invalid transition, asset unavailable, payment prerequisite failure, unready asset, and foreign resource concealment.
  - **Tests/evidence:** Closed-schema tests and unknown-state rejection.

- [ ] **RSV-002 — Define reservation database constraints and indexes**
  - **Depends on:** RSV-000, RSV-001.
  - **Outcome:** Database protects core booking invariants under concurrency.
  - **Acceptance:**
    - [ ] GiST exclusion prevents overlapping blocking allocations for the same tenant/asset.
    - [ ] Partial unique constraint prevents more than one current blocking allocation per reservation line.
    - [ ] Reservation reference code is tenant safe and unique as required.
    - [ ] Same-tenant FKs protect reservation/line/customer/storefront/policy/payment method relationships.
    - [ ] Indexes support tenant status/date/customer/reference listing and schedule projections.
    - [ ] Runtime role cannot bypass RLS or mutate immutable history tables unsafely.
  - **Tests/evidence:** Real PostgreSQL concurrent overlap and RLS tests.

## Phase 1: Reservation read model

- [ ] **RSV-010 — Implement reservation list query**
  - **Depends on:** RSV-001, RSV-002.
  - **Outcome:** `/reservations` renders authoritative tenant reservations with bounded pagination.
  - **Acceptance:**
    - [ ] Search supports reference, customer-safe fields, clothing identity, and allowed phone/contact projection where authorized.
    - [ ] Filters support canonical reservation status and bounded date windows.
    - [ ] Pagination/sorting are deterministic and server-side.
    - [ ] List projection includes only safe summary fields required by UI.
    - [ ] Payment projection is separate from reservation status.
  - **Tests/evidence:** Search/filter/pagination/isolation tests.

- [ ] **RSV-011 — Implement reservation detail query**
  - **Depends on:** RSV-010.
  - **Outcome:** Reservations and Schedule drawers show the same authoritative reservation record.
  - **Acceptance:**
    - [ ] Detail includes reservation status, snapshots, line/clothing summary, pickup/due period, customer projection, delivery snapshot, safe payment/evidence state, and custody timeline.
    - [ ] Historical line snapshots remain visible even after clothing edits/archive.
    - [ ] Internal notes/financial evidence remain authorization scoped.
    - [ ] Foreign reservation IDs are concealed.
  - **Tests/evidence:** Detail projection and historical snapshot tests.

## Phase 2: Staff reservation creation and hold allocation

- [ ] **RSV-020 — Implement quote and candidate asset resolution**
  - **Depends on:** Clothing CLT-050, Availability foundations.
  - **Outcome:** Server computes eligible garment candidates, blocked interval, price, and policy snapshot.
  - **Acceptance:**
    - [ ] Resolve variant/product and candidate physical assets within tenant/default branch.
    - [ ] Resolve pickup/due deadlines in booking timezone snapshot.
    - [ ] Compute `[blocked_start, blocked_end)` including preparation/turnaround.
    - [ ] Compute rental/deposit/delivery totals in PHP minor units on server.
    - [ ] Do not promise availability from a stale read response.
  - **Tests/evidence:** DST/adjacent-range/price snapshot tests.

- [ ] **RSV-021 — Implement idempotent staff/walk-in reservation creation**
  - **Depends on:** RSV-020, RSV-002.
  - **Outcome:** One user intent creates one held/pending reservation graph and one authoritative allocation.
  - **Acceptance:**
    - [ ] Lock candidate physical assets in deterministic ID order.
    - [ ] Release expired holds safely using database time where required.
    - [ ] Insert reservation, line, snapshots, blocking allocation, audit/idempotency outcome atomically.
    - [ ] Exclusion conflict returns clean capacity conflict, not 500.
    - [ ] Same idempotency key/same payload replays original result.
    - [ ] Same key/different payload fails with stable conflict.
  - **Tests/evidence:** Sequential/concurrent double-fire and same-asset race tests.

- [ ] **RSV-022 — Expose staff reservation create route**
  - **Depends on:** RSV-021.
  - **Outcome:** Staff app can create a reservation without duplicating business rules in Next.js.
  - **Acceptance:**
    - [ ] Requires Clerk auth, local active membership, permission, tenant lifecycle gate, and idempotency key.
    - [ ] Body validation is closed and size/rate limited.
    - [ ] Client cannot choose authoritative asset allocation or final server price.
  - **Tests/evidence:** Route/auth/validation/idempotency tests.

## Phase 3: Pending confirmation and merchant approval

- [ ] **RSV-030 — Implement submission/pending-confirmation transition**
  - **Depends on:** RSV-021.
  - **Outcome:** Complete customer/contact/terms/evidence moves a valid hold into review without changing allocation ownership.
  - **Acceptance:**
    - [ ] Required customer/contact snapshot exists before `pending_confirmation`.
    - [ ] Terms/evidence deadlines are validated against original hold boundary.
    - [ ] Upload/evidence reference is tenant/reservation scoped.
    - [ ] Duplicate submission is idempotent.
  - **Tests/evidence:** Expiry boundary and duplicate submission tests.

- [ ] **RSV-031 — Implement merchant confirmation/rejection**
  - **Depends on:** RSV-030 and payment/evidence verification boundary.
  - **Outcome:** Authorized staff confirms only an eligible reservation and preserves allocation truth.
  - **Acceptance:**
    - [ ] Lock reservation/payment/evidence/assets in documented deterministic order.
    - [ ] Compare review deadline using database time.
    - [ ] Verify actual merchant-account/cash evidence state; screenshot alone is insufficient.
    - [ ] `pending_confirmation → confirmed` keeps same allocation blocking interval.
    - [ ] Rejection releases block according to policy and records immutable decision/audit.
    - [ ] Repeated approval/rejection returns prior result or clean conflict.
  - **Tests/evidence:** Confirmation-vs-expiry race and double-fire tests.

## Phase 4: Reschedule and cancellation

- [ ] **RSV-040 — Implement atomic reschedule**
  - **Depends on:** RSV-031.
  - **Outcome:** New dates are acquired safely before the old allocation is released.
  - **Acceptance:**
    - [ ] Lock old/new candidate assets and reservation in deterministic order.
    - [ ] Recompute price/policy where applicable and require acceptance when changed.
    - [ ] Acquire valid replacement allocation and update snapshot/version in one transaction.
    - [ ] Any conflict rolls back completely and preserves original reservation/allocation.
    - [ ] Mutation is idempotent.
  - **Tests/evidence:** Failed reschedule preserves old allocation; concurrent reschedule tests.

- [ ] **RSV-041 — Implement cancellation**
  - **Depends on:** RSV-031.
  - **Outcome:** Cancellation respects lifecycle and financial obligations without fabricating availability.
  - **Acceptance:**
    - [ ] Pre-handover allowed states transition conditionally.
    - [ ] Future blocking allocation releases transactionally when policy allows.
    - [ ] Refund/deposit obligations are recorded through finance layer rather than mutating historical payment facts.
    - [ ] `picked_up` cannot cancel into available; route through return/settlement.
    - [ ] Duplicate cancellation is safe.
  - **Tests/evidence:** Lifecycle matrix and duplicate cancellation tests.

## Phase 5: Pickup, return, inspection, and completion

- [ ] **RSV-050 — Implement pickup/handover command**
  - **Depends on:** RSV-031, Clothing readiness projection.
  - **Outcome:** Confirmed reservation becomes physically handed over only when garment/payment/policy prerequisites pass.
  - **Acceptance:**
    - [ ] Lock reservation and current asset projection.
    - [ ] Require confirmed state, matching active allocation, physical presence/readiness, and permission.
    - [ ] Record append-only custody event with actor/time/condition snapshot/business key.
    - [ ] Conditionally transition `confirmed → picked_up` once.
    - [ ] Duplicate handover creates one custody fact/effect.
  - **Tests/evidence:** Unready/payment-blocked/duplicate pickup tests.

- [ ] **RSV-051 — Implement return command**
  - **Depends on:** RSV-050.
  - **Outcome:** Actual return is always recordable even when late and threatening future bookings.
  - **Acceptance:**
    - [ ] Lock current reservation/asset projection and record immutable return custody fact.
    - [ ] Transition `picked_up → returned` once.
    - [ ] Late actual return is not rejected because it conflicts with a future planned interval.
    - [ ] Threatened future reservation creates/updates disruption workflow.
    - [ ] Return does not automatically mark garment ready/available.
  - **Tests/evidence:** Late return, future-conflict, duplicate return tests.

- [ ] **RSV-052 — Implement inspection/cleaning/settlement completion gate**
  - **Depends on:** RSV-051, Availability/Clothing readiness workflows.
  - **Outcome:** `returned → completed` happens only after operational and settlement requirements are satisfied.
  - **Acceptance:**
    - [ ] Inspection records required cleaning/damage/readiness outcome.
    - [ ] Cleaning remains part of the booked turnaround block where applicable.
    - [ ] Extra maintenance/manual block uses canonical allocation/work-order path.
    - [ ] Deposit/refund/charge settlement state is checked without rewriting monetary history.
    - [ ] Completion is conditional/idempotent.
  - **Tests/evidence:** Cleaning/damage/settlement gate tests.

## Phase 6: Staff app integration

- [ ] **RSV-060 — Replace Reservations page mock data**
  - **Depends on:** RSV-010.
  - **Outcome:** Reservation table/search/status/date filters/pagination use real API data.
  - **Acceptance:**
    - [ ] Search/status/date controls query server-side.
    - [ ] Loading/empty/error states are present.
    - [ ] Pagination is bounded and stable.
    - [ ] Dark/light UI does not alter domain state semantics.
  - **Tests/evidence:** Component/browser tests with seeded reservations.

- [ ] **RSV-061 — Connect Reservation Details Sheet**
  - **Depends on:** RSV-011.
  - **Outcome:** Clicking a reservation row shows authoritative detail data.
  - **Acceptance:**
    - [ ] Sheet is hidden initially and fetches/resolves selected reservation safely.
    - [ ] Customer, garment, period, payment/evidence, verification, notes, and actions use real data.
    - [ ] Actions shown are derived from current permissions/state, but API rechecks them.
  - **Tests/evidence:** Row selection/detail/error/stale-state tests.

- [ ] **RSV-062 — Connect reservation mutations to UI**
  - **Depends on:** RSV-022, RSV-031, RSV-040 through RSV-052.
  - **Outcome:** Staff can perform allowed lifecycle actions without mock state.
  - **Acceptance:**
    - [ ] Shared submit guards prevent double click/keyboard duplicate mutations.
    - [ ] One idempotency key per intent is reused across retry.
    - [ ] Success refetches authoritative reservation/calendar/dashboard projections.
    - [ ] Conflict/stale-state responses explain what changed and prompt refresh/retry safely.
  - **Tests/evidence:** UI mutation retry/double-fire/conflict tests.

## Phase 7: Security and completion evidence

- [ ] **RSV-070 — Complete reservation authorization/RLS suite**
  - **Depends on:** All Reservation API tasks.
  - **Outcome:** Reservation/customer/payment/custody data cannot cross tenant or capability boundaries.
  - **Acceptance:**
    - [ ] Foreign reservation/customer/asset IDs are concealed.
    - [ ] Missing tenant context fails closed.
    - [ ] Owner/Front Desk action policy matches approved V1 permissions.
    - [ ] Restricted/cancelled tenant policy preserves only approved existing-rental settlement/return/refund/export operations.
  - **Tests/evidence:** Real Postgres RLS and API authorization suite.

- [ ] **RSV-071 — Prove reservation concurrency invariants**
  - **Depends on:** RSV-021 through RSV-052.
  - **Outcome:** Drezivo cannot double-book or duplicate lifecycle effects under contention.
  - **Acceptance:**
    - [ ] Concurrent same-asset booking produces one winner.
    - [ ] Adjacent half-open intervals can coexist when readiness allows.
    - [ ] Confirmation vs expiry has one valid outcome.
    - [ ] Reschedule conflict preserves original booking.
    - [ ] Pickup/return/cancel/complete double-fire produces one effect each.
  - **Tests/evidence:** Property/concurrency integration suite.

- [ ] **RSV-072 — Mark Reservations vertical slice complete**
  - **Depends on:** RSV-070, RSV-071.
  - **Outcome:** Reservations are authoritative and ready to drive Calendar/Dashboard.
  - **Acceptance:**
    - [ ] Create → review/confirm → pickup → return → complete works end-to-end.
    - [ ] Reschedule/cancel conflict paths are proven.
    - [ ] Reservations page and detail Sheet contain no production mock data.
    - [ ] Allocation, snapshots, custody, and payment status remain internally consistent.
    - [ ] Docs/checklist reflect implemented behavior.
  - **Tests/evidence:** Contracts/API/app/e2e suites, typecheck, lint, build, browser walkthrough.

## Deferred from Reservations V1

- Multi-item reservation UI and partial physical return — V1.1.
- Fitting appointments/resources/capacity — V1.1.
- Native payment gateway/card collection or automated recurring payments.
- Marketplace booking across multiple tenants.
