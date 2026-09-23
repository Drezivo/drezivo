---
title: Reservations V1 End-to-End Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-23
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

- [x] **RSV-000 — Audit reservation schema and migration readiness**
  - **Depends on:** Clothing catalogue model available.
  - **Outcome:** Existing reservation, line, allocation, customer, payment/evidence, custody, and disruption schema is mapped before adding code.
  - **Acceptance:**
    - [x] Identify existing tables/constraints and missing V1 pieces.
    - [x] Confirm one reservation line maps to one serialized garment in V1.
    - [x] Confirm allocation period uses finite nonempty half-open ranges.
    - [x] Confirm exclusion constraint/index strategy exists or has a forward migration plan.
    - [x] Confirm canonical status values match PRD/Data Model exactly.
  - **Audit findings:** `0003_availability_exclusion.sql`, `0004_reservations.sql`, `0005_finance.sql`, `0008_rls_policies.sql`, and `api/src/db/schema/reservations.ts` already provide the core V1 reservation graph: customer, reservation, reservation_line, asset_allocation, custody_event, disruption, guest capability, payment/evidence, and immutable financial-history primitives. `reservation_line` has no quantity field; one line may have at most one current blocking `asset_allocation`, and the allocation identifies the exact serialized `physical_asset`. Blocking periods are finite, nonempty, half-open `[)` `tstzrange` values. PostgreSQL GiST exclusion prevents overlapping blocking allocations for the same tenant/asset, and reservation states exactly match the canonical nine-state PRD/Data-Model vocabulary. RLS is forced for reservation-owned tables and custody facts are append-only for the runtime roles.
  - **Forward migration/reconciliation items for RSV-002 and later dependent work:** the persisted `reservation.event_date` is currently `timestamptz` even though the canonical model/wire contract treats event date as date-only; same-tenant relationship enforcement still relies on ordinary FKs + RLS/service checks rather than the stronger tenant-paired FK strategy; reservation list/schedule query indexes are incomplete beyond current status/customer/hold-expiry indexes; and the existing Finance contract status vocabulary must be reconciled with the persisted V1 finance migration before RSV-010/RSV-031 consume payment projections as production truth. No historical migration was edited in Phase 0.
  - **Tests/evidence:** Source/schema review against TRD §5 and Data Model §§5–7. Existing migration constraints prove `asset_allocation_no_overlap`, `asset_allocation_one_blocking_per_line`, bounded `[)` periods, tenant-unique reservation references, forced tenant RLS, and append-only `custody_event` privileges. Database corrections are intentionally deferred to forward-only RSV-002 work.

- [x] **RSV-001 — Define reservation contracts and stable errors**
  - **Depends on:** RSV-000.
  - **Outcome:** Shared schemas own reservation requests/responses before API routes.
  - **Acceptance:**
    - [x] Define list/detail projections used by Reservations page and detail Sheet.
    - [x] Define create staff/walk-in request, confirm, reschedule, cancel, pickup, return, complete, and evidence commands required by V1.
    - [x] Define customer/contact snapshot input and event/pickup/due dates using explicit timezone-safe fields.
    - [x] Reject client-supplied tenant/branch authority, computed price totals, allocation IDs, server status transitions, and payment verification authority.
    - [x] Add stable errors for conflict, hold expiry, stale version, invalid transition, asset unavailable, payment prerequisite failure, unready asset, and foreign resource concealment.
  - **Implemented contract boundary:** `contracts/src/reservations/` now owns strict staff/guest intake, bounded list query/response, shared staff detail projection, immutable line/customer/money snapshot projections, and version-guarded submit/confirm/reject/reschedule/cancel/pickup/return/complete requests. Staff creation explicitly supports either an existing `customer_id` or new customer details with at least one phone/email contact, while guest checkout keeps the canonical email requirement. Browser-supplied tenant/branch/asset/allocation/total/status authority is rejected. Evidence upload continues to reuse the Finance `paymentReceiptSubmitRequest` rather than duplicating payment verification authority inside Reservations.
  - **Stable errors:** existing `CAPACITY_CONFLICT`, `STALE_VERSION`, `IDEMPOTENCY_KEY_REUSED`, and concealed `NOT_FOUND` remain canonical; Phase 0 adds `HOLD_EXPIRED`, `INVALID_RESERVATION_TRANSITION`, `ASSET_UNAVAILABLE`, `ASSET_UNREADY`, and `PAYMENT_PREREQUISITE_FAILED`, with matching typed API errors using safe 409 responses.
  - **Tests/evidence:** `contracts/tests/reservations.test.ts` passes `11/11`, covering the exact nine reservation states, strict staff/guest create schemas, existing-vs-new customer input, authority-field rejection, date-only event date vs instant booking interval semantics, bounded list windows, authoritative detail/custody/payment separation, positive concurrency versions, evidence-authority rejection, and stable error codes. Full contracts regression passes `85/85`; contracts lint/build pass; API units pass `82/82`; API typecheck/lint pass. The broader contracts `typecheck` command remains blocked by the repository's pre-existing `openapi/generate.ts` Zod/OpenAPI type-version incompatibility; the source-only build tsconfig compiles the reservation contracts successfully. No reservation service/route or database behavior was enabled in RSV-001.

- [x] **RSV-002 — Define reservation database constraints and indexes**
  - **Depends on:** RSV-000, RSV-001.
  - **Outcome:** Database protects core booking invariants under concurrency.
  - **Acceptance:**
    - [x] GiST exclusion prevents overlapping blocking allocations for the same tenant/asset.
    - [x] Partial unique constraint prevents more than one current blocking allocation per reservation line.
    - [x] Reservation reference code is tenant safe and unique as required.
    - [x] Same-tenant FKs protect reservation/line/customer/storefront/policy/payment method relationships.
    - [x] Indexes support tenant status/date/customer/reference listing and schedule projections.
    - [x] Runtime role cannot bypass RLS or mutate immutable history tables unsafely.
  - **Implemented:** forward migrations `0031_reservation_phase0_integrity.sql` and `0032_reservation_parent_tenant_integrity.sql` keep historical migrations immutable while normalizing `reservation.event_date` to PostgreSQL `date`, adding tenant-paired parent keys/FKs for storefront → branch, policy snapshot → storefront, reservation → branch/customer/storefront/policy/payment method, and reservation line → reservation/variant. Reservation policy selection is additionally bound to the exact selected storefront. Staff-list/schedule indexes cover tenant+status+pickup, pickup, due, event date, and customer+created ordering; the existing tenant/reference unique key remains authoritative for reference lookup/uniqueness. Drizzle schema metadata mirrors the new date/FK/index shape.
  - **Tests/evidence:** `api/tests/integration/reservation-phase0-integrity.test.ts` passes `8/8` against real PostgreSQL, proving date/index shape, cross-tenant parent/child rejection, policy/storefront consistency, tenant-local reference uniqueness, concurrent GiST overlap exclusion, one-current-block-per-line replacement semantics, forced RLS concealment, `NOBYPASSRLS`, and revoked custody UPDATE/DELETE privileges. Existing catalogue suites that seed reservation/allocation history pass sequentially `26/26` after the migration, proving the stronger constraints preserve Clothing lifecycle/history behavior.

## Phase 1: Reservation read model

- [x] **RSV-010 — Implement reservation list query**
  - **Depends on:** RSV-001, RSV-002.
  - **Outcome:** `/reservations` renders authoritative tenant reservations with bounded pagination.
  - **Acceptance:**
    - [x] Search supports reference, customer-safe fields, clothing identity, and allowed phone/contact projection where authorized.
    - [x] Filters support canonical reservation status and bounded date windows.
    - [x] Pagination/sorting are deterministic and server-side.
    - [x] List projection includes only safe summary fields required by UI.
    - [x] Payment projection is separate from reservation status.
  - **Implemented:** authenticated `GET /api/v1/reservations` now resolves the active tenant/branch on the server, requires the existing-rental lifecycle policy plus `reservations.manage`, validates the shared bounded query contract, and executes one tenant-and-branch-scoped PostgreSQL read inside `withTenantTransaction`. Search covers reservation reference, snapshotted customer name/phone/email, the accepted clothing line name, and catalogue identity fields used operationally (style code/name, variant SKU, and allocated asset code) without returning those extra search-only fields. Canonical status and paired pickup-window filters execute server-side. Sorting uses opaque keyset cursors with reservation ID tie-breakers for `pickup_asc`, `pickup_desc`, `created_desc`, and `reference_asc`; malformed or sort-mismatched cursors fail closed. The response exposes only the shared summary DTO: snapshot-safe customer/contact, first V1 reservation line, fulfillment, dates, snapshotted money, version, and a separate nullable payment/evidence projection. Anonymous short holds remain representable with a null customer snapshot rather than fabricated contact data.
  - **Payment reconciliation prerequisite:** forward migration `0033_reservation_payment_projection_alignment.sql` reconciles the persisted payment lifecycle to `pending/partially_paid/paid/failed/refunded` and receipt rows to the canonical post-upload evidence states (`uploaded/under_review/verified/rejected/superseded`) before this list exposes those values. Historical `verified` maps to `paid`; historical `voided` maps conservatively to `failed`, not `refunded`, because it does not prove money left the merchant. The remaining shared evidence states are derived only when no receipt exists: `not_required` for cash and `awaiting_upload` for manual QR/transfer. `0034_reservation_list_read_indexes.sql` adds keyset-sort and tenant-aware search indexes without changing historical migrations.
  - **Tests/evidence:** `api/tests/integration/reservation-list-read-model.test.ts` now passes `7/7` against disposable PostgreSQL and the restricted runtime role; the original RSV-010 cases continue to cover reference/customer/clothing search, phone projection, status/date filtering, independent payment/evidence state, anonymous holds, deterministic multi-page cursors, cursor/sort mismatch rejection, cross-tenant concealment, active-branch isolation, unauthenticated/permission denial, bounded-window validation, and the real HTTP response envelope. `reservation-phase0-integrity.test.ts` remains green `8/8`; API typecheck/lint/build pass and API unit regression is `82/82`; Contracts reservation tests pass `12/12` and Contracts lint/build pass. `npm run openapi:generate` remains blocked by the pre-existing `@asteasolutions/zod-to-openapi`/Zod runtime incompatibility already recorded under RSV-001; no generated OpenAPI file was hand-edited.

- [x] **RSV-011 — Implement reservation detail query**
  - **Depends on:** RSV-010.
  - **Outcome:** Reservations and Schedule drawers show the same authoritative reservation record.
  - **Acceptance:**
    - [x] Detail includes reservation status, snapshots, line/clothing summary, pickup/due period, customer projection, delivery snapshot, safe payment/evidence state, and custody timeline.
    - [x] Historical line snapshots remain visible even after clothing edits/archive.
    - [x] Internal notes/financial evidence remain authorization scoped.
    - [x] Foreign reservation IDs are concealed.
  - **Implemented:** authenticated `GET /api/v1/reservations/:reservationId` now uses the same server-resolved tenant/active-branch context, existing-rental lifecycle gate, read rate limit, and `reservations.manage` capability as the list route. The repository first resolves a tenant-and-branch-scoped reservation header, then reads reservation-line snapshots and custody facts by the accepted reservation ID inside the same `withTenantTransaction`. Customer/contact, line name/measurements/prices, delivery method, money totals, event/pickup/due facts, lifecycle timestamps, version, and custody condition notes are projected from persisted reservation/custody snapshots rather than live catalogue/customer fields. The latest payment exposes only the shared safe payment/evidence status summary; receipt file IDs/storage keys, merchant destination details, payment-verification notes, and live `customer.notes` are not selected into this DTO. Missing, foreign-tenant, or foreign-branch reservation IDs converge on the same safe `NOT_FOUND` path; malformed IDs fail boundary validation.
  - **Historical behavior:** editing or archiving the live customer/product/variant after acceptance does not rewrite the detail response because the query does not join live customer/catalogue values for accepted facts. The only live identifiers retained are opaque foreign keys needed for authorized workflow continuity; displayed garment/customer facts come from reservation snapshots. Custody history is ordered deterministically by occurrence time plus immutable event ID and is branch-scoped in addition to tenant RLS.
  - **Tests/evidence:** `api/tests/integration/reservation-list-read-model.test.ts` passes `7/7`; RSV-011 cases prove full snapshot/detail projection, event/delivery/payment/evidence state, custody timeline, omission of private customer notes/payment evidence metadata/verification notes, historical customer and garment snapshot stability after live edits/archive, foreign-tenant and foreign-branch concealment, route authentication/permission enforcement, invalid-ID validation, and the HTTP success/error envelopes. `api/tests/integration/reservation-phase0-integrity.test.ts` remains `8/8`; API typecheck/lint/build pass and unit regression remains `82/82`; `contracts/tests/reservations.test.ts` passes `12/12` with Contracts lint/build green.

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

- [ ] **RSV-063 — Implement staff New Reservation workflow**
  - **Depends on:** RSV-010, RSV-011, RSV-020 through RSV-022, and authoritative Clothing/Availability reads.
  - **Outcome:** Owner and Front Desk can create a real reservation for a walk-in, phone, Messenger, Instagram, or other staff-received booking without sending the customer through the public storefront.
  - **Primary entry point:** `/reservations` owns the workflow and exposes `+ New Reservation`. Dashboard and Calendar may reuse the same creation component later, but they must not implement separate booking business logic.
  - **Acceptance:**
    - [ ] `/reservations` exposes a prominent `+ New Reservation` action for authorized Owner/Front Desk users.
    - [ ] The flow uses a large Sheet/drawer or equivalent multi-step staff workflow rather than redirecting staff into the public storefront.
    - [ ] Staff can search/select an existing customer or enter the minimum customer/contact details required to create a new customer safely.
    - [ ] Staff can search/select an active clothing product and variant using authoritative catalogue data.
    - [ ] Date selection shows canonical availability for the selected variant and branch before submission; the browser never treats this preview as the final booking guarantee.
    - [ ] Staff can enter rental/pickup/return dates, optional event date, fulfillment method, payment method/instructions, notes, and other V1-supported reservation inputs.
    - [ ] The server computes authoritative blocked interval, price/deposit/delivery totals, policy snapshot, and eligible serialized asset; the browser cannot choose final totals, allocation IDs, tenant/branch authority, or reservation status.
    - [ ] Successful creation calls the same RSV-021/022 quote/hold/allocation path used by staff booking semantics and atomically creates the reservation, line, immutable snapshots, and one blocking `asset_allocation`.
    - [ ] Shared submit guards and one idempotency key per user intent prevent double-click/retry from creating duplicate reservations or allocations.
    - [ ] Success keeps staff in the operations workspace, opens/shows the authoritative created reservation, and refetches affected Reservations, Availability, Schedule, Clothing, and Dashboard projections as those surfaces become available.
    - [ ] The creation component is reusable from Calendar with a prefilled date and from Dashboard as a Quick Action without duplicating reservation domain logic.
    - [ ] Fitting appointment creation is not included in this V1 workflow; fittings remain V1.1 until resource/capacity controls are implemented canonically.
  - **Tests/evidence:** Staff-creation component/browser tests plus real PostgreSQL/API integration proving customer create/select, canonical availability lookup, one serialized-asset allocation, duplicate-submit safety, permission enforcement, capacity conflict handling, and cross-surface source-ID consistency.

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
  - **Depends on:** RSV-063, RSV-070, RSV-071.
  - **Outcome:** Reservations are authoritative and ready to drive Calendar/Dashboard.
  - **Acceptance:**
    - [ ] Staff-created walk-in/manual booking and storefront-originated booking both converge on the same authoritative reservation/allocation lifecycle.
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
