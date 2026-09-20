---
title: Dashboard V1 End-to-End Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, v1, dashboard, operations, checklist]
---

# Dashboard V1 End-to-End Checklist

**Status:** Planned; current Dashboard overview is prototype/mock-data driven.
**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).
**Dependencies:** [[Reservations Checklist]], [[Availability Checklist]], and [[Schedule Calendar Checklist]].

## How to use this checklist

Implement in order. The Dashboard is an operational read model over canonical rental state. It must never become a duplicate database of counts or statuses.

Before marking a task complete:

- Every dashboard card/queue has a documented canonical source and exact predicate.
- Counts are tenant/branch scoped and authorization checked.
- Dashboard reads are bounded and indexed.
- Clicking a dashboard item resolves to the same Reservation/Clothing source shown elsewhere.
- Mutations triggered from dashboard delegate to domain services and use shared idempotency guards.
- Fitting metrics/actions remain V1.1 unless canonical scope changes.

## Non-negotiable outcomes

- Dashboard answers “What needs attention in my rental business now?”
- Pickups, returns, overdue/late issues, payment/evidence review, cleaning/maintenance, and reservation review derive from canonical source records.
- Dashboard does not store its own copy of reservation status.
- Same reservation has the same status/reference/customer/clothing facts across Dashboard, Reservations, and Calendar.
- Restricted/cancelled tenant lifecycle applies the shared action-policy gate; dashboard must not accidentally enable blocked actions.
- Summary metrics are operational aids, not premium analytics gates.

## Phase 0: Metric and queue definitions

- [ ] **DSH-000 — Define V1 dashboard metric dictionary**
  - **Depends on:** Reservation/Availability event taxonomy finalized.
  - **Outcome:** Each metric has one explicit query definition.
  - **Acceptance:**
    - [ ] Define active rentals/picked-up count.
    - [ ] Define pickups due today / upcoming window.
    - [ ] Define returns due today / upcoming window.
    - [ ] Define pending confirmation/evidence review count.
    - [ ] Define overdue/late-return issue count.
    - [ ] Define cleaning/maintenance/unready count where useful.
    - [ ] Remove/defer fitting metrics from real V1 unless V1.1 is canonically enabled.
    - [ ] Define timezone basis for “today”.
  - **Tests/evidence:** Product/architecture review with no ambiguous metric names.

- [ ] **DSH-001 — Define dashboard contracts**
  - **Depends on:** DSH-000.
  - **Outcome:** Shared contracts own dashboard summary and work-queue projections.
  - **Acceptance:**
    - [ ] Define summary counts DTO.
    - [ ] Define bounded “today/needs attention” item DTO with source IDs and safe display fields.
    - [ ] Define optional range/window inputs with strict bounds.
    - [ ] Reject browser-supplied tenant/branch authority.
  - **Tests/evidence:** Contract tests and bounded input validation.

## Phase 1: Dashboard read service

- [ ] **DSH-010 — Implement summary metric queries**
  - **Depends on:** DSH-001, Reservations read model.
  - **Outcome:** Dashboard metric cards reflect real tenant state.
  - **Acceptance:**
    - [ ] Resolve tenant/default branch from actor context.
    - [ ] Use database/server time with branch/reservation timezone semantics.
    - [ ] Counts use same predicates as Reservations/Schedule.
    - [ ] Query does not scan unbounded historical rows.
    - [ ] Restricted/cancelled tenant reads remain safe according to lifecycle policy.
  - **Tests/evidence:** Count consistency tests against seeded reservations.

- [ ] **DSH-011 — Implement operational work queue**
  - **Depends on:** DSH-010, Availability/Custody projections.
  - **Outcome:** Dashboard shows actionable pickups, returns, overdue/disrupted, review, and readiness work.
  - **Acceptance:**
    - [ ] Queue items are ordered by urgency/time with deterministic tie-breaker.
    - [ ] Each item exposes source type/source ID for drill-down.
    - [ ] No duplicate item for the same underlying action unless intentionally distinct.
    - [ ] Foreign/customer-sensitive details are minimized to what authorized staff needs.
    - [ ] Queue is bounded/paginated or capped with “View all” navigation.
  - **Tests/evidence:** Ordering/dedupe/isolation tests.

- [ ] **DSH-012 — Implement issue/disruption projection**
  - **Depends on:** Reservations late-return/disruption workflow.
  - **Outcome:** Needs Attention represents real operational risk rather than hard-coded mock alerts.
  - **Acceptance:**
    - [ ] Overdue pickup/return rules are explicit.
    - [ ] Unready asset threatening next reservation links to disruption source.
    - [ ] Payment/evidence review state remains distinct from operational custody state.
    - [ ] Resolved issues disappear according to canonical resolution state.
  - **Tests/evidence:** Late return/disruption/payment review fixtures.

## Phase 2: Dashboard UI integration

- [ ] **DSH-020 — Replace dashboard mock metrics**
  - **Depends on:** DSH-010.
  - **Outcome:** Existing metric cards use real API data.
  - **Acceptance:**
    - [ ] Loading/skeleton state avoids showing fake zeroes as authoritative data.
    - [ ] Error state is visible and retryable.
    - [ ] Theme toggle does not change semantic meaning of metric tones.
    - [ ] Metric labels match the dictionary exactly.
  - **Tests/evidence:** Component/browser tests with seeded tenant data.

- [ ] **DSH-021 — Replace dashboard mock activity/attention lists**
  - **Depends on:** DSH-011, DSH-012.
  - **Outcome:** Current operational lists/cards show real work items.
  - **Acceptance:**
    - [ ] Clicking reservation-related item opens/navigates to authoritative reservation detail.
    - [ ] Clicking clothing/readiness item opens authoritative Clothing/Availability context.
    - [ ] “View all” routes to the correct filtered Reservations/Calendar page.
    - [ ] No duplicate mock customer/clothing data remains.
  - **Tests/evidence:** Drill-down identity tests.

- [ ] **DSH-022 — Connect dashboard quick actions safely**
  - **Depends on:** Reservation mutation APIs.
  - **Outcome:** Allowed operational actions can be initiated from dashboard without duplicating business logic.
  - **Acceptance:**
    - [ ] Dashboard calls the same Reservation/Availability command endpoints as other surfaces.
    - [ ] Shared submit guard and one idempotency key per intent are used.
    - [ ] API rechecks permissions/state even if button is hidden/disabled.
    - [ ] Success refetches dashboard plus affected Reservations/Calendar/Clothing projections.
  - **Tests/evidence:** Double-fire and stale-state tests from dashboard entry point.

## Phase 3: Cross-surface consistency

- [ ] **DSH-030 — Prove Dashboard ↔ Reservations consistency**
  - **Depends on:** DSH-020, Reservations complete.
  - **Outcome:** Dashboard counts and items agree with Reservation queries.
  - **Acceptance:**
    - [ ] Confirming a reservation updates pending/confirmed counts correctly.
    - [ ] Pickup changes active rental/pickup queues consistently.
    - [ ] Return updates return/overdue queues consistently.
    - [ ] Cancellation/reschedule removes or moves old agenda work correctly.
  - **Tests/evidence:** Cross-surface integration tests.

- [ ] **DSH-031 — Prove Dashboard ↔ Schedule consistency**
  - **Depends on:** Schedule complete.
  - **Outcome:** Today/upcoming work on dashboard matches Calendar day/week projection.
  - **Acceptance:**
    - [ ] Same reservation event uses same local date/time.
    - [ ] Same issue does not have contradictory status across surfaces.
    - [ ] Calendar mutation/refetch updates dashboard without manual local patching.
  - **Tests/evidence:** Shared fixture/source-ID tests.

- [ ] **DSH-032 — Prove Dashboard ↔ Clothing/Availability consistency**
  - **Depends on:** Availability complete.
  - **Outcome:** Unready/maintenance/cleaning work reflects canonical clothing readiness/allocation state.
  - **Acceptance:**
    - [ ] Maintenance/manual block appears/disappears consistently.
    - [ ] Rented/returned/readiness projections agree with Clothing and Availability.
    - [ ] Dashboard never marks asset “available” solely because a queue item was cleared.
  - **Tests/evidence:** Cross-surface readiness tests.

## Phase 4: Performance and resilience

- [ ] **DSH-040 — Bound and index dashboard queries**
  - **Depends on:** DSH-010 through DSH-012.
  - **Outcome:** Dashboard loads quickly without N+1 or full-history scans.
  - **Acceptance:**
    - [ ] Summary queries are bounded to relevant current/future windows.
    - [ ] Queue query uses indexed tenant/status/date predicates.
    - [ ] Detail enrichment is batched; no per-row query loop for ordinary load.
    - [ ] Representative tenant scale includes 1,000 assets and realistic reservation volume.
  - **Tests/evidence:** Query-plan/load measurements.

- [ ] **DSH-041 — Handle partial dependency/read failures safely**
  - **Depends on:** DSH-020, DSH-021.
  - **Outcome:** Dashboard does not silently show stale/fake operational truth on backend failure.
  - **Acceptance:**
    - [ ] Failed summary/work queue shows explicit error/retry state.
    - [ ] No client fallback manufactures domain counts from stale local data.
    - [ ] Auth/context failure redirects/fails closed through shared staff resolver.
  - **Tests/evidence:** API failure/auth expiry UI tests.

## Phase 5: Completion evidence

- [ ] **DSH-050 — Complete dashboard tenant/security tests**
  - **Depends on:** All Dashboard API tasks.
  - **Outcome:** Dashboard cannot reveal another tenant/customer workload.
  - **Acceptance:**
    - [ ] Cross-tenant reads denied/concealed.
    - [ ] Missing actor context fails closed.
    - [ ] Restricted/cancelled tenants receive only lifecycle-allowed actions.
  - **Tests/evidence:** API/RLS authorization suite.

- [ ] **DSH-051 — Mark Dashboard vertical slice complete**
  - **Depends on:** DSH-030 through DSH-050.
  - **Outcome:** Dashboard is an authoritative operational entry point.
  - **Acceptance:**
    - [ ] Metrics, today work, and needs-attention lists use real data.
    - [ ] Drill-down opens the same Reservation/Clothing records as dedicated pages.
    - [ ] Mutations delegate to domain APIs and refresh all affected projections.
    - [ ] No production dashboard mock dataset remains.
    - [ ] Docs/checklist reflect implemented behavior.
  - **Tests/evidence:** API/app/e2e suite, typecheck, lint, build, browser walkthrough.

## Deferred from Dashboard V1

- Advanced business analytics/revenue intelligence.
- Real fitting metrics/work queues — V1.1.
- Multi-branch executive aggregation — V2.
- Predictive/AI operational recommendations.
