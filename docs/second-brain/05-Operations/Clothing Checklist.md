---
title: Clothing V1 End-to-End Checklist
type: implementation-checklist
status: phase-2-complete
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, v1, clothing, catalogue, inventory, checklist]
---

# Clothing V1 End-to-End Checklist

**Status:** Phases 0–2 are complete: catalogue foundations/reads plus the Add Clothing transactional service, API boundary, and canonical clothing file attachment flow are implemented.
**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), and [ERD](../../architecture/Drezivo-ERD.dbml).
**Foundation dependency:** [Tenancy, Owner Onboarding, Clerk, Memberships, and Billing V1 Checklist](../../../api/TENANCY-ONBOARDING-V1-CHECKLIST.md).

## How to use this checklist

Implement in order. Do not jump directly from the current Clothing UI to ad-hoc API endpoints. Drezivo must preserve the canonical three identities:

- **Product/style** — the customer-facing clothing style, e.g. `Emerald Gown`.
- **Variant** — a size/color/measurement/pricing configuration, e.g. `Medium / Green`.
- **Physical asset** — the individually tracked garment actually allocated to rentals, e.g. `GWN-0042`.

Before marking a task complete:

- Contract ownership is in `contracts/` before API/app consumers.
- Tenant, membership, branch, subscription state, and entitlements are server-resolved.
- Mutations are idempotent and have sequential plus concurrent double-fire tests.
- Active physical-asset quota is enforced in the same transaction as creation/activation.
- Archiving never deletes reservation/history truth.
- Future availability is never derived from a mutable clothing `status` field.
- Targeted unit/integration tests plus typecheck/lint/build evidence are recorded.

## Non-negotiable outcomes

- Clothing creation produces real `product`, `variant`, and `physical_asset` records, not a quantity field pretending serialized garments are fungible.
- V1 Add Clothing may accept several selected sizes and atomically create one variant plus one initial physical asset per selected size.
- Physical-asset quota counts active serialized garments, not products/styles.
- Product codes are tenant-local and case-insensitively unique.
- Every provisioned workspace starts with six active default categories: Gowns, Dresses,
  Filipiniana, Barong, Costumes, and Formal Wear.
- Category visibility is an explicit `active | inactive` status; inactive categories remain valid
  historical references but are hidden from new public catalogue discovery.
- Availability is derived from authoritative allocations plus actual custody/readiness state.
- Archive hides clothing from new intake while preserving existing reservations, snapshots, allocations, custody events, and history.
- A garment with unresolved custody cannot be silently archived into an apparently available state.
- Frontend status pills are projections only; they never become authorization or allocation authority.

## Phase 0: Canonical contract and schema alignment

- [x] **CLT-000 — Audit existing catalogue schema against the canonical model**
  - **Depends on:** Tenancy/actor-context foundation available.
  - **Outcome:** Existing migrations and runtime schema are mapped to product, category, variant, physical asset, measurement guide, and file references before adding new tables.
  - **Acceptance:**
    - [x] Identify which V1 catalogue tables already exist and which are missing.
    - [x] Confirm tenant-owned tables use tenant-scoped PK/FK patterns and forced RLS where required.
    - [x] Confirm V1 does not introduce stock quantity as the source of rentable capacity.
    - [x] Record any schema mismatch as a forward migration plan; do not rewrite already-applied migrations.
    - [x] Keep V1.1 fitting and V2 location/transfer columns out of V1 migrations unless already safely nullable and canonical.
  - **Tests/evidence:** [[Clothing Phase 0 Schema Audit]] records the schema map and forward-only plan against Data Model §5/entity definitions.

- [x] **CLT-001 — Define catalogue contracts and stable errors**
  - **Depends on:** CLT-000.
  - **Outcome:** `contracts/` owns request/response schemas before API routes are implemented.
  - **Acceptance:**
    - [x] Define product/category/variant/physical-asset summary and detail projections.
    - [x] Define closed schemas for product lifecycle and physical-asset readiness/lifecycle projections used by V1.
    - [x] Define Add Clothing request with name, description, category, selected sizes, color, rental price, deposit, measurement source, measurements/guide reference, preparation/turnaround settings, and internal notes only where canonical.
    - [x] Define update/archive requests with optimistic version/state inputs where needed.
    - [x] Define list query schemas for search, category, size, lifecycle/readiness projection, pagination cursor/limit, and sorting.
    - [x] Reject client-supplied tenant ID, branch authority, entitlement count, derived availability, or server-computed money fields.
    - [x] Add stable errors for duplicate code, asset limit reached, invalid category/guide, unresolved custody, stale version, and foreign object concealment.
  - **Tests/evidence:** Focused catalogue contract tests pass `10/10`; `@drezivo/contracts` build passes. See [[Clothing Phase 0 Schema Audit]].

- [x] **CLT-002 — Define catalogue migration constraints and indexes**
  - **Depends on:** CLT-000, CLT-001.
  - **Outcome:** Catalogue persistence is safe under concurrency and efficient for tenant-scoped search/listing.
  - **Acceptance:**
    - [x] Product code uniqueness is tenant-local and case-insensitive.
    - [x] Category uniqueness is tenant-local according to accepted naming rules.
    - [x] Category visibility uses the closed `active | inactive` status; the old `visible` boolean
          is removed as a competing source of truth.
    - [x] Tenant bootstrap atomically seeds Gowns, Dresses, Filipiniana, Barong, Costumes, and
          Formal Wear as active defaults; a forward migration backfills only missing defaults for
          already-provisioned tenants without reactivating or duplicating an existing category.
    - [x] Variant uniqueness prevents accidental duplicate equivalent variants where the canonical model requires it.
    - [x] Physical assets have stable identifiers and lifecycle/readiness fields that cannot erase historical allocation/custody facts.
    - [x] Add indexes for tenant/product/category/status/search paths actually used by `/inventory`.
    - [x] Add same-tenant FK protection for category/product/variant/asset relationships.
    - [x] Runtime role privileges deny unsafe cross-tenant/global writes.
  - **Tests/evidence:** `0025_catalogue_phase0_integrity.sql` and
    `0026_category_status_defaults.sql` are covered by catalogue/bootstrap integration evidence.
    `catalogue-phase0.test.ts` passes `8/8` and `tenant-bootstrap.test.ts` passes `4/4` sequentially
    against disposable local PostgreSQL as the non-superuser `drezivo_app` role. See
    [[Clothing Phase 0 Schema Audit]].

## Phase 1: Catalogue read model

- [x] **CLT-010 — Implement tenant-safe clothing list query**
  - **Depends on:** CLT-001, CLT-002, actor-context foundation.
  - **Outcome:** `/inventory` can render real clothing data with bounded server-side pagination.
  - **Acceptance:**
    - [x] Query resolves tenant and branch from actor context, never browser authority fields.
    - [x] Search covers product name and tenant-local product code; category/size filters are server-side.
    - [x] Pagination is bounded and deterministic; keyset/cursor semantics are used for scalable catalogue reads.
    - [x] Response includes only safe list projection fields needed by the Clothing page.
    - [x] Derived UI status does not claim future availability from a mutable asset flag.
    - [x] Foreign tenant IDs/codes cannot enumerate or influence results.
  - **Tests/evidence:** `api/tests/integration/catalogue-read-model.test.ts` covers a 120-style dataset, keyset pagination, search/filtering, zero results, cursor validation, readiness projection, and cross-tenant isolation. See [[Clothing Phase 1 Read Model]].

- [x] **CLT-011 — Implement clothing detail query**
  - **Depends on:** CLT-010.
  - **Outcome:** A Clothing Details sheet/page can resolve the style, variants, serialized assets, pricing, measurement source, and safe readiness summary.
  - **Acceptance:**
    - [x] Product, variants, and physical assets are returned as distinct identities.
    - [x] Detail projection preserves per-variant/per-asset overrides instead of flattening away differences.
    - [x] Upcoming allocation/history links are references or bounded summaries, not unbounded reservation dumps.
    - [x] Internal notes remain staff-only; no internal-note field is exposed by the canonical staff detail projection.
    - [x] Archived styles remain readable to authorized staff and historical references.
  - **Tests/evidence:** Real PostgreSQL detail tests cover active/archived products, multiple sizes, multiple serialized assets, per-asset overrides, foreign-ID concealment, and 11 future allocations proving the 10-row bound plus `has_more_upcoming_allocations`. See [[Clothing Phase 1 Read Model]].

- [x] **CLT-012 — Implement category list/management read boundary**
  - **Depends on:** CLT-010.
  - **Outcome:** Add/Edit Clothing can use real tenant categories without hard-coded frontend category values.
  - **Acceptance:**
    - [x] Categories are tenant scoped.
    - [x] `active`/`inactive` category behavior is explicit in the staff management UI and public catalogue query.
    - [x] Existing products referencing a category remain historically valid.
  - **Tests/evidence:** PostgreSQL tests cover tenant isolation/stable ordering; `categories-page.test.tsx` and `add-clothing-categories.test.tsx` cover staff management, retry-safe toggle behavior, and active-only Add Clothing selection. See [[Clothing Phase 1 Read Model]].

## Phase 2: Add Clothing command

- [x] **CLT-020 — Implement Add Clothing transactional service**
  - **Depends on:** CLT-001, CLT-002, entitlement service TBF-032.
  - **Outcome:** Owner/authorized staff can create a style with selected sizes and serialized garments atomically.
  - **Acceptance:**
    - [x] Validate request through the closed contract.
    - [x] Resolve tenant/branch/membership/permission server-side; the service consumes only server-resolved command context and re-checks `assets.manage`/tenant lifecycle before writes.
    - [x] Lock entitlement capacity through the shared active-physical-asset quota guard.
    - [x] Compute number of generated active physical assets before commit.
    - [x] Create product, variants, initial physical assets, measurement references, and audit row in one transaction.
    - [x] Selected sizes create one initial physical asset each in V1; no stock quantity shortcut.
    - [x] Rental/deposit money uses integer PHP minor units and server validation.
    - [x] Reusable default measurement-guide references remain stable if the tenant default later changes.
    - [x] Same user intent is idempotent; changed payload under the same key fails safely.
  - **Tests/evidence:** `catalogue-add-clothing.test.ts` passes 10/10 against disposable local PostgreSQL, including sequential/concurrent double-fire, quota-edge serialization, rollback, contract/authz rejection, exact guide references, and money/category validation. Shared entitlement regression passes 9/9 and API units 82/82. See [[Clothing Phase 2 Add Clothing Service]].

- [x] **CLT-021 — Expose Add Clothing API route**
  - **Depends on:** CLT-020.
  - **Outcome:** Staff app can create clothing through one tenant-authoritative API endpoint.
  - **Acceptance:**
    - [x] Route requires Clerk auth, active local membership, allowed permission, tenant lifecycle gate, and idempotency key.
    - [x] Request/body size and rate limits are reasonable for JSON metadata; Add Clothing uses a dedicated 64 KB JSON bound and the catalogue write limiter is 30 requests/minute.
    - [x] Client cannot set tenant ID, creator membership, quota counters, or derived availability; the closed request contract rejects these authority/derived fields.
    - [x] Errors use stable safe envelopes and conceal foreign references.
  - **Tests/evidence:** `catalogue-add-clothing-route.test.ts` passes 10/10 against disposable local PostgreSQL, covering auth, active membership, branch permission, tenant lifecycle, idempotency, strict request authority, 64 KB body bound, foreign-category concealment, successful Front Desk creation, and 30/min rate limiting. API typecheck/lint/build pass and API units remain 82/82. See [[Clothing Phase 2 Add Clothing API Route]].

- [x] **CLT-022 — Implement clothing image/file attachment flow**
  - **Depends on:** CLT-020 and canonical Files boundary.
  - **Outcome:** Clothing photos use accepted file metadata/storage rather than raw public browser credentials.
  - **Acceptance:**
    - [x] Browser never receives unrestricted S3 credentials; Drezivo returns only a short-lived checksum-bound direct PUT URL and required headers.
    - [x] Upload acceptance validates MIME/type/size, checksum/file signature, and tenant ownership before a private file can become `accepted`/frozen.
    - [x] Product photo order/cover image mutation is idempotent and authorization checked; the complete ordered set is replaced transactionally and index `0` is the cover.
    - [x] Failed file/provider work cannot leave the catalogue transaction falsely claiming an accepted image; mismatch is rejected and provider failure leaves the file pending.
  - **Tests/evidence:** `catalogue-files.test.ts` passes 7/7 against disposable local PostgreSQL, covering safe upload authorization/finalization, size/type/checksum validation, foreign-file concealment, permission checks, ordered cover/photo replacement, idempotent replay, changed-payload rejection, duplicate attachment, and pending/foreign image safety. Contracts remain 66/66, CLT-020 and CLT-021 regressions remain 10/10 each, API units remain 82/82, and typecheck/lint/build pass. See [[Clothing Phase 2 File Attachment Flow]].

## Phase 3: Edit, archive, and lifecycle safety

- [x] **CLT-030 — Implement product/variant edit command**
  - **Depends on:** CLT-020.
  - **Outcome:** Staff can update future catalogue presentation without rewriting accepted reservation snapshots.
  - **Acceptance:**
    - [x] Product name/description/category and allowed future pricing/policy inputs may change.
    - [x] Existing reservation line snapshots remain immutable historical truth.
    - [x] Variant measurement source changes are explicit and do not silently mutate frozen referenced guides.
    - [x] Stale concurrent edits fail with a clean conflict or conditional transition.
    - [x] Edit is idempotent per intent and audited.
  - **Tests/evidence:** Stale-version, snapshot-preservation, and double-fire tests.

- [x] **CLT-031 — Implement physical asset lifecycle/readiness updates**
  - **Depends on:** CLT-030, Availability checklist foundations.
  - **Outcome:** Actual garment readiness/custody can be represented without pretending it controls all future availability.
  - **Acceptance:**
    - [x] Current readiness projection cannot override a blocking `asset_allocation`.
    - [x] Pickup/return custody transitions remain owned by Reservation/Custody workflows, not generic Clothing edit.
    - [x] Cleaning/maintenance/manual unavailability creates or updates the canonical allocation/work-order path where applicable.
    - [x] Actual late/unready state can create disruption rather than silently releasing future bookings.
  - **Tests/evidence:** `catalogue-asset-lifecycle-route.test.ts` passes `6/6` against disposable local PostgreSQL, covering blocking-allocation preservation, custody ownership, guarded retirement, canonical maintenance/manual work-order allocation, overlap rollback, stale version, sequential/concurrent idempotency, disruption creation, permission scope, and foreign-asset concealment.

- [x] **CLT-032 — Implement archive command**
  - **Depends on:** CLT-030, CLT-031.
  - **Outcome:** Clothing can leave new-rental intake without deleting history.
  - **Acceptance:**
    - [x] Archive is a lifecycle transition, not DELETE.
    - [x] Archived style/variants/assets remain readable from historical reservations.
    - [x] New storefront/staff intake excludes archived rentable inventory.
    - [x] Unresolved custody or required operational work blocks unsafe retirement or routes through a documented resolution workflow.
    - [x] Archive does not release an existing reservation allocation by itself.
    - [x] Mutation is idempotent and audited.
  - **Tests/evidence:** `catalogue-archive-clothing-route.test.ts` covers active reservation/allocation preservation, historical snapshot/detail readability, safe-vs-pending asset retirement, storefront/staff intake exclusion, stale archive rejection, permission/authority boundaries, and concurrent duplicate archive with one audited effect. The full disposable-PostgreSQL integration run passes `121/121`.

## Phase 4: Staff app integration

- [x] **CLT-040 — Replace Clothing page mock data with API reads**
  - **Depends on:** CLT-010.
  - **Outcome:** `/inventory` displays authoritative tenant data.
  - **Acceptance:**
    - [x] Search sits beside filters as approved in the current UI.
    - [x] Search/category/size/status changes query server-side and reset pagination safely.
    - [x] Loading, empty, error, and permission-restricted states are designed.
    - [x] URL/query state is shareable where useful without exposing authority values.
    - [x] Mobile table/list remains usable at 360px.
  - **Tests/evidence:** `clothing-page.test.tsx` covers authoritative API rows, server-side search/status filters, URL hydration/sanitization, cursor reset, permission/empty states, responsive mobile metadata, pagination, and row actions. Catalogue read-model integration remains `7/7` against disposable PostgreSQL.

- [x] **CLT-041 — Connect Add Clothing UI to real mutation**
  - **Depends on:** CLT-021, CLT-022.
  - **Outcome:** Owner can add clothing from the staff app and immediately see it in inventory.
  - **Acceptance:**
    - [x] Shared submit guard prevents duplicate browser mutations.
    - [x] One idempotency key is reused across retries for one form intent.
    - [x] Server errors map to specific form fields or safe top-level feedback.
    - [x] Success invalidates/refetches the list; frontend never fabricates authoritative state.
    - [x] Asset-limit error gives an upgrade/archive path without deleting data.
  - **Tests/evidence:** `add-clothing-page.test.tsx` covers rapid double submit, timeout/retry with key reuse, capacity-limit recovery, draft/active redirects, uploads, and dirty-form safety. Real Add Clothing route integration passes `12/12` against disposable PostgreSQL.

- [x] **CLT-042 — Connect row actions and clothing detail UI**
  - **Depends on:** CLT-011, CLT-030, CLT-032.
  - **Outcome:** View details, Edit, and Archive actions operate on real tenant data.
  - **Acceptance:**
    - [x] Row action menu does not accidentally trigger unrelated row navigation.
    - [x] Edit/Archive confirmation follows shared pending/idempotency rules.
    - [x] Detail view clearly distinguishes style, variants, and individual garments where relevant.
  - **Tests/evidence:** `clothing-page.test.tsx`, `clothing-details-page.test.tsx`, and `edit-clothing-page.test.tsx` cover real detail/edit/archive routes, optimistic stale conflicts, shared mutation guards, authoritative reloads, and style → variants → serialized-piece rendering. Real edit/archive integrations pass `4/4` and `4/4` against disposable PostgreSQL.

## Phase 5: Availability and reservation handoff

- [x] **CLT-050 — Publish catalogue identity for reservation allocation**
  - **Depends on:** CLT-020 through CLT-032.
  - **Outcome:** Reservation services can select a rentable variant and allocate one serialized physical asset safely.
  - **Acceptance:**
    - [x] Reservation request never treats product quantity as available capacity.
    - [x] Candidate physical assets are tenant/branch scoped and filtered by lifecycle/readiness eligibility.
    - [x] Final conflict protection belongs to the reservation/allocation transaction, not catalogue read logic.
  - **Tests/evidence:** `catalogue-reservation-handoff.test.ts` passes `3/3` against disposable PostgreSQL: the handoff returns concrete serialized asset IDs only, filters foreign-tenant/foreign-branch/inactive/unready/overlapping-block candidates, requires active product/variant/branch state, and proves two concurrent reservation transactions may observe the same stale candidate while the authoritative `asset_allocation_no_overlap` constraint admits exactly one blocking allocation. `catalogue-allocation.test.ts` confirms the shared handoff contract exposes no stock quantity/available-units authority. Existing catalogue read/edit/lifecycle/archive regressions remain green (`7/7`, `4/4`, `6/6`, `4/4`); API units remain `82/82`, and contract focused tests remain `13/13` with typecheck/lint/build passing.

- [ ] **CLT-051 — Feed Clothing status/availability summaries from canonical sources**
  - **Depends on:** Availability implementation.
  - **Outcome:** Clothing list status and availability columns are read projections of real operational truth.
  - **Acceptance:**
    - [ ] `Reserved`/future occupied states come from allocations/reservations.
    - [ ] `Rented`/custody comes from actual pickup/return state.
    - [ ] Cleaning/maintenance/manual blocks come from canonical readiness/work-order/allocation state.
    - [ ] `Available` means eligible for the specific projection/window; it is not a permanent mutable flag.
  - **Tests/evidence:** Cross-check list projection against reservation/availability fixtures.

## Phase 6: Security, performance, and completion evidence

- [ ] **CLT-060 — Complete catalogue RLS and authorization suite**
  - **Depends on:** All Clothing API tasks.
  - **Outcome:** No catalogue read/write can cross tenant or permission boundaries.
  - **Acceptance:**
    - [ ] Foreign IDs return concealed not-found behavior where required.
    - [ ] Missing tenant context fails closed.
    - [ ] Owner/Front Desk permission matrix matches accepted product policy.
    - [ ] Restricted/cancelled tenant action policy is enforced centrally.
  - **Tests/evidence:** Real PostgreSQL RLS and API authorization suite.

- [ ] **CLT-061 — Validate catalogue scale and query bounds**
  - **Depends on:** CLT-010, CLT-040.
  - **Outcome:** Clothing remains usable at the V1 plan ceiling of 1,000 active assets.
  - **Acceptance:**
    - [ ] No unbounded full-tenant reads in ordinary list/detail flows.
    - [ ] Search/filter indexes are used for representative tenant data.
    - [ ] Image loading is optimized and does not block list interaction.
    - [ ] Pagination remains deterministic under inserts/archives.
  - **Tests/evidence:** Representative seeded load/query-plan measurements.

- [ ] **CLT-062 — Mark Clothing vertical slice complete**
  - **Depends on:** CLT-060, CLT-061.
  - **Outcome:** Clothing is no longer a mock UI and is ready to support Reservations/Availability end-to-end.
  - **Acceptance:**
    - [ ] Add → list → search/filter → detail → edit → archive works against real API/database state.
    - [ ] Tenant isolation and entitlement limits are proven.
    - [ ] Reservation snapshots remain stable after catalogue edits.
    - [ ] No mock catalogue dataset remains in production code paths.
    - [ ] Relevant docs and this checklist reflect implemented behavior.
  - **Tests/evidence:** Targeted contracts/API/app suites, typecheck, lint, build, and browser walkthrough.

## Deferred from Clothing V1

- Fitting-specific garment guarantees and fitting allocations — V1.1.
- Multi-location/transfer inventory — V2.
- Bulk stock quantity semantics that bypass serialized physical assets.
- Marketplace inventory sharing across tenants.
- AI recommendations, demand forecasting, or advanced analytics.
