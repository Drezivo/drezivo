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

- [x] **CLT-051 — Feed Clothing status/availability summaries from canonical sources**
  - **Depends on:** Availability implementation.
  - **Outcome:** Clothing list status and availability columns are read projections of real operational truth.
  - **Acceptance:**
    - [x] `Reserved`/future occupied states come from allocations/reservations.
    - [x] `Rented`/custody comes from actual pickup/return state.
    - [x] Cleaning/maintenance/manual blocks come from canonical readiness/work-order/allocation state.
    - [x] `Available` means eligible for the specific projection/window; it is not a permanent mutable flag.
  - **Tests/evidence:** `catalogue-availability-summary.test.ts` passes `3/3` against disposable PostgreSQL and cross-checks the list projection against real blocking reservation allocations, a released reservation allocation, current custody, current cleaning readiness, repair/cleaning work orders, and a manual-block work order. The projection returns an explicit bounded window, counts concrete active serialized assets, and computes `available_assets` only from active product + active variant + active/ready/at-branch garments with no blocking allocation in that window; archiving the style drives available capacity to zero without erasing Reserved/history signals. `catalogue-staff.test.ts` proves custom projection windows must be paired, ordered, and no longer than 31 days and confirms Available/Reserved/Rented are not physical readiness enum values. `/inventory` now renders overlapping operational signals separately from `X/Y available` capacity, with frontend/API-client regressions `50/50` and the focused Clothing/API-client slice `15/15`. Existing catalogue read (`7/7`), CLT-050 handoff (`3/3`), and archive/list (`4/4`) integrations remain green; all contract tests pass `74/74`, API units `82/82`, API lint/build pass, and `git diff --check` is clean.

## Phase 6: Security, performance, and completion evidence

- [x] **CLT-060 — Complete catalogue RLS and authorization suite**
  - **Depends on:** All Clothing API tasks.
  - **Outcome:** No catalogue read/write can cross tenant or permission boundaries.
  - **Acceptance:**
    - [x] Foreign IDs return concealed not-found behavior where required.
    - [x] Missing tenant context fails closed.
    - [x] Owner/Front Desk permission matrix matches accepted product policy.
    - [x] Restricted/cancelled tenant action policy is enforced centrally.
  - **Tests/evidence:** `catalogue-rls-authorization.test.ts` passes `5/5` against disposable PostgreSQL as the non-superuser `drezivo_app` role. It proves missing tenant context reads zero tenant rows and rejects writes, foreign product IDs return concealed `404 NOT_FOUND`, branch grants are resolved only from the selected branch, Owner and Front Desk may perform operational `assets.manage` edits, Front Desk cannot archive without `assets.archive`, and Owner archive succeeds when both permissions are present. Restricted/cancelled workspaces centrally clear active branch capabilities for catalogue reads (`403`) while catalogue writes are rejected by the shared lifecycle gate with `TENANT_RESTRICTED` / `TENANT_CANCELLED`. Existing forced-RLS (`8/8`), Add Clothing auth (`12/12`), edit (`4/4`), asset lifecycle (`6/6`), file security (`8/8`), and archive (`4/4`) integration regressions remain green. API units pass `82/82`; API typecheck, lint, build, and `git diff --check` pass.

- [x] **CLT-061 — Validate catalogue scale and query bounds**
  - **Depends on:** CLT-010, CLT-040.
  - **Outcome:** Clothing remains usable at the V1 plan ceiling of 1,000 active assets.
  - **Acceptance:**
    - [x] No unbounded full-tenant reads in ordinary list/detail flows.
    - [x] Search/filter indexes are used for representative tenant data.
    - [x] Image loading is optimized and does not block list interaction.
    - [x] Pagination remains deterministic under inserts/archives.
  - **Tests/evidence:** `catalogue-scale-bounds.test.ts` passes `3/3` against disposable PostgreSQL with exactly 1,000 active serialized assets. The list contract rejects limits above 100; representative pages use keyset cursors and remain deterministic when an earlier item is inserted and a later item is archived between page requests, with no duplicate first-page IDs leaking into page two. `EXPLAIN` evidence confirms the representative sort/search/filter paths avoid full-table sequential scans, with category+status filtering using `product_tenant_category_status_created_idx`; dedicated tenant sort indexes and a tenant-aware combined trigram search index are installed for catalogue growth. Ordinary list reads remain bounded by `limit + 1`, detail reads are product/branch scoped, and upcoming allocations remain capped. Catalogue image read URLs are authorized concurrently with `Promise.all`, while `/inventory` thumbnails use `loading="lazy"` and `decoding="async"`; the Clothing UI regression passes `11/11`. Existing catalogue read-model integration remains `7/7`; API units pass `82/82`, API typecheck/lint/build and `git diff --check` pass. App strict typecheck now passes after the Phase 6 closure config fixes.

- [ ] **CLT-062 — Mark Clothing vertical slice complete**
  - **Depends on:** CLT-060, CLT-061, CLT-070 through CLT-076, and CLT-078. Full multi-piece-per-variant management is deferred to V2 and is not a V1 completion dependency.
  - **Outcome:** Clothing is genuinely complete from the staff user's end-to-end perspective and is ready to support Reservations/Availability without known management gaps.
  - **Acceptance:**
    - [x] Add → list → search/filter → detail → edit → archive works against real API/database state.
    - [x] Tenant isolation and entitlement limits are proven.
    - [x] Reservation snapshots remain stable after catalogue edits.
    - [x] No mock catalogue dataset remains in production code paths.
    - [ ] Phase 7 manual E2E gaps are complete and re-verified in the staff app.
    - [ ] Relevant docs and this checklist reflect the final implemented behavior after Phase 7.
  - **Status note:** Reopened after manual end-to-end review. The prior automated evidence remains valid, but it did not cover category CRUD, product-detail image rendering, draft publishing, safe restore, per-variant lifecycle/removal controls, post-create navigation, adding variants later under the V1 one-variant/one-garment rule, or propagation of catalogue lifecycle changes into storefront/reservation behavior.
  - **Prior tests/evidence:** `catalogue-vertical-slice-complete.test.ts` passes `1/1` against disposable PostgreSQL and drives one persisted tenant graph through Add Clothing → server-side search/category/size/status list → detail → product edit → refreshed detail → archive → archived list/detail. Entitlement regressions pass `9/9`; the Add Clothing command suite passes `10/10` including the serialized physical-asset plan-cap race; catalogue edit passes `4/4` and proves reservation line name/measurement/pricing/money snapshots remain unchanged after catalogue edits; archive passes `4/4` and preserves reservation snapshot/allocation history; CLT-060 RLS/authorization remains `5/5`. Production-source audit finds no catalogue mock imports, and the former `clothing-data.ts` mock dataset has been removed. Contracts pass `74/74`, focused inventory frontend tests pass `50/50`, API units pass `82/82`, API typecheck/lint/build pass, app strict typecheck passes, Next production build completes, and `git diff --check` is clean. App ESLint remains blocked by the existing dependency mismatch (`next@15.5.24` with hoisted `eslint-config-next@16.3.5`/ESLint 10); no lint rule was weakened. An authenticated `/inventory` Playwright walkthrough is not automated because the repository has no safe Clerk test-session fixture, and the existing process on port 3000 returns HTTP 500; no auth bypass was added merely for evidence.

## Phase 7: Manual E2E completion gaps

- [x] **CLT-070 — Complete Manage Categories CRUD end-to-end**
  - **Depends on:** Existing category list/status infrastructure.
  - **Outcome:** `/inventory/categories` supports the full staff workflow instead of read-only category management.
  - **Acceptance:**
    - [x] Staff can add a category from a modal without leaving Manage Categories.
    - [x] Staff can edit an existing category from a modal, including its display name and supported editable metadata.
    - [x] Staff can remove a category from active use with confirmation. Referenced categories are deactivated/retained for history rather than destructively deleted; unused categories are hard-deleted safely.
    - [x] Category create/edit/deactivate-or-delete mutations are tenant-scoped, permission-checked through the shared catalogue write boundary, idempotent where required, and return safe conflict/not-found behavior instead of raw database errors.
    - [x] The category list refreshes immediately after successful mutations and exposes loading/error/empty states.
  - **Tests/evidence:** `catalogue-category-crud.test.ts` passes `4/4` against disposable PostgreSQL, covering create/edit with idempotent replay, safe duplicate-name conflict, hard delete for an unused category, and referenced-category deactivation with the product FK preserved. `categories-page.test.tsx` passes `7/7`, covering Add/Edit/Remove modals, immediate local refresh, safe referenced-category messaging, and the existing active/inactive toggle retry guard. Contracts build succeeds; API and app strict typechecks pass; `git diff --check` is clean.

- [x] **CLT-071 — Render real product images on Clothing Details**
  - **Depends on:** Existing catalogue file/image pipeline and Clothing detail read model.
  - **Outcome:** `/inventory/:productId` displays the product's real catalogue images instead of an empty/non-rendering image area.
  - **Acceptance:**
    - [x] Clothing detail API returns usable authorized image URLs for every accepted product image in display order.
    - [x] The detail page renders the primary image and additional images/galleries correctly.
    - [x] Expired/missing/failed image loads degrade to a deliberate fallback instead of a broken image.
    - [x] Foreign/private file identifiers remain concealed and browser clients never receive storage credentials; only short-lived authorized read URLs leave the API.
    - [x] Detail image rendering is lifecycle-agnostic and works for staff-visible active/draft products that already have accepted images.
  - **Tests/evidence:** `catalogue-read-model.test.ts` now passes `8/8` against disposable PostgreSQL and proves accepted `product_image` rows are joined to private file metadata, signed in display order, and a failed read authorization degrades only that image to `null` instead of failing Clothing Detail. `clothing-details-page.test.tsx` passes `10/10`, covering signed primary-image rendering, multi-image gallery switching, failed-image fallback, and existing lifecycle/detail behavior. API and app strict typechecks pass.

- [x] **CLT-072 — Complete and publish draft products**
  - **Depends on:** Add Clothing draft creation, image requirements, product/variant lifecycle rules.
  - **Outcome:** A staff user can return to a draft product, finish its required data, and publish it without recreating the clothing item.
  - **Acceptance:**
    - [x] Draft Clothing Detail exposes a clear `Publish Clothing` action while keeping Edit Clothing available for completing missing persisted data before publishing.
    - [x] Publish validates an active category, at least one accepted catalogue image, and at least one variant backed by an active serialized physical piece before the product can become active; eligible draft variants are activated in the same transaction.
    - [x] Invalid/incomplete drafts remain draft and return actionable validation errors for missing images or publishable physical capacity.
    - [x] Successful publish updates real product/variant catalogue state and makes the product visible in the active inventory projection.
    - [x] Publish is tenant-scoped through the shared catalogue transaction/RLS boundary, requires `assets.manage`, uses an idempotency record, and rejects stale `expected_updated_at` tokens.
  - **Tests/evidence:** `catalogue-draft-publish.test.ts` passes `4/4` against disposable PostgreSQL, proving valid draft → active publication, eligible variant activation, active-list visibility, idempotent replay, missing-image rejection, no-active-piece rejection, and stale-version protection. `catalogue-draft-publish-route.test.ts` passes `1/1` through the authenticated HTTP route. `clothing-details-page.test.tsx` passes `12/12`, covering the draft Publish action, current `updated_at` token usage, authoritative detail reload after success, and actionable validation errors that keep the item draft. Contracts remain `74/74`; API units `82/82`; contracts build, API typecheck/lint/build, app strict typecheck, focused Clothing tests `40/40`, and `git diff --check` pass.

- [x] **CLT-073 — Restore archived products safely**
  - **Depends on:** CLT-032 archive behavior and reservation-history preservation.
  - **Outcome:** Archived clothing can be returned to staff management instead of becoming permanently one-way.
  - **Acceptance:**
    - [x] Archived rows expose `Restore to Draft` in the inventory row actions and Clothing Detail.
    - [x] Restore preserves reservation snapshots, blocking reservation allocations, maintenance allocations, audit history, maintenance history, and custody truth.
    - [x] Restore moves the product to `draft`, never directly to `active`; archived variants return only to `draft` for review.
    - [x] Restore does not reactivate retired/lost/unread y serialized assets. Physical lifecycle/readiness/custody state is unchanged by the restore command.
    - [x] Restore is tenant-scoped, requires the shared catalogue write boundary plus `assets.archive`, replays the same idempotency intent safely, and rejects stale `expected_updated_at` tokens.
    - [x] After restore, the product is visible as Draft in staff inventory and can use the existing CLT-072 publish flow after review.
  - **Tests/evidence:** `catalogue-archive-clothing-route.test.ts` passes `8/8` against disposable PostgreSQL. Its CLT-073 cases archive a product with confirmed reservation history, blocking reservation allocation, maintenance allocation, custody exceptions, and a safely retired piece, then restore it to Draft while proving all physical/history state remains unchanged; same-key restore replay returns the same response, stale restore returns `STALE_VERSION`, and missing `assets.archive` returns `FORBIDDEN`. `clothing-details-page.test.tsx`, `clothing-page.test.tsx`, and `edit-clothing-page.test.tsx` pass `35/35`, covering restore from both archived row actions and Clothing Detail plus authoritative reload to Draft.

- [x] **CLT-074 — Add per-variant lifecycle and removal controls**
  - **Depends on:** Existing variant edit API and reservation snapshot rules.
  - **Outcome:** Staff can control each variant independently instead of treating every variant as permanently tied to the product's draft/active state.
  - **Acceptance:**
    - [x] Each variant exposes explicit Publish, Set Draft, Archive, Restore Draft, and Remove controls in Edit Clothing.
    - [x] Product lifecycle invariants are enforced: draft/archived products are not renter-facing; an active product cannot demote/archive/remove its final active variant.
    - [x] Other variants may remain draft or archived while at least one valid variant remains active.
    - [x] Staff remove variants through an explicit confirmation dialog that explains destructive vs non-destructive behavior.
    - [x] A never-used draft variant with no serialized assets/reservation history is hard-deleted; variants with assets or reservation history are archived instead so foreign keys/history remain intact.
    - [x] Variant lifecycle/removal mutations are tenant-scoped, require `assets.manage`, use idempotency and `expected_updated_at` concurrency tokens, emit audit events, and preserve reservation snapshots plus allocations.
    - [x] Staff read models continue to retain draft/archived variants, while the existing reservation-handoff boundary requires both product and variant to be active.
  - **Tests/evidence:** `catalogue-archive-clothing-route.test.ts` passes `8/8` and proves lifecycle replay, stale-version rejection, `assets.manage` permission enforcement, final-active-variant protection, referenced variant archive fallback, safe hard-delete of an unused draft variant, unchanged reservation snapshot/allocation state, and lifecycle/archive/delete audit events. `catalogue-reservation-handoff.test.ts` passes `3/3` and continues to exclude non-active products/variants from allocation candidates. Focused Clothing frontend tests pass `35/35`, covering Publish/Set Draft/Archive/Restore Draft controls, safe Remove confirmation, and disabling lifecycle actions while unsaved edits exist.

- [x] **CLT-075 — Return Add Clothing users to Inventory after success**
  - **Depends on:** Existing Add Clothing form and create mutation.
  - **Outcome:** Successful creation returns staff to `/inventory`, where they can immediately add another clothing item or continue catalogue management.
  - **Acceptance:**
    - [x] Successful Add Clothing creation redirects to `/inventory` instead of the new product detail page.
    - [x] The inventory list refreshes/fetches real API state and includes the newly created item under the correct draft/active filter.
    - [x] Failed creation remains on the form with the user's entered values and actionable errors intact.
    - [x] The Inventory page's existing `Add Clothing` action remains immediately available after redirect.
  - **Tests/evidence:** Active and draft creates both redirect to `/inventory`; active creation writes the one-time `clothing-added` notice while drafts retain `draft-saved`. `add-clothing-page.test.tsx` plus `clothing-page.test.tsx` pass `28/28`, including real API-list refresh on Inventory after the redirect and preservation of the existing Add Clothing entry point.

- [x] **CLT-076 — Add variants to existing clothing**
  - **Depends on:** Existing variant edit infrastructure and CLT-074 lifecycle rules.
  - **Outcome:** A rental business can expand an existing style later without recreating the product, while preserving the V1 rule that one variant/size represents exactly one serialized garment.
  - **Acceptance:**
    - [x] Edit Clothing exposes `Add Variant` for an existing product.
    - [x] Staff can create a new variant with size, optional color, measurement mode/source, pricing, and preparation/turnaround settings.
    - [x] Add Variant has no draft/publish choice: the new variant is created active immediately as a staff catalogue record.
    - [x] V1 Add Variant atomically creates exactly one initial serialized `physical_asset` for the new variant in the active branch; staff do not separately add/manage additional pieces in V1.
    - [x] The generated initial physical asset is active, ready, at-branch, receives a unique tenant-local asset code, and is covered by the existing physical-asset plan-capacity guard.
    - [x] New variant SKU uniqueness is tenant-scoped and validated safely; omitted SKU values are generated server-side.
    - [x] The create command is tenant-scoped, permission-checked, idempotent, audited, and duplicate-safe.
    - [x] Newly created variants appear immediately in staff detail/edit projections without navigating away from Edit Clothing.
  - **Tests/evidence:** `catalogue-add-variant-route.test.ts` passes `4/4` against disposable PostgreSQL and proves Add Variant atomically creates one active/ready/at-branch serialized garment, same-key replay does not duplicate the garment, duplicate SKU is rejected safely, missing `assets.manage` is forbidden, and hitting the 75-asset Starter limit returns `CAPACITY_CONFLICT` with neither the new variant nor an extra asset persisted. `edit-clothing-page.test.tsx` plus `add-clothing-page.test.tsx` pass `27/27`; Add Variant stays on Edit Clothing with no Draft/Publish choice, while Add Clothing now shows only `Selected sizes` because the V1 one-piece-per-size mapping is automatic.

- [ ] **CLT-078 — Prove catalogue lifecycle propagation to storefront and reservation handoff**
  - **Depends on:** CLT-050, CLT-051, CLT-072, CLT-073, CLT-074, and completed V1 CLT-076 one-variant/one-garment behavior.
  - **Outcome:** Staff catalogue lifecycle actions and customer-facing rental availability cannot diverge.
  - **Acceptance:**
    - [ ] Publishing a valid draft product makes it eligible for the public/storefront catalogue according to storefront policy.
    - [ ] Draft or archived products are excluded from new renter-facing catalogue/availability/reservation handoff.
    - [ ] Draft or archived variants are excluded from renter-facing availability and reservation candidate selection even when sibling variants remain active.
    - [ ] Publishing a valid variant under an active product makes that variant eligible for renter-facing availability without altering sibling variant history.
    - [ ] Archiving a product or variant never releases existing reservation allocations or mutates immutable reservation snapshots.
    - [ ] Restoring an archived product to draft does not make it publicly rentable until it is explicitly republished and passes current validation.
    - [ ] Each V1 active variant's single serialized garment contributes future candidate capacity only when that garment is active, ready, at the correct branch, and otherwise eligible under canonical allocation rules.
    - [ ] Retiring/loss/maintenance/readiness changes immediately affect canonical staff availability and reservation candidate projections according to their existing semantics.
  - **Tests/evidence:** Cross-module PostgreSQL integration suite covering Catalogue → Storefront/Availability → Reservation handoff, plus customer-facing catalogue UI regression where implemented.

## Deferred from Clothing V1

- Fitting-specific garment guarantees and fitting allocations — V1.1.
- **Multi-piece-per-variant physical inventory management — V2.** V1 keeps the serialized `physical_asset` architecture internally but exposes exactly one garment per variant/size. V2 may add `Add Physical Piece`, multiple garments under one variant, per-piece capacity expansion, and staff UI for adding/retiring/restoring additional pieces.
- Multi-location/transfer inventory — V2.
- Bulk stock quantity semantics that bypass serialized physical assets remain unsupported; even in V2, capacity stays based on serialized garments rather than a mutable quantity counter.
- Marketplace inventory sharing across tenants.
- AI recommendations, demand forecasting, or advanced analytics.
