---
title: Reservations V1 End-to-End Checklist
type: implementation-checklist
status: planned
owner: Drezivo team
updated: 2026-09-25
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
- Staff/walk-in UX must stay simpler than the internal lifecycle: O/S should experience `Check availability → Reserve → Complete Reservation`, while the backend may still use `held → pending_confirmation → confirmed` and the 15-minute hold deadline.
- The initial timed hold remains valuable for staff-created bookings because it prevents an abandoned/incomplete walk-in flow from blocking a garment indefinitely; the UI should expose the remaining hold time without forcing O/S to understand every internal state transition.
- Public storefront checkout may expose more of the hold/submission/review lifecycle later, but staff and guest flows must converge on the same authoritative pricing/allocation rules rather than duplicating booking logic.
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

- [x] **RSV-020 — Implement quote and candidate asset resolution**
  - **Depends on:** Clothing CLT-050, Availability foundations.
  - **Outcome:** Server computes eligible garment candidates, blocked interval, price, and policy snapshot.
  - **Acceptance:**
    - [x] Resolve variant/product and candidate physical assets within tenant/default branch.
    - [x] Resolve pickup/due deadlines in booking timezone snapshot.
    - [x] Compute `[blocked_start, blocked_end)` as pickup through return plus post-return Recovery.
    - [x] Compute rental/deposit/delivery totals in PHP minor units on server.
    - [x] Do not promise availability from a stale read response.
  - **Implemented:** `reservations.quote.ts` is the shared server-side quote/candidate layer that RSV-021 will consume before any write. It resolves the server-selected V1 default branch, branch IANA timezone, storefront, latest already-effective immutable policy snapshot, active same-tenant payment method, active product/variant pricing/measurements, and concrete eligible serialized asset IDs. Catalogue derives the candidate query's half-open blocked interval from pickup through return plus the variant's post-return Recovery, filters overlapping blocking allocations, and orders/limits candidate IDs deterministically. The quote preserves the requested pickup/due instants plus the branch timezone snapshot and returns `capacity.guaranteed = false`; it does not select an authoritative asset, create a reservation/allocation, or expose an `available` promise. RSV-021 must lock and revalidate candidates before the exclusion-protected allocation insert.
  - **Money/policy behavior:** rental pricing is recomputed from the persisted variant tariff, never client totals. The configured base rental covers `included_duration_minutes`; elapsed time beyond that is charged in started 24-hour extra-day blocks at `extra_day_price_minor`. Security deposit and delivery are separate minor-unit lines and `due_now = rental + deposit + delivery`. V1 fails closed unless tenant/variant currency is PHP and current amounts fit the persisted PostgreSQL integer range. The PRD requires configurable delivery text/fees but did not previously define a machine key inside `policy_snapshot.delivery_rules`; RSV-020 establishes the internal convention `delivery_rules.fee_minor` for a nonnegative PHP minor-unit fee, treats an omitted fee as free delivery, and rejects delivery when `delivery_rules.enabled` is explicitly `false`. Pickup always has zero delivery fee. The selected policy row ID/version/effective time and payment-method destination/version are carried only in the internal quote for later snapshot persistence; no new public route exposes those private settings in RSV-020.
  - **Tests/evidence:** `api/tests/integration/reservation-quote.test.ts` covers fixed-duration rental + deposit + delivery totals, zero-write quote behavior, Recovery-only block derivation, exact `[)` adjacency versus one-minute overlap, an `America/New_York` DST transition while preserving UTC pickup/due instants and the booking timezone snapshot, stale candidate invalidation with `guaranteed: false`, restricted/default-branch guards, and foreign payment-method concealment. Current Phase-7 validation passes this suite `7/7`. The existing CLT-050 handoff, Reservation Phase 1, and Phase 0 integrity remain the underlying allocation/read safeguards.

- [x] **RSV-021 — Implement idempotent staff/walk-in reservation creation**
  - **Depends on:** RSV-020, RSV-002.
  - **Outcome:** One user intent creates one held/pending reservation graph and one authoritative allocation.
  - **Acceptance:**
    - [x] Lock candidate physical assets in deterministic ID order.
    - [x] Release expired holds safely using database time where required.
    - [x] Insert reservation, line, snapshots, blocking allocation, audit/idempotency outcome atomically.
    - [x] Exclusion conflict returns clean capacity conflict, not 500.
    - [x] Same idempotency key/same payload replays original result.
    - [x] Same key/different payload fails with stable conflict.
  - **Implemented:** `reservations.command.service.ts` turns the RSV-020 quote into one authoritative V1 booking transaction. It scopes idempotency by tenant + authenticated membership + operation + intent key and hashes the strict canonical request before any business effect. The transaction re-reads every active/ready physical asset for the selected tenant/default branch/variant, locks those asset rows in deterministic UUID order, releases already-expired `reservation_hold` allocations using `statement_timestamp()`, records the expiry audit/outbox facts, and rechecks the exact buffered `[)` range while the asset locks are held. The first still-free serialized garment is selected server-side; the browser never supplies the asset/allocation identity. A savepoint then encloses customer create/reuse plus reservation header, one reservation line, immutable customer/clothing/money/delivery/policy references, the `reservation_hold` allocation, staff audit event, `reservation.held` outbox event, and terminal idempotency response. The hold deadline is acquired from database time and expires 15 minutes later. New staff-entered email is normalized; live customer notes are retained on the customer record but are deliberately excluded from the reservation customer snapshot.
  - **Concurrency/idempotency behavior:** successful and known-failure outcomes are persisted in the tenant idempotency record, so same-key/same-payload retries replay the original 201 or 409 result without another graph; same key with a different canonical payload returns `IDEMPOTENCY_KEY_REUSED`. Competing different intents for the final garment serialize on the physical asset lock and produce one reservation/allocation winner and one stable `CAPACITY_CONFLICT`, with no loser customer/line/allocation orphan. The allocation insert remains protected by PostgreSQL `asset_allocation_no_overlap`; a raw `23P01` from that constraint is explicitly translated to `CAPACITY_CONFLICT`. Existing Phase-0/CLT-050 PostgreSQL tests remain the direct database proof that the GiST exclusion itself rejects overlapping blocking allocations.
  - **Expired-hold behavior:** reclaim is correctness work, not worker timing. A held reservation whose deadline has passed is versioned to `expired`, its blocking hold is flipped nonblocking with `released_at`, and `reservation.hold_expired` plus an append-only system audit event are written in the same transaction before capacity is reused. The outbox payload uses the existing worker vocabulary and carries `reservationVersion` for stale-notification checks.
  - **Tests/evidence:** `api/tests/integration/reservation-create.test.ts` passes `7/7` against real PostgreSQL/RLS, covering atomic new-customer creation, existing-customer snapshot reuse, sequential success replay, different-payload key reuse rejection, concurrent same-key duplicate collapse, last-garment contention with failed-result replay, database-time expired-hold reclamation, audit/outbox/idempotency persistence, buffered allocation range, and zero duplicate/orphan graphs. The database exclusion invariant remains proven by `reservation-phase0-integrity.test.ts` `8/8` and the CLT-050 handoff `3/3`.

- [x] **RSV-022 — Expose staff reservation create route**
  - **Depends on:** RSV-021.
  - **Outcome:** Staff app can create a reservation without duplicating business rules in Next.js.
  - **Acceptance:**
    - [x] Requires Clerk auth, local active membership, permission, tenant lifecycle gate, and idempotency key.
    - [x] Body validation is closed and size/rate limited.
    - [x] Client cannot choose authoritative asset allocation or final server price.
  - **Implemented:** authenticated `POST /api/v1/reservations` now resolves Clerk/local tenant/active-branch context, applies the `new_booking` tenant lifecycle policy, requires `reservations.manage`, enforces the shared `Idempotency-Key` schema, and accepts only the strict shared `staffReservationCreateRequest`. The route is capped at 30 writes/minute per resolved tenant/principal/IP and has a dedicated 16 KiB JSON parser before the global 256 KiB parser. Unknown authority fields such as `tenant_id`, selected asset/allocation IDs, client totals, or authoritative status fail closed at validation. The controller delegates to the single RSV-021 domain command and returns its idempotent success/failure envelope directly; Next.js owns no booking/allocation rule.
  - **Response boundary:** HTTP 201 returns the shared `staffReservationCreateResponse` only after the reservation/allocation/idempotency transaction commits. It includes the held reservation summary and safe configured payment method/name/rail plus the merchant instruction text when present; raw payment destination JSON is never returned. Optional signed QR-file URL resolution remains outside RSV-021/022 and can be added when the staff New Reservation UI consumes file-authorized payment imagery.
  - **Tests/evidence:** the RSV-021/022 integration suite covers unauthenticated 401, missing branch permission 403, restricted-tenant `TENANT_RESTRICTED`, missing idempotency 422, strict rejection of client authority fields, 16 KiB body rejection, successful HTTP 201, HTTP same-key replay, and HTTP same-key/different-payload 409. API typecheck/lint/build pass with unit regression `82/82`; RSV-020 remains `5/5`, Phase 1 `7/7`, Phase 0 `8/8`, CLT-050 `3/3`, and Contracts test/lint/build remain green at `87/87`.

- [x] **RSV-023 — Align staff hold creation with the walk-in fast path**
  - **Depends on:** RSV-022 and the approved staff walk-in UX.
  - **Outcome:** O/S can claim the garment before customer/contact entry is complete, while the same authoritative 15-minute hold/allocation path protects capacity.
  - **Acceptance:**
    - [x] Keep the authoritative 15-minute database-backed `held` allocation and existing concurrency/idempotency guarantees.
    - [x] Review the current staff create contract, which presently requires customer, variant/dates, fulfillment method, and payment method at hold creation, against the desired `Check availability → Reserve → Complete Reservation` sequence.
    - [x] If the UI cannot create the hold at the correct point with the existing contract, introduce the smallest contract/API adjustment needed for staff hold acquisition; do not weaken tenant, pricing, allocation, or customer-snapshot authority.
    - [x] Do not move payment verification, final totals, asset choice, reservation status, or tenant/branch authority to the browser merely to simplify the UI.
    - [x] Preserve one authoritative allocator for staff and future storefront checkout even if their intake contracts differ.
    - [x] Expired/incomplete staff holds remain reclaimable by database-time request checks and the worker.
  - **Implemented:** `staffReservationCreateRequest.customer` is optional only for the initial staff-held step, matching the canonical data model that permits a short hold without a customer row/contact. `POST /api/v1/reservations` still runs the same RSV-020 quote and RSV-021 allocator, so variant/date, fulfillment method, payment method, authoritative price/policy snapshots, physical-asset choice, 15-minute database deadline, GiST exclusion, audit/outbox, and idempotency remain unchanged. A customer-less staff hold persists `customer_id = NULL` and `customer_snapshot = NULL`; no placeholder customer is manufactured. Customer/contact becomes mandatory when the hold is submitted for confirmation, not when capacity is first claimed.
  - **Tests/evidence:** the Phase-3 branch carries the RSV-023 contract/API compatibility needed by RSV-032. Contract coverage proves omitted customer is accepted while `customer: null` and browser authority fields remain rejected. The complete PostgreSQL integration run (`33` files, `200/200`) includes reservation create/expiry/concurrency and the customer-less walk-in path; Contracts pass `89/89`, API unit/service tests pass `82/82`, and typecheck/lint/build are green.

## Phase 3: Pending confirmation and merchant approval

- [x] **RSV-030 — Implement submission/pending-confirmation transition**
  - **Depends on:** RSV-021.
  - **Outcome:** Complete customer/contact/terms/evidence moves a valid hold into review without changing allocation ownership.
  - **Acceptance:**
    - [x] Required customer/contact snapshot exists before `pending_confirmation`.
    - [x] Terms/evidence deadlines are validated against original hold boundary.
    - [x] Upload/evidence reference is tenant/reservation scoped.
    - [x] Duplicate submission is idempotent.
  - **Implemented:** authenticated/idempotent `POST /api/v1/reservations/:reservationId/submit` consumes the strict shared `{ version, terms_accepted: true }` contract, resolves the reservation only inside the active tenant/branch, and locks reservation → initial payment → latest receipt/file evidence → current asset/allocation before transition. Phase 3 tightens the RSV-021 graph by creating one pending initial payment intent atomically with a held reservation when `due_now_minor > 0` (`reservation:{id}:initial-payment`), which gives Finance/evidence uploads a stable tenant-scoped payment identity without marking money collected. A zero-due reservation deliberately omits the payment row rather than fabricating a positive collection solely to satisfy the Finance table constraint. Submission requires a complete snapshotted customer name plus at least one contact method. Cash needs no receipt; manual QR/transfer requires the latest receipt for that exact reservation payment to reference a same-tenant private `payment_receipt` file that is accepted, frozen, and pinned by object version/checksum. Uploaded evidence becomes `under_review`, never paid/verified.
  - **Deadline/allocation behavior:** database time is authoritative. Evidence must have been submitted strictly before the original 15-minute hold deadline, and the request itself must still beat that deadline. A successful submission sets `terms_accepted_at`/`submitted_at`, transitions `held → pending_confirmation`, and moves to a bounded review deadline without ever shortening the original 15-minute garment hold: `GREATEST(original_hold_expires_at, LEAST(hold_acquired_at + 24 hours, pickup_at))`. Request-time expiry atomically marks the reservation expired, releases the block, and records audit/outbox; the cleanup worker also sweeps overdue `pending_confirmation` rows under an explicit system actor. Same operation/key/payload replays the original response; key reuse with another payload fails through the shared idempotency contract.
  - **Tests/evidence:** `api/tests/integration/reservation-review.test.ts` passes `9/9` on real PostgreSQL/the restricted runtime role, including immutable QR evidence submission, unrelated-payment evidence rejection, original-deadline enforcement, exact database-time expiry/release, duplicate submission replay, zero-due/no-fabricated-payment handling, strict route validation/idempotency, and foreign-ID concealment. Phase 2 create remains `7/7`, quote `5/5`, Phase 1 reads `7/7`, Phase 0 integrity `8/8`, and CLT-050 handoff `3/3`.

- [x] **RSV-031 — Implement merchant confirmation/rejection**
  - **Depends on:** RSV-030 and payment/evidence verification boundary.
  - **Outcome:** Authorized staff confirms only an eligible reservation and preserves allocation truth.
  - **Acceptance:**
    - [x] Lock reservation/payment/evidence/assets in documented deterministic order.
    - [x] Compare review deadline using database time.
    - [x] Verify actual merchant-account/cash evidence state; screenshot alone is insufficient.
    - [x] `pending_confirmation → confirmed` keeps same allocation blocking interval.
    - [x] Rejection releases block according to policy and records immutable decision/audit.
    - [x] Repeated approval/rejection returns prior result or clean conflict.
  - **Implemented:** `POST /api/v1/reservations/:reservationId/confirm` and `/reject` use the same write-rate/idempotency boundary, require `reservations.manage` plus merchant financial authority (`payments.manage` and `evidence.verify`), and recheck state/version server-side. The command lock order is reservation → canonical initial payment → latest receipt → latest immutable verification decision → physical asset/allocation ordered by asset UUID. All deadline comparisons use PostgreSQL time. Forward migration `0035_payment_verification_decision_alignment.sql` reconciles the persisted Finance decision vocabulary to the canonical `verified/rejected/ask_info` contract (`approved → verified`) before Reservations consumes it.
  - **Finance authority boundary:** RSV-031 does **not** manufacture payment verification from a screenshot or mutate an uploaded receipt into proof of money. When money is due, confirmation consumes Finance-owned authoritative state: payment must be `paid` with `verified_at`, correct currency, and enough verified amount; the latest immutable `payment_verification` must be `verified` for at least the amount due now. A genuinely zero-due reservation has no collection prerequisite and no synthetic payment/verification row. Manual QR/transfer additionally requires the frozen receipt evidence itself to be `verified`; an `uploaded`/`under_review` screenshot fails `PAYMENT_PREREQUISITE_FAILED`. Cash does not require a receipt but still requires the paid payment plus the immutable merchant verification decision. The separate Finance receipt/verification workflow remains the authority that creates those facts.
  - **Allocation/rejection behavior:** confirmation changes only the existing allocation kind from `reservation_hold` to `reservation_confirmed`; its exact `[blocked_start, blocked_end)` interval stays unchanged and remains blocking. Rejection conditionally transitions `pending_confirmation → rejected`, releases that block in the same transaction, and stores the bounded merchant reason in append-only audit metadata plus a deduplicated outbox event. Mutation effects use savepoints so later failures do not leave partial state, while deadline expiry itself commits atomically with its allocation release. Repeated same-intent approval/rejection replays the saved result; stale/different intent returns the canonical conflict path.
  - **Tests/evidence:** the same RSV-030/031 PostgreSQL suite passes `9/9`, proving screenshot-only confirmation denial, verified QR confirmation, verified cash confirmation, zero-due confirmation without fabricated finance facts, exact allocation-period preservation, audited rejection/release, same-key confirmation/rejection replay, concurrent confirmation double-fire, and confirmation-vs-expiry with one final expired outcome. Route coverage also proves missing idempotency 422, strict-body rejection, successful submit/confirm/reject, confirm replay/key-reuse behavior, missing merchant verification permission 403, unauthenticated 401, and foreign reservation concealment 404. API typecheck/lint/build pass with unit regression `82/82`; Contracts remain `87/87` with lint/build green.

- [x] **RSV-032 — Align held-to-confirmed behavior with the staff walk-in completion action**
  - **Depends on:** RSV-030, RSV-031, RSV-023.
  - **Outcome:** The backend keeps its safe hold/review/confirmation model, while one O/S-facing `Complete Reservation` action can progress as far as the current actor and Finance state legitimately allow.
  - **Acceptance:**
    - [x] Keep `held → pending_confirmation → confirmed` as authoritative server transitions; the UI simplification must not add a client-controlled direct status jump.
    - [x] Define the walk-in completion orchestration explicitly: submitting a complete held reservation is the first effect; if the authenticated O/S also has merchant verification authority and Finance prerequisites are already satisfied, the workflow may continue to confirmation without a second visible staff step.
    - [x] If payment/evidence still requires merchant review, `Complete Reservation` ends truthfully in `pending_confirmation` and the UI explains the remaining action rather than pretending the reservation is confirmed.
    - [x] Screenshot upload alone never auto-confirms; payment verification authority remains Finance-owned.
    - [x] Each underlying mutation retains its own idempotency intent. If submit succeeds but confirm cannot proceed, retry resumes from the authoritative `pending_confirmation` state rather than creating/re-submitting another reservation.
    - [x] Hold/review expiry continues to use database time and the existing worker/request-time enforcement.
    - [x] Owner/Front Desk permission differences are reflected in available actions without moving authorization decisions into the UI.
  - **Implemented:** authenticated `POST /api/v1/reservations/:reservationId/complete-booking` is the staff-facing orchestration boundary for the UI's single `Complete Reservation` intent. It requires the ordinary reservation-management permission, then composes the existing RSV-030 submit and RSV-031 merchant-confirm commands rather than introducing a direct lifecycle jump. A customer-less RSV-023 hold may carry the selected existing/new customer in the completion request; submission resolves/creates that customer and binds the immutable customer snapshot inside the same savepoint as the `held → pending_confirmation` transition, so a failed submission does not leave a half-bound reservation/customer effect. If the reservation already has a customer snapshot, completion cannot silently replace it.
  - **Authority/result behavior:** a Front Desk actor can complete submission but, without `payments.manage` + `evidence.verify`, receives a successful authoritative `pending_confirmation` response with `next_action = merchant_review`. An authorized Owner/merchant actor continues to RSV-031 confirmation only when Finance-owned verification already satisfies the payment/evidence prerequisite; otherwise the same visible action returns `pending_confirmation` with `next_action = payment_verification`. Manual QR/transfer screenshot upload alone only reaches review and never reports `confirmed`. A later completion intent using the current pending version can continue after Finance verification without re-submitting. The response contract permits only truthful `pending_confirmation` or `confirmed` states and requires `completion_state` to match the returned reservation status.
  - **Idempotency/race behavior:** the visible completion key deterministically derives separate URL-safe child intent keys for submit and confirm, preserving each existing command's operation-scoped idempotency record instead of weakening them into one ambiguous key. Same-key/same-body retries replay safely even after the first call has already reached `pending_confirmation`; same key with changed payload is rejected as `IDEMPOTENCY_KEY_REUSED`. Concurrent completion double-fire produces one submit effect and one confirmation effect. Request-time database deadlines and the existing expiry worker remain authoritative; an expired hold releases capacity instead of attaching customer/confirming. Foreign/missing reservation IDs remain concealed as the established `404`.
  - **Tests/evidence:** `api/tests/integration/reservation-review.test.ts` passes `16/16` on real PostgreSQL and covers owner fast-complete, Front Desk merchant-review fallback, owner payment-verification fallback, manual-QR screenshot denial, retry/resume after partial progression, same-key replay/key-reuse, database-time expiry/release, concurrent double-fire, strict route body/idempotency/auth, and foreign-ID concealment. Full API integration passes `33` files / `200/200`; API unit/service passes `20` files / `82/82`; Contracts pass `11` files / `89/89`; API/Contracts typecheck, lint, and build are green.

## Phase 4: Reschedule and cancellation

- [ ] **RSV-040 — Implement atomic reschedule — DEFERRED TO V1.1**
  - **V1 decision:** Staff rescheduling is not required for the pilot. If dates must change, O/S cancels the existing pre-handover reservation and creates a new reservation after rechecking availability. Do not let RSV-040 block V1 pickup/return/staff UI work.
  - **Future outcome:** When V1.1 introduces first-class reschedule, new dates must be acquired safely before the old allocation is released.
  - **Deferred acceptance:** deterministic old/new locks, authoritative re-quote/policy acceptance, atomic replacement allocation, rollback preserving the original booking, and idempotent concurrency tests.

- [x] **RSV-041 — Implement simple O/S cancellation**
  - **Depends on:** RSV-031, RSV-032.
  - **V1 scope:** Business-side Owner/Staff cancellation only. Drezivo does not expose a customer/storefront cancellation endpoint in V1. A customer who wants to cancel contacts the rental business directly (for example through Facebook/Messenger/phone), and O/S decides how to handle any refund or payment follow-up before recording the operational cancellation.
  - **Outcome:** O/S can immediately release a pre-handover garment when a booking is abandoned/cancelled, without pretending Drezivo has automatically resolved refunds.
  - **Acceptance:**
    - [x] Authenticated O/S with `reservations.manage` can conditionally cancel `held`, `pending_confirmation`, or `confirmed` reservations.
    - [x] Cancellation releases the current blocking `reservation_hold`/`reservation_confirmed` allocation transactionally and records `released_at`; staff does not wait for the hold-expiry worker when they intentionally abandon the booking.
    - [x] Existing payment, receipt, and verification history is preserved unchanged. If money was partially/fully collected or verified, the cancellation audit marks `financial_followup_required = true`; no refund amount/status is accepted from the cancellation request and no automatic refund is attempted.
    - [x] `picked_up`, `returned`, `completed`, `expired`, `rejected`, and already-`cancelled` reservations cannot be cancelled through this pre-handover command; picked-up rentals must go through return/settlement.
    - [x] Database-time expiry wins for an overdue `held`/`pending_confirmation` reservation, releasing capacity as `expired` rather than rewriting history as a cancellation.
    - [x] Same-key retries/concurrent double-fire produce one cancellation effect; key reuse with a different request remains a conflict.
    - [x] `POST /api/v1/reservations/:reservationId/cancel` is staff-authenticated, tenant/branch scoped, lifecycle-gated as settlement, strictly validated, rate limited, idempotency protected, and conceals foreign reservation IDs. There is no matching public/storefront cancellation route.
  - **Implemented:** `reservations.cancellation.service.ts` locks the reservation, canonical initial payment (when present), then current allocation/assets; accepts only pre-handover states/version; releases the blocking allocation and conditionally sets `cancelled` in one transaction; appends immutable `reservation.cancelled` audit/outbox facts; and leaves Finance rows untouched. Audit metadata records the previous reservation/payment state plus whether manual financial follow-up may be required, without storing customer-facing refund promises.
  - **Tests/evidence:** `api/tests/integration/reservation-review.test.ts` covers cancellation from held/pending/confirmed, immediate capacity release, paid-payment preservation/manual-follow-up flag, picked-up rejection, database-time expiry, concurrent duplicate cancellation, route auth/strict-body/idempotency/tenant concealment, explicit absence of a public/storefront cancellation route, and rejection of browser-supplied refund authority. Focused reservation review/cancellation suite passes `19/19`; full API integration passes `33` files / `205/205`; API unit/service passes `20` files / `82/82`; Contracts pass `11` files / `89/89`; API/Contracts typecheck, lint, and build are green.

## Phase 5: Pickup, return, inspection, and completion

- [x] **RSV-050 — Implement pickup/handover command**
  - **Depends on:** RSV-031, Clothing readiness projection.
  - **Outcome:** Confirmed reservation becomes physically handed over only when garment/payment/policy prerequisites pass.
  - **Acceptance:**
    - [x] Lock reservation and current asset projection.
    - [x] Require confirmed state, matching active allocation, physical presence/readiness, and permission.
    - [x] Record append-only custody event with actor/time/condition snapshot/business key.
    - [x] Conditionally transition `confirmed → picked_up` once.
    - [x] Duplicate handover creates one custody fact/effect.
  - **Implemented:** authenticated/idempotent `POST /api/v1/reservations/:reservationId/pickup` requires `reservations.manage` + `reservations.custody`, validates the strict shared `{ version, condition_note? }` contract, and locks reservation → canonical payment → latest receipt → latest immutable payment verification → confirmed allocation/physical asset in the existing deterministic order. Pickup requires the reservation to still be `confirmed` at the supplied optimistic version; its accepted customer/terms/confirmation facts must still exist; the reservation must still own exactly one blocking `reservation_confirmed` allocation; and the allocated serialized garment must be `active`, `ready`, assigned to the active branch, and physically `at_branch`. When money is due, pickup rechecks the same Finance-owned paid/verified amount and immutable verification truth used for confirmation; manual QR/transfer additionally requires verified immutable receipt evidence, while genuine zero-due reservations require no fabricated payment.
  - **Custody/allocation behavior:** the winning transaction conditionally changes `confirmed → picked_up`, changes the locked physical asset custody projection `at_branch → with_customer` with an asset-version guard, and appends one immutable `pickup` `custody_event` containing the actor membership, database time, bounded condition note/snapshot, and stable business key. The existing `reservation_confirmed` allocation remains blocking with the same period and is not released/recreated. Audit/outbox facts use `reservation.picked_up`; Reservation Details immediately projects the new lifecycle state and pickup timeline. Sequential/same-intent concurrent retries replay one result and cannot create another custody fact.
  - **Failure behavior:** unready, inactive, wrong-branch, or not-at-branch garments fail closed with `ASSET_UNREADY`; missing/mismatched confirmed allocation fails with `ASSET_UNAVAILABLE`; degraded/missing payment verification fails with `PAYMENT_PREREQUISITE_FAILED`; stale versions and invalid lifecycle states use the existing stable conflicts. Any failure before commit leaves the reservation confirmed, physical custody unchanged, the allocation blocking, and no pickup custody event.
  - **Tests/evidence:** `api/tests/integration/reservation-review.test.ts` passes `23/23` on real PostgreSQL and covers successful pickup/custody/detail projection, unready garment denial, physically absent/in-transit denial, payment-refunded denial, sequential replay, concurrent double-fire with one custody/audit/outbox effect, strict body/idempotency/auth, missing `reservations.custody` permission, and foreign-ID concealment. Full API integration passes `33` files / `209/209`; API unit/service passes `20` files / `82/82`; Contracts pass `11` files / `89/89`; API/Contracts typecheck, lint, and build are green.

- [x] **RSV-051 — Implement return command**
  - **Depends on:** RSV-050.
  - **Outcome:** Actual return is always recordable even when late and threatening future bookings.
  - **Acceptance:**
    - [x] Lock current reservation/asset projection and record immutable return custody fact.
    - [x] Transition `picked_up → returned` once.
    - [x] Late actual return is not rejected because it conflicts with a future planned interval.
    - [x] Threatened future reservation creates/updates disruption workflow.
    - [x] Return does not automatically mark garment ready/available.
  - **Implemented:** authenticated/idempotent `POST /api/v1/reservations/:reservationId/return` requires `reservations.manage` + `reservations.custody`, uses the tenant `return` lifecycle gate, and accepts only the strict shared `{ version, condition_note? }` intent. The command locks the reservation and its current confirmed allocation/physical asset, requires the reservation to still be `picked_up` at the supplied optimistic version, and requires the same allocated garment to still be recorded in `with_customer` custody. Return deliberately does **not** re-run pickup payment/readiness prerequisites: once physical handover happened, changed Finance state, a late deadline, or a newly discovered garment issue cannot prevent Drezivo from recording that the customer physically returned the garment.
  - **Custody/readiness behavior:** the winning transaction conditionally changes `picked_up → returned`, moves physical custody `with_customer → at_branch`, and appends one immutable `return` `custody_event` with database time, actor membership, condition note/snapshot, and a stable business key. Return never marks the garment ready. A previously `ready` asset becomes generic `unready` pending inspection; a more specific existing non-ready state (`needs_cleaning`, `needs_repair`, or `unready`) is preserved. The existing `reservation_confirmed` allocation remains blocking with its original rental-plus-Recovery period and is not released merely because the garment arrived early or on time.
  - **Late-return/disruption behavior:** custody truth lives outside the overlap exclusion, so a late physical return is committed even when planned future capacity is already threatened. After the return fact exists, RSV-051 creates or updates an open `disruption` for another active held/pending/confirmed reservation on the same serialized garment when that future allocation window has already started by the actual return time. The disruption points back to the immutable return custody event and does not silently cancel, move, or promise fulfillment for the affected booking. Audit/outbox facts use `reservation.returned` and record whether the return was late plus how many disruption rows were affected.
  - **Idempotency/failure behavior:** same-key retries/concurrent double-fire produce one reservation transition, one asset custody update, one return custody event, and one audit/outbox effect. Same-key/different-body remains `IDEMPOTENCY_KEY_REUSED`; stale/invalid lifecycle state, foreign reservation, missing custody permission, or mismatched custody/allocation fail without partial return effects. Reservation Details immediately projects `returned` and the pickup→return custody timeline.
  - **Tests/evidence:** `api/tests/integration/reservation-review.test.ts` passes `28/28` against real PostgreSQL, including normal return/detail timeline, branch custody restoration with non-ready inspection state, Finance-changed return acceptance, preservation of `needs_repair`, late return with a return-linked future-booking disruption, sequential replay, concurrent double-fire, strict request/idempotency/auth, missing `reservations.custody`, and foreign-ID concealment. Full API integration passes `33` files / `214/214`; API unit/service passes `20` files / `82/82`; Contracts pass `11` files / `89/89`; API/Contracts typecheck, lint, and build are green.

- [x] **RSV-052 — Implement inspection/cleaning/settlement completion gate**
  - **Depends on:** RSV-051, Availability/Clothing readiness workflows.
  - **Outcome:** `returned → completed` happens only after operational and settlement requirements are satisfied.
  - **Acceptance:**
    - [x] Inspection records required cleaning/damage/readiness outcome.
    - [x] Cleaning remains covered by the booked Recovery block where applicable.
    - [x] Extra maintenance/manual block uses canonical allocation/work-order path.
    - [x] Deposit/refund/charge settlement state is checked without rewriting monetary history.
    - [x] Completion is conditional/idempotent.
  - **Implemented inspection boundary:** authenticated/idempotent `POST /api/v1/reservations/:reservationId/inspection` accepts only `{ version, readiness, condition_note? }` for a `returned` reservation. The actor needs reservation custody authority plus `assets.manage`. The command locks the returned reservation and its exact allocated serialized asset, requires the garment to be physically `at_branch`, then records the post-return condition by updating the asset readiness projection to one of `ready`, `needs_cleaning`, `needs_repair`, or `unready`. The immutable reservation audit records the before/after readiness, asset versions, actor/request, and whether a condition note was supplied. Inspection does not itself complete the rental and does not fabricate another custody event.
  - **Cleaning/maintenance behavior:** a normal `needs_cleaning`/`needs_repair` inspection leaves the existing `reservation_confirmed` allocation blocking, so the accepted Recovery period remains protected while post-return work is unresolved. Inspection cannot mark the asset `ready` while an open `maintenance_work_order` still exists. Extra cleaning/repair/manual downtime is intentionally not duplicated inside Reservations: staff uses the existing canonical Availability/Clothing maintenance work-order + allocation path, and `Complete Rental` refuses to close the reservation while any such work remains open.
  - **Settlement/completion boundary:** authenticated/idempotent `POST /api/v1/reservations/:reservationId/complete-rental` accepts only the optimistic reservation `version`. It requires `returned`, the same active confirmed allocation, branch custody, an active/`ready` garment, and zero open maintenance work. It then consumes Finance truth without rewriting it: unresolved collection state fails; append-only posted charges are netted against payment allocations/reversals; net security-deposit holding must be zero; and refund instructions must no longer be `requested`/`processing`. `charge`, `payment_allocation`, and `deposit_entry` remain append-only/read-only to Reservations, while the mutable refund workflow remains Finance-owned. A successful completion conditionally changes `returned → completed`, releases the old reservation blocking allocation exactly once (including a safe early release after readiness/settlement), and appends `reservation.completed` audit/outbox facts. Existing disruption records are not silently auto-resolved by completion.
  - **Tests/evidence:** `api/tests/integration/reservation-review.test.ts` passes `33/33` against real PostgreSQL, covering cleaning-first inspection, readiness gating, preservation of the booked block before completion, open maintenance preventing false readiness, posted damage-charge settlement, security-deposit holding/release, pending-refund blocking, successful settled completion/allocation release, concurrent Complete Rental double-fire, strict inspection/completion routes, permissions, and idempotency. Full API integration passes `33` files / `219/219`; API unit/service passes `20` files / `82/82`; Contracts pass `11` files / `89/89`; API/Contracts typecheck, lint, and build are green.

## Phase 6: Staff app integration

- [x] **RSV-060 — Replace Reservations page mock data**
  - **Depends on:** RSV-010.
  - **Outcome:** Reservation table/search/status/date filters/pagination use real API data.
  - **Acceptance:**
    - [x] Search/status/date controls query server-side.
    - [x] Loading/empty/error states are present.
    - [x] Pagination is bounded and stable.
    - [x] Dark/light UI does not alter domain state semantics.
  - **Implemented:** the staff `/reservations` page now consumes the shared `GET /api/v1/reservations` contract through `createDrezivoApiClient().getReservations(...)`; the previous in-memory reservation rows, fake dashboard metrics/counts, fake total pagination, fake export/filter actions, and mock Details Sheet were removed rather than mixed with authoritative rows. The list renders the server reservation reference, customer snapshot (including truthful customer-less short holds), garment snapshot, pickup/due dates, fulfillment method, independent payment/evidence state, and canonical reservation state. RSV-061 will reconnect row selection/Details Sheet through the real detail endpoint instead of reviving mock detail data.
  - **Filtering/pagination behavior:** free-text search and canonical reservation status are sent to the API, not filtered in browser memory. Inclusive pickup-date inputs are converted to the API's half-open instant window using the active branch timezone from actor context, validate both endpoints and the 31-day server limit before querying, and avoid issuing a transient browser-timezone request while branch context is still resolving. Filter state is reflected in the URL. Cursor pagination keeps the API cursor opaque, remembers prior page cursors client-side, and resets to page 1 whenever search/status/date filters change; no fake total count is displayed because the API intentionally exposes only keyset page metadata.
  - **UX/failure behavior:** the page has explicit loading, empty, filtered-empty, invalid-date, forbidden, retryable API-error, and request-ID states. Payment and reservation status remain text-labeled (never color-only), and no frontend-only state can manufacture customer/payment/reservation facts.
  - **Tests/evidence:** `app/tests/unit/drezivo-api-reservations-list.test.ts` + `app/tests/unit/reservations-page.test.tsx` pass `6/6`, covering query serialization/response validation, authoritative row rendering/no mock metrics, customer-less holds, server-side search/status filtering, branch-timezone date windows + >31-day rejection, opaque next/previous cursor behavior, and loading/empty/retryable-error states. `npm run typecheck` passes. `next build` compiles, prerenders `/reservations`, and completes page generation; its lint phase still reports the repository's pre-existing dependency mismatch where root `eslint-config-next@16.3.5` cannot resolve `next/dist/compiled/babel/eslint-parser` from the app's `next@15.5.24`, so dependency-version repair is intentionally left outside RSV-060.

- [x] **RSV-061 — Connect Reservation Details Sheet**
  - **Depends on:** RSV-011.
  - **Outcome:** Clicking a reservation row shows authoritative detail data.
  - **Acceptance:**
    - [x] Sheet is hidden initially and fetches/resolves selected reservation safely.
    - [x] Customer, garment, period, payment/evidence, verification, custody condition notes, and actions use real data. The current authoritative reservation-detail contract has no general reservation-notes field, so the frontend does not revive the old mock notes/address/social data.
    - [x] Actions shown are derived from current permissions/state, but API rechecks them.
  - **Implemented:** reservation rows are mouse- and keyboard-selectable and open a Radix Sheet that independently fetches `GET /api/v1/reservations/:reservationId` through the shared API client. The Sheet renders the persisted customer snapshot (including customer-less short holds), one-or-more reservation-line name/measurement/pricing snapshots, pickup/due/event/fulfillment facts, reservation price/deposit/due-now snapshot, independent payment/evidence/verification state, lifecycle timestamps, and the immutable pickup/return custody timeline with real condition notes. It uses the reservation's frozen timezone snapshot for historical date rendering rather than current browser time.
  - **Safety/permissions:** detail loading has explicit loading, 404, retryable failure, request-ID, close, and retry states; a detail failure does not clear or corrupt the reservations table. Switching/closing selection cancels the previous render path so a slower old response cannot replace the newer selected reservation. The active branch grant from server actor context drives visible lifecycle-action labels: `Complete Reservation`/`Cancel`, `Pick Up`, `Return`, `Inspect Return`, and `Complete Rental` appear only where the current reservation state and O/S capabilities make them potentially legal. These are informational in RSV-061; RSV-062 wires the actual mutations, and the API remains authoritative for payment/readiness/version prerequisites.
  - **Tests/evidence:** `app/tests/unit/reservations-page.test.tsx` + `app/tests/unit/drezivo-api-reservations-list.test.ts` pass `11/11`, covering detail endpoint validation, row-click and keyboard selection, authoritative customer/garment/measurement/payment rendering, permission/state-derived actions, real pickup→return custody notes, retryable detail failure without list corruption, and stale/older detail-response suppression after close/reselection. `npm run typecheck` passes.

- [x] **RSV-062 — Connect reservation mutations to UI**
  - **Depends on:** RSV-022, RSV-023, RSV-031, RSV-032, RSV-041, and RSV-050 through RSV-052. RSV-040 reschedule is deferred to V1.1 and does not block V1 UI integration.
  - **Outcome:** Staff can perform allowed lifecycle actions without mock state or being forced to manually operate every internal backend transition.
  - **Acceptance:**
    - [x] Shared submit guards prevent double click/keyboard duplicate mutations.
    - [x] One idempotency key per underlying intent is reused across retry; a visible `Complete Reservation` action may orchestrate more than one safe server transition but must never reuse one idempotency key for semantically different commands.
    - [x] UI actions are phrased in operational language (`Complete Reservation`, `Cancel`, `Pick Up`, `Return`, `Inspect Return`, `Complete Rental`) instead of exposing internal state-machine ceremony. `Reserve` remains part of RSV-063's New Reservation workflow rather than an existing-reservation mutation.
    - [x] When completion legitimately stops at `pending_confirmation`, the UI shows the payment/merchant-review requirement clearly and does not report success as `confirmed`.
    - [x] Success refetches the authoritative Reservations list and selected Reservation Details immediately. Calendar/Dashboard do not yet own a connected reservation client projection in Phase 6, so RSV-062 does not invent a cross-page cache; those surfaces consume current authoritative reservation state when their integrations are implemented.
    - [x] Conflict/stale-state/expired-hold responses explain what changed and refresh safely without automatically resubmitting the mutation.
  - **Implemented:** the authoritative Reservation Details Sheet now exposes real mutation controls for `Complete Reservation`, merchant-review `Reject Reservation`, `Cancel`, `Pick Up`, `Return`, `Inspect Return`, and `Complete Rental` only when the current state plus active-branch permission grant makes the action potentially legal. The frontend API client validates every request/response with shared Contracts and sends only user intent plus the optimistic reservation version; it never authors target status, payment truth, totals, tenant/branch authority, allocation IDs, or asset IDs. Customer-less `held` reservations cannot be completed from the Details Sheet because attaching the customer belongs to RSV-063's New Reservation flow.
  - **Idempotency/retry behavior:** every selected action uses the shared `useSubmitGuard`. Rapid double-click/keyboard submit fires one request. An unknown-outcome network retry reuses the exact same idempotency key while the body is unchanged; editing a reason, condition note, readiness choice, terms confirmation, or switching actions resets the intent and therefore gets a new key. Because the API idempotency ledger also replays resolved failures, a definitive server rejection with a request ID rotates to a new key for the next deliberate attempt. Stale-version/state-conflict/expired-hold/not-found responses close the old intent, rotate away from the old key, and refetch list/detail rather than retrying a changed optimistic version under the previous key.
  - **Truthful lifecycle UX:** `Complete Reservation` calls the RSV-032 orchestration endpoint rather than exposing separate Submit/Confirm buttons. A confirmed result says `Reservation confirmed`; a legitimate pending result says either `Awaiting payment verification` or `Awaiting merchant review`. Cancellation warns that Finance history/refund follow-up is preserved; pickup/return accept optional condition notes; inspection records only canonical readiness values; completion remains server-gated by readiness/maintenance/settlement. Server prerequisite errors remain visible with request IDs and do not fabricate a successful local transition.
  - **Tests/evidence:** `app/tests/unit/reservation-mutation-actions.test.tsx`, `app/tests/unit/reservations-page.test.tsx`, and `app/tests/unit/drezivo-api-reservations-list.test.ts` pass `20/20`, covering mutation endpoint/body/idempotency serialization, rapid double-submit suppression, same-key unknown-outcome network retry, fresh-key retry after a definitive server rejection, new key after body change, truthful pending-payment completion messaging, stale-version refresh without auto-retry, inspection readiness/condition intent, customer-less hold completion blocking, and authoritative list/detail refetch after success. `npm run typecheck` passes.

- [x] **RSV-063 — Implement staff New Reservation / walk-in fast-path workflow**
  - **Depends on:** RSV-010, RSV-011, RSV-020 through RSV-023, RSV-032, RSV-041, and authoritative Clothing/Availability reads.
  - **Outcome:** Owner and Front Desk can handle a walk-in, phone, Messenger, Instagram, or other staff-received booking through a simple operational flow while Drezivo retains the safe timed-hold and confirmation lifecycle underneath.
  - **Primary entry point:** `/reservations` owns the workflow and exposes `+ New Reservation`. Dashboard and Calendar may reuse the same creation component later, but they must not implement separate booking business logic.
  - **Required O/S mental model:** `Check availability → Reserve → Complete Reservation`. `held → pending_confirmation → confirmed` remains an internal/server lifecycle and should not become three separate mandatory screens or buttons for a normal walk-in.
  - **Acceptance:**
    - [x] `/reservations` exposes a prominent `+ New Reservation` action for authorized Owner/Front Desk users.
    - [x] The flow uses a large Sheet/drawer or equivalent focused workflow rather than redirecting staff into the public storefront.
    - [x] **Check availability:** O/S searches/selects an active clothing product/variant and rental dates using authoritative catalogue/availability data. If unavailable, the flow stops clearly without creating a reservation.
    - [x] Availability shown before reserve is advisory until the server allocation transaction succeeds; the UI never promises the garment merely from a read response.
    - [x] **Reserve:** once the minimum staff-hold inputs required by RSV-023 are present, O/S can claim the garment. Successful reserve creates the authoritative `held` reservation and blocking physical-asset allocation and starts the 15-minute database-backed hold.
    - [x] The active hold remains in the same Sheet/workflow; show a small, clear remaining-hold indicator such as `Garment reserved for 12:41` rather than a disruptive checkout-style countdown screen.
    - [x] O/S can complete/confirm the remaining customer details, fulfillment, payment method/instructions, optional event date/notes, and other V1-supported information without losing the already-acquired hold, subject to server validation and expiry.
    - [x] The server computes authoritative blocked interval, price/deposit/delivery totals, policy snapshot, and serialized asset; the browser cannot choose final totals, allocation IDs, tenant/branch authority, payment verification, or reservation status.
    - [x] **Complete Reservation:** present one primary completion action to O/S. It follows RSV-032: submit the valid held reservation and, only when the actor has authority and Finance prerequisites are already satisfied, progress to `confirmed` without requiring a second visible confirmation step.
    - [x] If merchant/payment review remains necessary, the same completion action truthfully ends at `pending_confirmation` and the UI changes to an actionable `Awaiting payment verification`/review state instead of pretending the booking is confirmed.
    - [x] Uploaded payment screenshots never visually imply `Paid` or `Confirmed` before authoritative verification. The current Finance module still has no receipt-submit API implementation, so RSV-063 deliberately does not fabricate an upload control; manual QR/transfer selection and payment instructions are supported, while evidence upload remains a Finance integration prerequisite.
    - [x] If the 15-minute hold expires while the Sheet is open, the UI disables stale completion, explains that the garment hold expired, refetches current availability, and lets O/S safely reserve again if capacity still exists.
    - [x] O/S may explicitly cancel/release an in-progress hold before expiry when the customer changes their mind; do not rely on the worker when the user intentionally abandons the booking.
    - [x] Shared submit guards and idempotency prevent double-click/retry from creating duplicate reservations, allocations, submissions, or confirmations.
    - [x] Success keeps O/S in the operations workspace, opens/shows the authoritative reservation, and refetches the connected Reservations projection immediately. Availability is refreshed on capacity/asset conflict; Calendar/Dashboard/other projections remain consumers of the same authoritative reservation IDs as those integrations are connected.
    - [x] The New Reservation component is self-contained/reusable so Calendar can later pass a prefilled date and Dashboard can reuse it as a Quick Action without duplicating reservation domain logic.
    - [x] Public storefront checkout may later use a more explicit customer-facing hold/payment/submission UX, but both flows converge on the same allocator, pricing, snapshots, and lifecycle authority.
    - [x] Fitting appointment creation is not included in this V1 workflow; fittings remain V1.1 until resource/capacity controls are implemented canonically.
  - **Implemented staff flow:** `/reservations` now exposes `+ New Reservation` when the active branch grants `reservations.manage`. The Sheet searches the real Catalogue with the requested pickup/return instants in the branch IANA timezone, selects an active product/variant, shows advisory `available_assets`, lets staff choose fulfillment/event date and one configured active payment method, then calls authoritative `POST /api/v1/reservations` without customer data. The successful server response supplies the real held reservation, frozen price/deposit/delivery facts, payment instructions, selected server-side variant/allocation result, and database-backed hold deadline. Staff then attaches either a tenant-scoped existing customer or a new customer and uses one `Complete Reservation` action against RSV-032. Closing an active hold is blocked until staff completes it or explicitly cancels/releases it.
  - **Safe intake read:** RSV-063 adds authenticated `GET /api/v1/reservations/intake-options`, guarded by tenant context, `new_booking`, `reservations.manage`, bounded query validation, and the normal read rate limit. It returns only active payment method `{ id, name, rail }` and up to 10 same-tenant customer matches `{ id, full_name, phone, email }`. Payment destination snapshots, QR-file IDs, customer notes, and other private/live fields are not projected. The payment method ID is required because the canonical hold contract already requires a server-recognized method; this endpoint closes that prior staff-UI discovery gap without weakening authority.
  - **Hold/conflict/recovery behavior:** the countdown is rendered from authoritative `hold_expires_at`, not from a browser-created deadline. A local timer expiry or server `HOLD_EXPIRED` disables stale completion and puts the Sheet into Start-over recovery. `CAPACITY_CONFLICT`/`ASSET_UNAVAILABLE` after an advisory availability read refreshes the catalogue preview and never pretends the garment was reserved. Reserve, Complete Reservation, and explicit hold cancellation each use separate `useSubmitGuard` intents/idempotency keys; unknown-outcome retry keeps the same intent while definitive server failures rotate the next deliberate attempt. Successful reserve/completion/cancel refreshes the connected reservation list and can hand the resulting reservation ID directly to the authoritative Details Sheet.
  - **Finance evidence boundary:** Cash can progress through the existing cash path. Manual QR/transfer can be selected and the safe payment instructions returned by Reservation creation are shown, but the repository currently contains only the shared `paymentReceiptSubmitRequest` contract and no implemented receipt POST route/service. Therefore the staff Sheet does not fake screenshot upload or mark evidence paid; attempting completion without required evidence truthfully surfaces the backend Finance prerequisite until that separate Finance endpoint is implemented.
  - **Tests/evidence:** `app/tests/unit/new-reservation-sheet.test.tsx` plus the Phase-6 reservation page/mutation/API-client tests pass `4` files / `27/27`, covering advisory availability, Manila branch-time conversion, customer-less Reserve, hold countdown, existing-customer completion, explicit cancel/release, unavailable stop, capacity-conflict preview refresh, database-side hold-expiry recovery, API request/idempotency serialization, and authoritative list/detail refresh behavior. `api/tests/integration/reservation-create.test.ts` passes `11/11` against real PostgreSQL, including the safe intake-options projection and auth/permission/restricted-tenant guards. Contracts pass `11` files / `90/90`; API unit/service passes `20` files / `82/82`; API/Contracts typecheck, lint, and build pass. The broader API integration regression passes `32` files / `219/219` with only the pre-existing catalogue scale-timeout file intentionally excluded. App typecheck and focused formatting pass; `next build` compiles and generates `/reservations`, while its lint phase still reports the pre-existing root `eslint-config-next@16.3.5` versus app `next@15.5.24` parser mismatch.

## Phase 7: Staff availability calendar and reservation intake hardening

- [x] **RSV-064 — Redesign New Reservation around product → variant → availability dependencies**
  - **Depends on:** RSV-063 and authoritative Catalogue/Availability reads.
  - **Outcome:** Staff chooses the garment and exact variant before date selection, so the calendar can show availability for the correct serialized-asset pool instead of asking for dates first.
  - **Acceptance:**
    - [x] Clothing selection is the first booking decision in the Sheet.
    - [x] Variant/size selection is required before availability appears.
    - [x] Staff selects a variant, not a physical asset; Drezivo resolves whether one serialized garment can satisfy the whole interval and later allocates one authoritative asset.
    - [x] Availability is variant-aware: if one Medium piece is busy but another Medium piece is free, Medium remains bookable.
    - [x] Changing product/variant resets dependent date/time/event/availability state rather than carrying stale values forward.
    - [x] Fulfillment and payment remain downstream of garment/date selection.
  - **Implemented:** `NewReservationSheet` now follows `Choose clothing → Choose size/variant → Rental period → pickup/return times → Event date + Fulfillment → Payment method → Reserve`. The selected variant summary shows fixed/daily pricing, deposit, piece readiness, post-return recovery timing, and extra-day pricing without exposing physical-asset choice to the browser.
  - **Tests/evidence:** focused New Reservation unit coverage verifies clothing/variant dependency ordering, reset behavior, fixed-duration guards, event-date bounds, authoritative API request shapes, and reserve/completion behavior.

- [x] **RSV-065 — Add variant-aware inline availability calendar and fixed-duration enforcement**
  - **Depends on:** RSV-064, RSV-020/021 availability/allocation rules.
  - **Outcome:** Staff can visually plan a rental from a full inline calendar while exact timestamp validation remains authoritative.
  - **Acceptance:**
    - [x] Use `react-day-picker` through a reusable shadcn-style Calendar primitive instead of a custom date engine or small popover picker.
    - [x] Calendar is inline/full-width in the reservation Sheet and supports month navigation plus range selection.
    - [x] Day availability is derived from the selected variant's serialized physical assets, not product-level status alone.
    - [x] `Available` means at least one eligible physical piece can cover that day; `Limited` means at least one piece is free but fewer than the ready piece count; `Unavailable / busy` means zero eligible pieces for that day.
    - [x] Calendar visuals use transparent/no-fill for normal Available days, subtle amber for Limited capacity, light red for Unavailable/busy, and the normal accent for the selected range.
    - [x] Fixed-duration tariffs treat `included_duration_minutes` as a hard minimum, not merely a price label. A ₱500 / 3-day tariff cannot be booked for 1–2 days; longer rentals are allowed and use the configured extra-day rate.
    - [x] Pickup/return dates come from the range calendar while pickup/return times remain explicit inputs so the final reservation continues to use exact timestamps.
    - [x] Exact pickup/return availability is revalidated server-side after times are selected; the calendar remains advisory and never guarantees capacity.
    - [x] Post-return recovery participates in the blocked interval without being charged as customer rental duration; no pre-pickup preparation buffer is used.
    - [x] Event date is optional but constrained inclusively to the selected pickup/return calendar dates; changing the range clears an event date that is no longer valid.
    - [x] Month previous/next controls remain positioned inside the calendar header rather than escaping to the Sheet corners.
  - **Implemented API:** staff-only `GET /api/v1/reservations/availability-calendar` returns a bounded branch-local variant/day projection; `GET /api/v1/reservations/availability-check` rechecks the exact timestamp interval, buffered interval, available serialized-asset count, minimum duration, and rental preview without claiming capacity. Expired holds are treated as logically released in previews, matching the authoritative create transaction.
  - **Implemented UX details:** Limited displays the remaining free-piece count (for example `1 left`). Available days are intentionally visually quiet/transparent. Busy days display operational labels such as Reserved, Rented, Fitting, Maintenance, or Unavailable while sharing the light-red unavailable treatment. Fixed-duration messaging explains the base rental duration separately from post-return recovery, and short-range validation explains the earliest valid return timestamp.
  - **Tests/evidence:** Contracts availability tests pass; API typecheck/lint pass; reservation quote integration passes `7/7`; reservation create/availability integration passes `13/13`; focused app reservation/calendar/API-client tests pass `19/19` in a clean validation environment. App source-only TypeScript validation and `git diff --check` pass. Repo-wide OpenAPI generation and full app lint/typecheck remain affected by pre-existing Zod/OpenAPI and ESLint/jest-dom configuration issues already documented elsewhere.

- [x] **RSV-066 — Decouple staff availability from storefront setup and seed default policy snapshots**
  - **Depends on:** RSV-020 through RSV-023, tenant bootstrap.
  - **Outcome:** Business-side reservation creation works immediately after workspace bootstrap without requiring the owner to configure or publish the public storefront.
  - **Policy snapshot meaning:** a policy snapshot is the immutable version of rental/deposit/cancellation/delivery/privacy rules that applied when a reservation was created. Old reservations keep their accepted rules even if the business changes settings later. It is historical reservation truth, not a requirement that the public storefront be published.
  - **Acceptance:**
    - [x] Calendar/day availability does not require storefront or policy context because it only needs tenant/branch/variant/assets/timing.
    - [x] Exact timestamp availability does not require storefront or policy context for the same reason.
    - [x] Actual reservation creation still stores the immutable policy snapshot required by the reservation model.
    - [x] New tenant bootstrap automatically creates an internal draft storefront row plus default policy snapshot version 1; this internal row does not imply that a public storefront is configured or published.
    - [x] Existing workspaces that already have a draft storefront but no policy snapshot are safely backfilled.
    - [x] Default policy is intentionally neutral: empty rental/deposit/cancellation rules, delivery enabled with zero fee, and a default Drezivo reservation privacy notice; owners can later publish newer policy versions without rewriting historical reservations.
  - **Implemented:** tenant bootstrap now inserts the default `policy_snapshot` immediately after the auto-created draft storefront. Forward migration `0038_default_reservation_policy_snapshot.sql` inserts version 1 only for storefront rows that currently have no policy row, preserving any workspace that already has configured policy history. The migration was applied successfully to the local development database so the current workspace can create staff reservations immediately.
  - **Tests/evidence:** tenant bootstrap integration passes `4/4`, reservation create/availability passes `13/13`, API typecheck/lint pass, and `git diff --check` passes. The prior staff-facing error `Reservation quote context could not be resolved for this branch.` no longer blocks availability; actual reservation creation now has the automatically seeded immutable policy snapshot it needs.

- [x] **RSV-067 — Replace preparation + turnaround with one post-return Recovery period**
  - **Depends on:** RSV-065 and Catalogue variant timing settings.
  - **Outcome:** Owners configure one operational buffer after return instead of reasoning about a preparation period before pickup plus a separate turnaround period after return.
  - **Final V1 rule:** `blocked_start = pickup_at`; `blocked_end = return_at + recovery_duration`. There is no pre-pickup preparation reservation buffer.
  - **Acceptance:**
    - [x] A same-day pickup is not made invalid because an old preparation buffer would have started in the past.
    - [x] Recovery is the only owner-facing availability buffer and begins after the customer's return timestamp.
    - [x] Recovery may cover cleaning, inspection, steaming, transport, minor repair, or preparation for the next renter.
    - [x] Customer rental duration and extra-day pricing remain based only on pickup → return; recovery is operational occupancy and is never charged as extra rental time.
    - [x] Add/Edit Clothing no longer asks for preparation time; existing `prep_minutes` is normalized to zero for compatibility while the legacy database column remains temporarily in place.
    - [x] Reservation availability and authoritative allocation ignore legacy `prep_minutes` even if an old row still contains a nonzero value.
    - [x] Staff availability responses use `recovery_minutes` terminology rather than exposing prep/turnaround terminology.
    - [x] New Reservation messaging explains the fixed rental duration and the post-return recovery separately.
  - **Implemented:** allocation candidate SQL now starts the blocking range exactly at pickup and extends only the end by the existing `turnaround_minutes` storage value, which is treated as Recovery at the domain/UI boundary. Calendar day projection follows the same no-prep rule. Forward migration `0039_remove_preparation_buffer.sql` zeros historical `product_variant.prep_minutes`. Add Clothing sends zero preparation and exposes only Recovery Days After Return; Edit Clothing removes preparation inputs and relabels turnaround as Recovery. PRD/TRD are updated to the final rule.
  - **Compatibility note:** the physical database column `turnaround_minutes` remains in place for this branch to avoid an unnecessary destructive schema rename; business/UI/API availability terminology is Recovery. The legacy `prep_minutes` column remains only as a zeroed compatibility field and has no reservation effect.

- [x] **RSV-068 — Harden staff customer phone and hold/review timing**
  - **Outcome:** New Reservation cannot accept malformed phone numbers or accidentally shorten a promised 15-minute garment hold when completion enters merchant review.
  - **Acceptance:**
    - [x] New staff-customer phone accepts digits only and exactly 11 digits when provided.
    - [x] Contract validation rejects shorter, longer, or nonnumeric staff phone values even if the browser is bypassed.
    - [x] Exact availability and authoritative reservation quote reject pickup timestamps earlier than the current database minute.
    - [x] Moving `held → pending_confirmation` never replaces the original hold deadline with an earlier pickup-bounded review timestamp.
    - [x] A review deadline may extend toward pickup/24 hours, but never below the original 15-minute hold promised to staff.
    - [x] The frontend distinguishes an expired merchant-review deadline from an expired initial garment hold instead of showing the same misleading message.

- [x] **RSV-069 — Improve staff reservation date/time controls and list ordering**
  - **Outcome:** Reservation date/time entry uses consistent Drezivo controls instead of browser-native date/time widgets, and the Reservations table shows the newest reservation first.
  - **Acceptance:**
    - [x] Reservations list requests `created_desc`, with the reservation-list contract defaulting to newest-first for stable cursor pagination.
    - [x] Pickup-from and Pickup-through filters use reusable calendar popovers with readable dates, Today/Clear actions, keyboard Escape, and outside-click dismissal.
    - [x] New Reservation Event Date uses the same reusable calendar control and preserves pickup/return min/max bounds.
    - [x] Pickup and Return times use a reusable 12-hour time picker with explicit hour, minute, and AM/PM controls rather than the browser-native time widget.
    - [x] Return-time picker preserves the fixed-duration minimum by preventing a time earlier than the calculated same-day minimum.
    - [x] Production Next build compiles the new controls and prerenders `/reservations`; the known unrelated Next/ESLint parser mismatch remains after compilation.

- [x] **RSV-069A — Support cash tendered amounts and change due**
  - **Outcome:** Staff can record the actual cash handed over by the customer without overstating the reservation payment when the customer tenders more than the amount due.
  - **Final V1 rule:** `cash_tendered >= amount_due`; underpayment is rejected. The verified payment amount remains exactly the amount due, and `change_due = cash_tendered - amount_due`.
  - **Acceptance:**
    - [x] New Reservation labels the input `Cash tendered` rather than `Amount received` and shows calculated Change due when tendered cash exceeds the amount due.
    - [x] Existing Pending Confirmation cash reservations use the same cash-tendered/change behavior through `Record Cash & Confirm`.
    - [x] Cash tendered below the amount due is rejected before any reservation lifecycle transition, so a bad tender cannot mutate a held reservation into pending confirmation.
    - [x] Cash tendered equal to or above the amount due is valid; only the exact amount due is marked paid/verified.
    - [x] Immutable `payment_verification` stores `cash_tendered_minor` and `change_due_minor` separately from `verified_amount_minor`.
    - [x] Reservation Details projects Cash tendered and Change due for verified cash payments.
    - [x] Cash tendered participates in the verification idempotency hash so the same key cannot silently replay with a different tendered amount.
  - **Implemented:** forward migration `0040_cash_tendered_change.sql` adds nullable non-negative tender/change columns plus a consistency constraint requiring `cash_tendered = verified_amount + change_due` when cash metadata is present. The migration was applied to the local development database.
  - **Tests/evidence:** Contracts pass `94/94`; API typecheck/lint pass; isolated reservation lifecycle integration passes `37/37`, including an over-tender case that records payment due separately from tendered cash/change.

## Phase 8: Security and completion evidence

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
  - **Depends on:** RSV-021 through RSV-032, RSV-041, and RSV-050 through RSV-052. RSV-040 reschedule is deferred to V1.1.
  - **Outcome:** Drezivo cannot double-book or duplicate lifecycle effects under contention.
  - **Acceptance:**
    - [ ] Concurrent same-asset booking produces one winner.
    - [ ] Adjacent half-open intervals can coexist when readiness allows.
    - [ ] Confirmation vs expiry has one valid outcome.
    - [ ] Cancellation double-fire produces one effect and never releases a picked-up rental. Reschedule contention moves to V1.1 with RSV-040.
    - [ ] Pickup/return/cancel/complete double-fire produces one effect each.
  - **Tests/evidence:** Property/concurrency integration suite.

- [ ] **RSV-072 — Mark Reservations vertical slice complete**
  - **Depends on:** RSV-063, RSV-070, RSV-071.
  - **Outcome:** Reservations are authoritative and ready to drive Calendar/Dashboard without exposing unnecessary lifecycle complexity to O/S.
  - **Acceptance:**
    - [ ] Staff-created walk-in/manual booking uses the approved `Check availability → Reserve → Complete Reservation` UX while storefront-originated booking can use a more explicit checkout flow; both converge on the same authoritative reservation/allocation lifecycle.
    - [ ] Staff fast path plus the canonical held/review/confirm → pickup → return → complete lifecycle works end-to-end, including truthful `pending_confirmation` fallback when payment/merchant review is still required.
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

## Manual frontend end-to-end validation plan

Use this as the practical Owner/Staff acceptance checklist for the Reservations UI. It intentionally describes only what O/S should be able to do or observe from the frontend. Backend RSV implementation details remain in the phases above.

### Reservations page and visibility

- [ ] O/S can open the Reservations page and see real reservations from the backend, with no production mock rows.
- [ ] O/S can see the important reservation summary at a glance: reference, customer when available, garment, rental dates, reservation status, and separate payment/evidence status.
- [ ] O/S can search reservations by reference, customer, contact information where permitted, and clothing identity.
- [ ] O/S can filter reservations by reservation status and pickup/rental date range.
- [ ] O/S can sort/page through a larger reservation list without duplicate or missing rows.
- [ ] O/S can refresh the page and see the same authoritative server state instead of temporary frontend-only state.
- [ ] A customer-less short hold can appear in the list without the UI inventing a fake customer.

### Reservation details

- [ ] O/S can click a reservation and open its Reservation Details Sheet/drawer.
- [ ] O/S can see the reservation status, customer snapshot, garment snapshot, rental dates, event date when present, pickup/delivery method, price/deposit totals, and payment/evidence state.
- [ ] O/S can see the reservation lifecycle/custody history as real events occur, such as pickup and later return.
- [ ] Historical reservation information remains readable even if the live customer or clothing record is edited later.
- [ ] O/S only sees actions that make sense for the reservation's current state, such as Complete Reservation, Cancel, Pick Up, Return, or Complete Rental.

### Creating a new reservation — frontend wired; manual validation pending

- [ ] O/S can start a new reservation from the Reservations page using a clear `+ New Reservation` action.
- [ ] O/S can search/select a garment and choose the requested rental dates.
- [ ] O/S can check whether the selected garment is available for those dates before attempting to reserve it.
- [ ] If the garment is unavailable, the UI clearly stops the reservation flow and does not create a booking.
- [ ] O/S can see the server-calculated rental price, deposit, delivery fee when applicable, and relevant pickup/return dates before completing the reservation.
- [ ] O/S can choose Pickup or Delivery when the business configuration allows it.
- [ ] O/S can choose an available payment method such as Cash, GCash/manual QR, Maya, or configured bank transfer options.

### Walk-in reserve and timed hold — frontend wired; manual validation pending

- [ ] O/S can click `Reserve` before entering all customer information so the garment is protected while the walk-in transaction is being completed.
- [ ] After Reserve succeeds, the reservation becomes `held` and the garment is immediately blocked from overlapping reservations.
- [ ] The UI shows a simple remaining-hold indicator for the 15-minute hold without turning the staff flow into a customer checkout countdown screen.
- [ ] O/S can continue entering customer/contact information without losing the existing hold.
- [ ] If the hold expires before completion, the UI clearly explains that the hold expired, prevents stale completion, refreshes availability, and allows O/S to reserve again if the garment is still free.
- [ ] Two O/S/browser tabs trying to reserve the final available garment for overlapping dates result in only one successful reservation; the losing UI shows a clear availability/conflict message.

### Customer information and reservation completion — frontend wired; manual validation pending

- [ ] O/S can attach an existing customer or enter a new customer's required information during the held reservation.
- [ ] Required customer/contact fields are validated before the reservation can advance.
- [ ] O/S can provide optional event information and other supported V1 reservation details without restarting the hold.
- [ ] The normal staff flow uses one primary `Complete Reservation` action rather than forcing O/S through separate technical Submit and Confirm screens.
- [ ] If all required payment/merchant checks are already satisfied for the Owner, `Complete Reservation` can finish at `confirmed`.
- [ ] If payment or merchant verification is still required, `Complete Reservation` truthfully stops at `pending_confirmation` and clearly tells O/S what is still needed.
- [ ] The UI never displays a reservation as confirmed merely because customer information was submitted successfully.

### Payment and evidence behavior

> **Current integration note:** payment-method selection/instructions and reservation payment state are wired. Receipt/screenshot submission is not yet manually testable because the Finance module does not currently expose the receipt-submit API behind its shared contract; Drezivo must not fake an upload or infer payment from a screenshot.

- [ ] Cash reservations can proceed without requiring a receipt image when the configured cash verification requirements are satisfied.
- [ ] Manual QR/transfer reservations require the appropriate payment evidence before they can progress where evidence is required.
- [ ] Uploading a screenshot/receipt does **not** immediately display the payment as Paid or the reservation as Confirmed.
- [ ] O/S can clearly distinguish payment states such as pending/review/paid from reservation states such as held/pending confirmation/confirmed.
- [ ] After the authorized merchant/Owner verifies payment, an eligible pending reservation can be confirmed without creating a second reservation.
- [ ] O/S can reject a pending reservation when the merchant review fails, and the garment becomes available again when appropriate.

### Cancellation — business side only

- [ ] O/S can cancel a `held` reservation before pickup, and the garment becomes available immediately.
- [ ] O/S can cancel a `pending_confirmation` reservation before pickup, and the garment becomes available immediately.
- [ ] O/S can cancel a `confirmed` reservation before pickup, and the garment becomes available immediately.
- [ ] Cancelling a reservation does not automatically mark an existing payment as refunded.
- [ ] If money was already collected, the UI communicates that refund/financial follow-up must be handled manually by the business.
- [ ] An expired reservation remains `expired`; cancelling it later must not rewrite it as `cancelled`.
- [ ] Once a reservation has been picked up, the simple Cancel action is no longer available; the rental must continue through Return/settlement.
- [ ] The public/customer storefront has no self-service cancellation feature in V1; customers contact the business directly to cancel.
- [ ] There is no first-class Reschedule action required for V1. O/S handles a date change by cancelling the old pre-pickup reservation, checking the new dates, and creating a new reservation.

### Pickup / handover

- [ ] O/S can see a `Pick Up` action only when the reservation is eligible for handover.
- [ ] O/S can pick up a `confirmed` reservation when the assigned garment is active, ready, physically at the branch, and the required payment conditions are satisfied.
- [ ] Successful pickup changes the reservation from `confirmed` to `picked_up`.
- [ ] Successful pickup records the handover in the reservation's custody/history timeline, including the optional condition note.
- [ ] After pickup, the garment is shown operationally as being with the customer and remains blocked from another overlapping reservation.
- [ ] Pickup is blocked if the garment needs cleaning, needs repair, is otherwise unready, or is not physically at the branch.
- [ ] Pickup is blocked if required payment verification is no longer satisfied.
- [ ] Failed pickup leaves the reservation `confirmed` and does not create a fake pickup/history event.

### Return — frontend wired; manual validation pending

- [ ] O/S can see a `Return` action for a `picked_up` reservation when they have reservation-custody permission.
- [ ] O/S can record an optional return condition note and submit the physical return once.
- [ ] Successful Return changes the reservation from `picked_up` to `returned` and adds one visible return event after the pickup event in Reservation Details.
- [ ] After Return, the garment is shown back at the branch but **not ready** for another customer until inspection/readiness is resolved.
- [ ] If the garment already had a specific issue such as `needs_repair`, Return preserves that issue instead of replacing it with Ready.
- [ ] The actual return can still be recorded when the customer returns late or when payment/refund state changed after pickup.
- [ ] If the late return has already intruded into another reservation's planned allocation window, the physical return still succeeds and the affected future booking is surfaced as an operational disruption/attention item.
- [ ] Returning a garment does not automatically cancel, reschedule, or promise a substitute for the affected future reservation.
- [ ] Rapid double-click/retry on Return produces one return event and one final `returned` state.
- [ ] A user without custody permission cannot successfully Return a reservation even if they manually invoke the frontend request.

### Inspection and rental completion — frontend wired; manual validation pending

- [ ] O/S can record the post-return inspection/readiness outcome as `ready`, `needs_cleaning`, `needs_repair`, or `unready`, with an optional condition note.
- [ ] Recording `needs_cleaning` or another non-ready outcome keeps the reservation `returned` and keeps the existing rental-plus-Recovery block in place.
- [ ] A garment with open cleaning/maintenance work cannot be marked `ready` from the reservation UI.
- [ ] A damaged garment can remain unavailable for maintenance/repair rather than being automatically released; extra downtime uses the normal Clothing/Availability maintenance workflow.
- [ ] O/S can see `Complete Rental` succeed only when the garment is back at the branch, inspected `ready`, no maintenance work remains open, and settlement checks pass.
- [ ] If a posted charge, security-deposit holding, or refund is still unresolved, Complete Rental is blocked and the UI explains that settlement is still required without changing financial history.
- [ ] Successful completion changes the reservation from `returned` to `completed` once and releases the old reservation allocation so the ready garment can become eligible for later availability.
- [ ] Rapidly double-clicking or retrying Inspection/Complete Rental does not create duplicate completion/audit/allocation-release effects.

### Reliability and operational safety

- [ ] Rapidly double-clicking `Reserve`, `Complete Reservation`, `Cancel`, `Pick Up`, `Return`, and later `Complete Rental` never creates duplicate business effects.
- [ ] Retrying the same action after a network timeout does not create a second reservation, second cancellation, second pickup, or duplicate lifecycle event.
- [ ] If the same reservation is open in two tabs and one tab changes it first, the stale tab receives a clear stale/conflict message and refreshes instead of overwriting newer state.
- [ ] After every successful action, the Reservations list and Details Sheet refresh to the authoritative backend state.
- [ ] Availability/Clothing views agree with reservation state after Reserve, Cancel, Pick Up, Return, and completion.
- [ ] O/S never sees another tenant/workspace's reservations, customers, payments, or custody history.
- [ ] A user without the required reservation/custody/payment authority cannot successfully perform the protected action even if they manually expose or call the frontend control.

### Owner V1 end-to-end smoke flow

- [ ] **Normal walk-in:** Check availability → Reserve → enter customer/payment details → Complete Reservation → `confirmed`.
- [ ] **Payment-review walk-in:** Check availability → Reserve → enter details/evidence → Complete Reservation → `pending_confirmation` → merchant verification → `confirmed`.
- [ ] **Walk-in changes mind:** Reserve → Cancel → `cancelled` → garment available again.
- [ ] **Expired walk-in:** Reserve → hold expires → stale completion is blocked → garment can be reserved again if still available.
- [ ] **Physical handover:** `confirmed` → Pick Up → `picked_up` with one visible custody/history event.
- [ ] **Full rental lifecycle once Phase 5 is complete:** `confirmed` → Pick Up → `picked_up` → Return → `returned` → Complete Rental → `completed`.
