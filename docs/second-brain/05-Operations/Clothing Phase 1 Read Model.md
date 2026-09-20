---
title: Clothing Phase 1 Read Model
type: implementation-evidence
status: verified
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, v1, clothing, catalogue, read-model, evidence]
---

# Clothing Phase 1 Read Model

This note records implementation evidence for CLT-010 through CLT-012 in [[Clothing Checklist]]. The canonical PRD, TRD, Data Model, reviewed migrations, and shared contracts remain authoritative.

## Scope

Phase 1 establishes the tenant-safe staff catalogue read boundary. It does not replace the current mock Clothing list/detail UI yet; that is intentionally CLT-040/CLT-042. It does remove hard-coded categories from Add Clothing and adds the real category-management surface required by CLT-012.

Implemented staff API reads:

- `GET /api/v1/catalogue/clothing`
- `GET /api/v1/catalogue/clothing/:productId`
- `GET /api/v1/catalogue/categories`
- existing `PATCH /api/v1/catalogue/categories/:categoryId/status` remains the category toggle command

Every route uses the existing Clerk auth → tenant context → tenant lifecycle action policy → `assets.manage` permission chain. Tenant and active branch are server-resolved from actor context; query/body parameters cannot supply authority scope.

## CLT-010 — Clothing list read model

`api/src/modules/catalogue/catalogue.read.repository.ts` owns the bounded SQL read model.

The list query supports:

- search by product name or tenant-local product code,
- category filter,
- size filter,
- product lifecycle filter,
- current physical-asset lifecycle/readiness filters,
- deterministic keyset pagination,
- name/code/created-time sort modes.

The query fetches `limit + 1`, returns the fixed `page_meta` contract, and encodes the sort key plus opaque product id into the cursor. A cursor created for one sort cannot be reused under another sort.

The list projection contains only staff-safe catalogue fields:

- product identity/code/name/category/lifecycle,
- size labels,
- minimum configured rental price,
- currency,
- active serialized-garment/readiness counts for the active branch,
- timestamps,
- optional public image URL placeholder.

It deliberately does **not** expose a mutable `available`/`reserved` flag. Readiness counts describe current physical state only; future date availability remains owned by canonical `asset_allocation` logic.

## CLT-011 — Clothing detail read model

The detail boundary returns the three catalogue identities separately:

1. product/style,
2. variants,
3. serialized physical assets.

Per-variant pricing, measurement mode, exact measurement-guide reference, custom measurements, timing settings, and lifecycle remain distinct. Per-asset custody/readiness, condition, measurement overrides, alteration note, and version remain distinct instead of being flattened into the style.

Archived products remain readable to authorized staff. Foreign product ids are concealed as `NOT_FOUND`.

### Bounded upcoming operational references

The detail projection now includes at most **10** future blocking allocation summaries plus `has_more_upcoming_allocations`.

Each summary contains only:

- physical asset id,
- optional reservation-line reference,
- V1 allocation kind (`reservation_hold`, `reservation_confirmed`, or `maintenance`),
- start/end instants.

The read deliberately omits customer, payment, evidence, policy, and reservation payloads. The repository fetches at most 11 rows so it can signal that additional future work exists without returning an unbounded reservation/maintenance history.

## CLT-012 — Category boundary

Categories remain tenant-scoped and ordered by:

1. `display_order`,
2. name,
3. id.

The lifecycle is explicit:

- `active` — available to Add Clothing and eligible for public storefront publication,
- `inactive` — retained for historical/product references but hidden from public storefront intake and excluded from Add Clothing's picker.

Staff UI added:

- `/inventory/categories`
- Clothing page `Manage Categories` entry point
- real API-backed Active/Inactive state and toggle
- retry-safe idempotent status mutation

Add Clothing now loads tenant categories from `GET /api/v1/catalogue/categories` and no longer carries a hard-coded category list. Only active categories are selectable; inactive categories can be restored from Manage Categories.

## Tests and evidence

### Contracts

- `contracts/tests/catalogue-admin.test.ts`
- `contracts/tests/catalogue-staff.test.ts`
- focused contract suite passes **11/11**.
- contracts lint passes.
- declaration emit via `tsc -p tsconfig.build.json` passes.

### API

- `api/tests/integration/catalogue-read-model.test.ts` passes **6/6** against disposable local PostgreSQL as the non-superuser runtime role.
- The suite covers:
  - 120-style catalogue pagination,
  - deterministic non-overlapping pages,
  - name/code search,
  - category/size/readiness/lifecycle filtering,
  - empty results,
  - invalid/sort-mismatched cursors,
  - foreign category/search isolation,
  - active and archived details,
  - multiple variants,
  - multiple serialized assets,
  - per-asset overrides,
  - foreign product concealment,
  - stable tenant category ordering,
  - explicit active/inactive category state,
  - 11 seeded future allocations proving the detail cap of 10 and `has_more_upcoming_allocations = true`.
- API typecheck passes.
- API lint passes.
- API non-integration regression suite passes **82/82**.

### Staff app

- `app/tests/unit/categories-page.test.tsx`
- `app/tests/unit/add-clothing-categories.test.tsx`
- focused app Phase 1 suite passes **5/5**.
- Add Clothing consumes real tenant categories and excludes inactive categories.
- Manage Categories exposes and toggles explicit status with duplicate-submit and retry/idempotency coverage.

App-wide TypeScript still reports only the pre-existing baseline errors in `playwright.config.ts` and the side-effect `./globals.css` import in `src/app/layout.tsx`; no Phase 1 inventory/category file introduces a new TypeScript error.

## Handoff

Phase 2 may build the authoritative Add Clothing command on this read foundation. Phase 4 remains responsible for replacing the mock `/inventory` list/detail presentation with these real list/detail endpoints.

Do not move the current readiness projection into an availability authority. Future availability must continue to derive from allocations plus actual custody/readiness truth.
