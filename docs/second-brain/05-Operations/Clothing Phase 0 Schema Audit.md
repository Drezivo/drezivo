---
title: Clothing Phase 0 Schema Audit
type: implementation-evidence
status: verified
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, v1, clothing, catalogue, schema, contracts, evidence]
---

# Clothing Phase 0 Schema Audit

This note records the CLT-000 through CLT-002 implementation audit for
[[Clothing Checklist]]. It is an execution/evidence note only. The current PRD, TRD, Data Model,
ERD, reviewed migrations, and shared contracts remain authoritative.

## Scope and canonical boundary

Phase 0 aligns the existing catalogue scaffold with the V1 three-identity model:

1. **Product/style** — customer-facing clothing style.
2. **Product variant** — size/color/measurement/pricing configuration.
3. **Physical asset** — one serialized garment that can be allocated and handed over.

No stock/quantity field is introduced. Future availability remains owned by `asset_allocation` and
actual custody/readiness remains a separate physical truth. A frontend status pill is therefore a
projection only and cannot release, create, or override an allocation.

V1 does not add fitting resources/appointments or transfer/location behavior. Historical scaffold
columns already present for future releases remain nullable and unused:

- `physical_asset.location_id` — reserved by the original migration for V2.
- `asset_allocation.fitting_line_id` — nullable V1.1 placeholder with no V1 FK.
- `asset_allocation.transfer_line_id` — nullable V2 placeholder with no V1 FK.

Phase 0 adds no new V1.1/V2 column or table.

## CLT-000 existing schema map

| Identity/resource | Existing source | Phase 0 finding |
| --- | --- | --- |
| `category` | `0002_catalogue_assets.sql` | Exists; tenant-owned and RLS-protected. Needed tenant-local case-insensitive naming and composite tenant identity. |
| `product` | `0002_catalogue_assets.sql`, `0024_product_style_code.sql` | Exists with draft/active/archived lifecycle and tenant-local case-insensitive style code. Needed composite tenant/category integrity and list indexes. |
| `product_variant` | `0002_catalogue_assets.sql`, `0023_reusable_measurement_guides.sql` | Exists with pricing, size/color, explicit measurement mode/guide reference. Needed same-tenant product enforcement, case-insensitive SKU identity, and list/filter indexes. |
| `physical_asset` | `0002_catalogue_assets.sql` | Exists as serialized garment with lifecycle/readiness/custody/version. Needed same-tenant branch/variant enforcement and stronger identifier/version checks. |
| `measurement_guide` | `0023_reusable_measurement_guides.sql` | Exists with exact reusable file reference, active/archive state, one active default, forced RLS, and same-tenant file FK. |
| `file_object` | `0002_catalogue_assets.sql`, `0023_reusable_measurement_guides.sql` | Exists; accepted-file/frozen-byte rules already present. Composite `(tenant_id,id)` identity already added by `0023`. |
| `product_image` | `0002_catalogue_assets.sql` | Exists; needed same-tenant product/file relationships. |
| `asset_allocation` | `0003_availability_exclusion.sql` + reservation FK expansion | Already the only planned-unavailability table with GiST overlap exclusion. Clothing Phase 0 does not duplicate it. |

### Existing safety that Phase 0 preserves

- `0002` deliberately has no stock quantity column.
- `0008_rls_policies.sql` and `0010_rls_policy_tenant_guc_empty_guard.sql` enable/force tenant RLS
  for the original catalogue tables.
- `0023` separately enables/forces RLS for the later `measurement_guide` table.
- `0024` provides tenant-local case-insensitive product/style-code uniqueness.
- `physical_asset.version` already exists for optimistic physical-state writes.
- `asset_allocation` owns future blocking intervals; readiness is not a replacement for allocation.

## Phase 0 mismatches and resolution

### 1. Same-tenant relationships were incomplete

Several original FKs referenced only a UUID and did not prove the child row's `tenant_id` matched the
parent row's tenant. RLS prevents ordinary cross-tenant reads/writes, but database relationships
should remain valid even if a privileged/admin path or future repository bug knows both UUIDs.

`0025_catalogue_phase0_integrity.sql` therefore adds composite tenant identities and same-tenant FKs
for:

- product → category,
- variant → product,
- physical asset → branch,
- physical asset → variant,
- product image → product,
- product image → file object.

The existing measurement-guide/file and variant/measurement-guide composite FKs from `0023` remain.
Old simple FKs are not destructively rewritten; the new composite FKs add the missing invariant.

### 2. Tenant-local category and serialized identifiers needed normalization

Phase 0 adds:

- case-insensitive trimmed category-name uniqueness per tenant,
- case-insensitive trimmed variant SKU uniqueness per tenant,
- case-insensitive trimmed physical-asset-code uniqueness per tenant,
- blank/length checks for category/product/variant/asset identifying fields,
- positive `physical_asset.version`.

Product code case-insensitive uniqueness remains owned by `0024`.

A label-only `(product,size,color)` unique constraint is intentionally **not** added. Canonical
variant identity includes size, color, measurement configuration, and pricing; two future variants
could legitimately share labels while differing in the rest of that configuration. The tenant-local
SKU is the stable variant identifier. The V1 aggregate Add Clothing contract separately rejects
duplicate selected sizes inside one creation intent.

### 3. Inventory read paths needed explicit indexes

Phase 0 adds indexes for the planned `/inventory` read model:

- product contains-search by normalized name/code using `pg_trgm`,
- tenant/category/status/created product listing,
- tenant category visibility/display order,
- tenant/product/size variant filtering,
- tenant/variant/lifecycle/readiness physical-asset filtering.

These indexes do not make availability authoritative; date availability remains an allocation query.

## CLT-001 contract decisions

The shared `@drezivo/contracts` package now owns:

- closed product lifecycle enum: `draft | active | archived`,
- closed asset lifecycle enum: `active | retired | lost`,
- closed readiness enum: `ready | needs_cleaning | needs_repair | unready`,
- closed custody projection: `at_branch | with_customer | in_transit`,
- strict staff clothing list query with bounded cursor/limit and sort,
- product/category/variant/physical-asset summary/detail projections,
- optimistic product and variant update request schemas,
- archive request schema,
- catalogue-specific stable error codes.

The Add Clothing request now requires an exact `measurement_guide_id` whenever
`measurement_mode = default_guide`. Custom measurements cannot reference a reusable guide, and
`none` cannot silently carry either a guide or structured measurements.

The request boundary deliberately rejects:

- tenant IDs,
- branch authority,
- entitlement/quota counts,
- derived availability,
- allocation authority,
- server-computed money fields,
- non-canonical `internal_notes` fields.

The current canonical product/variant/asset entity tables do not define an internal-notes field, so
Phase 0 does not invent one because it appeared in an older UI concept.

### Stable catalogue errors

Added closed contract codes:

- `DUPLICATE_CLOTHING_CODE`
- `INVALID_CATEGORY`
- `INVALID_MEASUREMENT_GUIDE`
- `UNRESOLVED_CUSTODY`
- `STALE_VERSION`

`ASSET_LIMIT_EXCEEDED` already existed. Cross-tenant object lookup continues to use the shared
concealed `NOT_FOUND` behavior; callers must never receive a response that confirms a foreign object
exists.

## CLT-002 migration and runtime boundary

Forward migration: `api/src/db/migrations/0025_catalogue_phase0_integrity.sql`.

Drizzle mirrors were updated in:

- `api/src/db/schema/catalogue.ts`
- `api/src/db/schema/files.ts`
- `api/src/db/schema/tenancy.ts`

The migration reasserts forced RLS on catalogue tables but does not grant new global/bypass access.
`drezivo_app` and `drezivo_worker` continue to rely on the tenant policies established by the
foundation migrations; neither role is given BYPASSRLS or table ownership.

## Tests and evidence

### Passed

- Focused contract tests: `10/10` across `catalogue-admin.test.ts` and
  `catalogue-staff.test.ts`.
- `@drezivo/contracts` build passes and emits updated declarations.
- `@drezivo/api` full TypeScript check passes after rebuilding contracts.
- New integration suite compiles: `api/tests/integration/catalogue-phase0.test.ts`.

The integration suite covers:

- case-insensitive tenant-local category/product identifiers,
- same-tenant product/category and variant/product relationships,
- case-insensitive SKU and physical-asset codes,
- same-tenant physical-asset branch/variant relationships,
- cross-tenant read denial under forced RLS,
- cross-tenant write denial under forced RLS.

### Real PostgreSQL evidence

The repository's guarded integration harness was run against a separate local disposable
`drezivo_test` database, never the normal development database. The suite passed `5/5` while the
application connection used the non-superuser `drezivo_app` role, proving the new uniqueness,
same-tenant FK, and forced-RLS behavior under the runtime privilege model.

Command-equivalent evidence:

```text
npx vitest run tests/integration/catalogue-phase0.test.ts
```

The test database remains disposable test infrastructure only; development/production databases must
never be substituted for this harness.

## Handoff to Phase 1

Phase 1 may now implement the tenant-safe catalogue read model against these contracts and indexes.
It must not:

- add a quantity/stock availability shortcut,
- accept tenant or branch authority from query/body input,
- flatten product/variant/asset identities into one mutable clothing row,
- expose foreign-object existence,
- treat readiness as future date availability.
