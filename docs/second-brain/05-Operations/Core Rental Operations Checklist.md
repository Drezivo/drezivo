---
title: Core Rental Operations V1 End-to-End Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, v1, vertical-slice, end-to-end, checklist]
---

# Core Rental Operations V1 End-to-End Checklist

**Status:** Planned; this is the integration/release checklist that starts after the individual Clothing, Reservations, Availability, Schedule, and Dashboard slices are implemented.
**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).
**Component checklists:** [[Clothing Checklist]], [[Reservations Checklist]], [[Availability Checklist]], [[Schedule Calendar Checklist]], and [[Dashboard Checklist]].
**Foundation dependency:** [Tenancy, Owner Onboarding, Clerk, Memberships, and Billing V1 Checklist](../../../api/TENANCY-ONBOARDING-V1-CHECKLIST.md).

## How to use this checklist

This file is the ordered integration gate for the first real Drezivo vertical slice. Do not use it to bypass unfinished tasks in the component checklists. A phase becomes eligible only when its dependencies are complete enough to supply real contracts and authoritative data.

The target user journey is:

```text
Owner signs up
  → completes tenant onboarding
  → opens real Dashboard
  → adds clothing
  → creates/receives a reservation
  → reservation claims one physical garment
  → Clothing and Availability show the same occupied period
  → Schedule shows pickup/return work
  → Reservation Details shows the same source record
  → pickup records actual custody
  → return records actual custody even if late
  → cleaning/readiness/settlement complete the rental
  → Dashboard/Calendar/Clothing all converge on the updated state
```

Before marking a task complete:

- No production code path in the core flow depends on mock arrays.
- The API/database remain authoritative for tenant, availability, money, lifecycle, and permissions.
- Every mutation is idempotent and double-fire tested sequentially and concurrently.
- Every tenant-owned read/write is proven under real PostgreSQL RLS.
- Cross-surface UI consistency is tested from shared source IDs, not visual similarity.
- Fittings stay V1.1 even where current prototypes display them.
- Failure, retry, stale state, and concurrent use are tested—not only the happy path.

## Non-negotiable outcomes

- One real physical garment cannot be allocated to overlapping blocking reservations.
- Catalogue edits do not rewrite accepted reservation snapshots.
- Availability calendar, Schedule, Reservations, Clothing, and Dashboard agree because they derive from the same backend model.
- Actual late return is always recordable and may create a disruption; it is never rejected to preserve a fake calendar state.
- Return does not mean ready; cleaning/inspection/readiness remain explicit.
- Restricted/cancelled tenant lifecycle preserves only approved existing-rental settlement/return/refund/export behavior.
- No tenant can read or mutate another tenant’s clothing, reservations, allocations, customers, custody, or operational queue.
- Core reliability/security/export/return/refund behavior is never made a premium entitlement gate.

## Phase 0: Freeze scope and dependency order

- [ ] **CORE-000 — Freeze new page expansion until the vertical slice is complete**
  - **Depends on:** Current UI prototype through Clothing.
  - **Outcome:** Engineering effort moves from page breadth to authoritative core behavior.
  - **Acceptance:**
    - [ ] Customers, Payments, Fittings, Storefront management, and additional Settings pages do not block core vertical-slice completion unless a canonical dependency is discovered.
    - [ ] Tiny usability fixes remain allowed; new mock-heavy feature surfaces are deferred.
    - [ ] Team milestone explicitly prioritizes Clothing → Reservations → Availability → Schedule → Dashboard integration.
  - **Tests/evidence:** Weekly milestone/plan reflects this sequence.

- [ ] **CORE-001 — Confirm canonical V1 scope before implementation**
  - **Depends on:** CORE-000.
  - **Outcome:** Current prototypes are reconciled with authoritative scope.
  - **Acceptance:**
    - [ ] V1 remains single-branch and one serialized garment per checkout UI.
    - [ ] Fittings are documented as V1.1 and excluded from real V1 API/data work unless product scope is formally changed.
    - [ ] Payments remain manual/evidence-based; no card gateway or recurring customer payment promise is introduced.
    - [ ] Customer account remains optional/deferred according to current product scope; guest/customer identity rules remain canonical.
    - [ ] Clothing availability is allocation/custody derived, not a mutable status source.
  - **Tests/evidence:** Checklist/docs review shows no contradictory implementation requirement.

## Phase 1: Shared contracts and migrations

- [ ] **CORE-010 — Land contracts in dependency order**
  - **Depends on:** CLT-001, RSV-001, AVL-001, SCH-001, DSH-001.
  - **Outcome:** One contracts package supports the core slice before app integration.
  - **Acceptance:**
    - [ ] Catalogue DTOs are available first.
    - [ ] Reservation/allocation DTOs build on stable catalogue identities.
    - [ ] Availability/Schedule/Dashboard DTOs reference canonical source IDs rather than duplicate shapes.
    - [ ] Stable error codes and envelopes are shared.
    - [ ] Contract build/type declarations are consumable by both API and app.
  - **Tests/evidence:** Contracts tests/typecheck/build pass before downstream work.

- [ ] **CORE-011 — Land database migrations in forward-only order**
  - **Depends on:** Component schema-audit tasks.
  - **Outcome:** PostgreSQL contains all required V1 core tables/constraints/indexes/RLS without destructive rewrites.
  - **Acceptance:**
    - [ ] Catalogue identities and tenant-safe constraints land before reservation FK consumers.
    - [ ] Allocation GiST exclusion and range checks land before reservation booking routes are enabled.
    - [ ] Custody/disruption/maintenance primitives required by V1 are present before pickup/return/readiness UI is enabled.
    - [ ] Runtime privileges follow least privilege.
    - [ ] Existing migration history is never edited; corrections use new forward migrations.
  - **Tests/evidence:** Fresh DB + upgrade-path migration run and disposable PostgreSQL integration suite.

## Phase 2: Clothing becomes real first

- [ ] **CORE-020 — Complete Clothing vertical slice**
  - **Depends on:** CLT-062.
  - **Outcome:** Staff can manage real tenant clothing and serialized assets.
  - **Acceptance:**
    - [ ] Add Clothing creates product/variant/asset graph.
    - [ ] Search/filter/pagination use API data.
    - [ ] Detail/edit/archive work against real state.
    - [ ] Plan asset quota is enforced transactionally.
    - [ ] No production Clothing mock data remains.
  - **Tests/evidence:** Clothing checklist completion evidence attached/linked.

- [ ] **CORE-021 — Seed realistic integration catalogue**
  - **Depends on:** CORE-020.
  - **Outcome:** Development/test tenant has enough serialized garments to exercise search, pagination, and contention.
  - **Acceptance:**
    - [ ] Seed includes multiple categories, sizes, duplicate variants with distinct physical assets, archived clothing, and at least one near-quota scenario.
    - [ ] Seed uses non-sensitive synthetic data only.
    - [ ] Seed is deterministic/repeatable for tests.
  - **Tests/evidence:** Seed command/fixture creates expected counts.

## Phase 3: Reservations and allocation correctness

- [ ] **CORE-030 — Complete authoritative reservation creation**
  - **Depends on:** CORE-020, RSV-022, AVL-030.
  - **Outcome:** Creating a reservation claims one real serialized garment through canonical allocation.
  - **Acceptance:**
    - [ ] Server computes quote, blocked period, and candidate asset.
    - [ ] Reservation/line/allocation/snapshots/idempotency commit atomically.
    - [ ] Concurrent same-asset booking gives one winner and a safe conflict loser.
    - [ ] Accepted reservation appears immediately in real Reservations read model.
  - **Tests/evidence:** Booking contention and snapshot assertions.

- [ ] **CORE-031 — Complete reservation lifecycle through confirmation**
  - **Depends on:** CORE-030, RSV-030, RSV-031.
  - **Outcome:** Hold/submission/review/confirmation states are real and allocation-safe.
  - **Acceptance:**
    - [ ] Confirmation does not recreate/release the existing block.
    - [ ] Expiry/rejection/cancellation release only through valid state transition.
    - [ ] Payment/evidence state remains separate from reservation status.
    - [ ] Reservations page/detail Sheet update from API data.
  - **Tests/evidence:** Expiry-vs-confirm race and UI integration tests.

- [ ] **CORE-032 — Complete reschedule/cancel conflict behavior**
  - **Depends on:** CORE-031, RSV-040, RSV-041.
  - **Outcome:** Changing plans cannot corrupt existing allocation.
  - **Acceptance:**
    - [ ] Failed reschedule preserves original reservation/block.
    - [ ] Successful reschedule updates Availability/Schedule consistently.
    - [ ] Cancel after pickup is rejected/routed to return workflow.
  - **Tests/evidence:** Cross-surface reschedule/cancel integration tests.

## Phase 4: Availability becomes a real projection

- [ ] **CORE-040 — Complete Clothing Availability read integration**
  - **Depends on:** CORE-030, AVL-040, AVL-041.
  - **Outcome:** Availability calendar renders real clothing/allocation/custody state.
  - **Acceptance:**
    - [ ] Reservation block appears on the same physical garment/dates claimed by reservation.
    - [ ] Default view shows only activity-bearing clothing in selected range.
    - [ ] Full-catalogue search finds an agenda-free garment and reports no scheduled activity.
    - [ ] Pagination/50-row max and fixed scroll work with real API data.
    - [ ] Block Sheet resolves authoritative reservation/work-order source.
  - **Tests/evidence:** 75–200 item seeded browser tests plus API consistency assertions.

- [ ] **CORE-041 — Complete maintenance/manual unavailable integration**
  - **Depends on:** AVL-020, AVL-021.
  - **Outcome:** Staff can block real garments without fake status flags.
  - **Acceptance:**
    - [ ] Manual block conflicts safely with reservation allocation.
    - [ ] Reservation-owned block cannot be released by generic availability controls.
    - [ ] Clothing/Availability projections update from canonical block source.
  - **Tests/evidence:** Concurrent reservation-vs-maintenance test.

## Phase 5: Schedule becomes a real projection

- [ ] **CORE-050 — Complete real Week/Day Agenda integration**
  - **Depends on:** CORE-031, SCH-020, SCH-022.
  - **Outcome:** Schedule shows real pickup/return/reservation work.
  - **Acceptance:**
    - [ ] Day header counts match server day agenda.
    - [ ] `+ more` opens all real activities for the date.
    - [ ] Individual event opens the exact source reservation.
    - [ ] Fitting events are absent/feature-gated in V1 unless scope changes.
  - **Tests/evidence:** Source-ID consistency tests with Reservations.

- [ ] **CORE-051 — Complete Reservation Details reuse across Calendar and Reservations**
  - **Depends on:** RSV-011, SCH-021.
  - **Outcome:** One reservation detail contract powers both surfaces.
  - **Acceptance:**
    - [ ] Same reference/status/clothing/customer/period/timeline data appears from either entry point.
    - [ ] No second calendar-only mock/detail model exists.
    - [ ] Permission/stale/foreign behavior is identical.
  - **Tests/evidence:** Cross-surface detail snapshot/source assertions.

## Phase 6: Pickup, return, readiness, and disruption

- [ ] **CORE-060 — Complete physical pickup flow**
  - **Depends on:** RSV-050, CORE-050.
  - **Outcome:** Real handover changes custody and all operational projections consistently.
  - **Acceptance:**
    - [ ] One immutable pickup custody event is recorded.
    - [ ] Reservation becomes `picked_up` once.
    - [ ] Clothing projection shows rented/in-custody truth.
    - [ ] Dashboard/Schedule update pickup work consistently.
  - **Tests/evidence:** Double-fire and cross-surface pickup tests.

- [ ] **CORE-061 — Complete physical return flow**
  - **Depends on:** RSV-051, CORE-060.
  - **Outcome:** Actual return is durable even when late.
  - **Acceptance:**
    - [ ] One immutable return custody event is recorded.
    - [ ] Reservation becomes `returned` once.
    - [ ] Late return creates/updates disruption if next booking is threatened.
    - [ ] Return does not mark asset ready automatically.
    - [ ] Dashboard/Schedule/Availability show consistent post-return truth.
  - **Tests/evidence:** Late-return and next-booking threat test.

- [ ] **CORE-062 — Complete cleaning/readiness/completion flow**
  - **Depends on:** RSV-052, CORE-061.
  - **Outcome:** Rental completes only after required post-return work/settlement.
  - **Acceptance:**
    - [ ] Cleaning/inspection/readiness state is explicit.
    - [ ] Existing booked turnaround is preserved.
    - [ ] Extra maintenance uses canonical block/work-order path.
    - [ ] `returned → completed` is conditional/idempotent.
    - [ ] Clothing returns to eligible availability only when domain state permits.
  - **Tests/evidence:** Return-clean-complete integration scenario.

## Phase 7: Dashboard becomes real last

- [ ] **CORE-070 — Complete Dashboard integration**
  - **Depends on:** DSH-051, CORE-060 through CORE-062.
  - **Outcome:** Dashboard summarizes the same core state now proven by dedicated pages.
  - **Acceptance:**
    - [ ] Active rentals/pickups/returns/review/issues are real counts.
    - [ ] Attention queue links to exact source reservation/clothing.
    - [ ] Changes made in Reservations/Calendar/Clothing are reflected after authoritative refetch.
    - [ ] No production Dashboard mock data remains.
  - **Tests/evidence:** Dashboard cross-surface integration suite.

## Phase 8: End-to-end happy path and adversarial scenarios

- [ ] **CORE-080 — Automate the canonical happy-path rental lifecycle**
  - **Depends on:** CORE-070.
  - **Outcome:** One browser/API scenario proves the complete vertical slice.
  - **Acceptance:**
    - [ ] Owner signs in/onboards into a provisioned tenant.
    - [ ] Adds Black Satin Gown (or deterministic synthetic equivalent).
    - [ ] Creates a reservation for a future period.
    - [ ] Reservation appears in Reservations, Availability, Schedule, and Dashboard appropriately.
    - [ ] Confirms, picks up, returns, completes.
    - [ ] Every surface converges on the final state.
  - **Tests/evidence:** Playwright/e2e scenario plus database assertions at key boundaries.

- [ ] **CORE-081 — Automate double-booking contention scenario**
  - **Depends on:** CORE-030.
  - **Outcome:** Two simultaneous requests cannot reserve the same serialized garment for overlapping intervals.
  - **Acceptance:**
    - [ ] Two concurrent requests race against same asset/window.
    - [ ] Exactly one allocation remains blocking.
    - [ ] Losing request receives stable conflict, never 500.
    - [ ] UI refresh shows winner consistently across surfaces.
  - **Tests/evidence:** Concurrent API/integration test.

- [ ] **CORE-082 — Automate reschedule failure preservation scenario**
  - **Depends on:** CORE-032.
  - **Outcome:** Failed new-date claim never loses original booking.
  - **Acceptance:**
    - [ ] Replacement interval conflicts.
    - [ ] Old allocation/reservation remains unchanged after rollback.
    - [ ] Availability/Schedule still display original dates.
  - **Tests/evidence:** Database + API + projection assertions.

- [ ] **CORE-083 — Automate late return/disruption scenario**
  - **Depends on:** CORE-061.
  - **Outcome:** Physical truth wins over planned schedule without silently destroying future booking history.
  - **Acceptance:**
    - [ ] Garment is returned after due time and overlaps/threatens next planned booking.
    - [ ] Return records successfully.
    - [ ] Future handover remains blocked until garment is ready.
    - [ ] Disruption/attention workflow is visible.
  - **Tests/evidence:** End-to-end disruption scenario.

- [ ] **CORE-084 — Automate stale/double-fire mutation scenarios**
  - **Depends on:** All mutation phases.
  - **Outcome:** Slow network/retry/double click does not duplicate business effects.
  - **Acceptance:**
    - [ ] Add Clothing double-fire creates one graph.
    - [ ] Reservation create/confirm/reschedule/cancel/pickup/return/complete each have sequential/concurrent duplicate evidence.
    - [ ] Manual availability block double-fire creates one block.
    - [ ] Frontend pending guards and backend idempotency both participate; neither is the sole protection.
  - **Tests/evidence:** Mutation matrix with single-effect assertions.

## Phase 9: Security and lifecycle policy

- [ ] **CORE-090 — Complete cross-tenant adversarial suite**
  - **Depends on:** All core API modules.
  - **Outcome:** Core rental data is isolated under real RLS and authorization.
  - **Acceptance:**
    - [ ] Tenant A cannot read/mutate Tenant B product, variant, asset, reservation, allocation, customer, custody, or work queue.
    - [ ] Foreign IDs are concealed where required.
    - [ ] Missing tenant context fails closed.
    - [ ] Browser-supplied tenant/role/price/allocation fields cannot grant authority.
  - **Tests/evidence:** Disposable PostgreSQL non-superuser suite.

- [ ] **CORE-091 — Prove restricted/cancelled tenant operational continuity**
  - **Depends on:** TBF-033 and core rental actions.
  - **Outcome:** SaaS lifecycle restriction blocks new business while preserving approved existing-rental obligations.
  - **Acceptance:**
    - [ ] New clothing/booking/publish actions are denied when restricted.
    - [ ] Authorized existing return/refund/settlement/export paths remain available as defined.
    - [ ] Dashboard/Calendar do not expose blocked mutation buttons as usable authority.
    - [ ] Cancelled tenant remains read-only for permitted historical/settlement data.
  - **Tests/evidence:** Shared restricted-action policy integration tests.

## Phase 10: Performance, observability, and operating readiness

- [ ] **CORE-100 — Run representative core load test**
  - **Depends on:** All read/write slices complete.
  - **Outcome:** Core paths are measured under the TRD representative workload assumptions.
  - **Acceptance:**
    - [ ] Seed 100 tenants with 1,000 physical assets in busiest tenant.
    - [ ] Exercise catalogue, availability, reservations, schedule, and dashboard reads.
    - [ ] Include same-asset contention separately from ordinary load.
    - [ ] Record p95 availability and mutation latency against proposed targets.
    - [ ] Document environment; do not claim production SLO proof from local test alone.
  - **Tests/evidence:** Load report/query plans.

- [ ] **CORE-101 — Add core observability without leaking PII**
  - **Depends on:** Core APIs complete.
  - **Outcome:** Failures/conflicts can be diagnosed without logging customer/payment secrets.
  - **Acceptance:**
    - [ ] Request IDs correlate safe API errors/logs.
    - [ ] Metrics cover booking conflict rate, failed mutations, queue/worker failures, and latency.
    - [ ] Logs exclude raw request bodies containing PII/payment evidence unless explicitly safe/redacted.
    - [ ] No Clerk tokens, guest capabilities, receipts, or secrets appear in logs.
  - **Tests/evidence:** Log/redaction review and failure drill.

- [ ] **CORE-102 — Complete backup/restore rehearsal for core rental data**
  - **Depends on:** Stable schema/migrations.
  - **Outcome:** Team has evidence that catalogue/reservation/allocation/custody history survives recovery.
  - **Acceptance:**
    - [ ] Restore a disposable database from documented backup path/process.
    - [ ] Re-run migrations safely.
    - [ ] Verify reservation/allocation/custody referential integrity after restore.
    - [ ] Record gaps against proposed RPO/RTO rather than claiming unproven guarantees.
  - **Tests/evidence:** Recovery tabletop/rehearsal notes.

## Phase 11: Documentation and pilot gate

- [ ] **CORE-110 — Remove or clearly isolate core mock data**
  - **Depends on:** CORE-080.
  - **Outcome:** Production paths cannot accidentally fall back to prototype arrays.
  - **Acceptance:**
    - [ ] Clothing mock data removed from production page path.
    - [ ] Reservations mock data removed.
    - [ ] Availability seed/mock data removed from production path while retained only in tests/dev fixtures as appropriate.
    - [ ] Schedule mock agenda/detail data removed.
    - [ ] Dashboard mock data removed.
  - **Tests/evidence:** Source search plus production build review.

- [ ] **CORE-111 — Update canonical docs to implemented behavior**
  - **Depends on:** CORE-110.
  - **Outcome:** PRD/TRD/Data Model/ERD and implementation no longer diverge on the core slice.
  - **Acceptance:**
    - [ ] Any accepted implementation-driven correction is promoted from Second Brain into authoritative docs.
    - [ ] Second Brain remains navigation/memory layer, not competing source of truth.
    - [ ] Deferred V1.1/V2 scope remains labeled.
  - **Tests/evidence:** Documentation review and link lint.

- [ ] **CORE-112 — Core rental operations release gate**
  - **Depends on:** CORE-090 through CORE-111.
  - **Outcome:** Team may resume building additional sidebar modules only after core rental operations are demonstrably reliable.
  - **Acceptance:**
    - [ ] Contracts build/typecheck passes.
    - [ ] API unit/integration/RLS/concurrency suites pass.
    - [ ] App unit/component/e2e tests pass for core surfaces.
    - [ ] Typecheck/lint/build results are recorded; known unrelated failures are explicitly tracked rather than hidden.
    - [ ] Canonical happy path and adversarial scenarios pass.
    - [ ] Zero known duplicate allocation/posting defect in tested core flow.
    - [ ] Zero known critical tenant/privacy isolation defect.
    - [ ] Product owner/team reviews real vertical slice before Customers/Fittings/Payments/Storefront expansion continues.
  - **Tests/evidence:** Release checklist artifact with exact commands/results/date.

## Recommended implementation order

1. [[Clothing Checklist]]
2. [[Reservations Checklist]] through real allocation/confirmation
3. [[Availability Checklist]]
4. [[Schedule Calendar Checklist]]
5. Reservations pickup/return/readiness completion
6. [[Dashboard Checklist]]
7. This file’s adversarial, security, performance, recovery, and release phases

## Deferred until after the core gate

- Customer management beyond what core reservation identity requires.
- Full Payments management UI beyond V1 reservation evidence/settlement dependencies.
- Fittings — V1.1.
- Storefront management expansion unless required to prove the current booking flow.
- Advanced settings, analytics, multi-branch, native mobile, AI features, marketplace behavior.
