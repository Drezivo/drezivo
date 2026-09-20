---
title: Clothing Phase 2 Add Clothing Service
type: implementation-evidence
status: verified
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, clothing, catalogue, add-clothing, idempotency, quota, evidence]
---

# Clothing Phase 2 Add Clothing Service

## Scope

This note records the implementation evidence for [[Clothing Checklist]] task CLT-020 only. CLT-021 route exposure and CLT-022 image/file workflow remain separate checklist items.

## Transaction boundary

`catalogue.service.ts#createClothing` validates the request with the closed `createClothingRequest` contract before opening the write transaction. Tenant, branch, membership, permission codes, tenant lifecycle, request id, and idempotency key come from server-resolved command context rather than request-body authority fields.

The service executes the following work inside one tenant-scoped PostgreSQL transaction:

1. acquire the shared tenant quota lock;
2. claim/replay the tenant-scoped idempotency record;
3. validate the active tenant category;
4. validate accepted catalogue image references already present in the command;
5. resolve and lock exact reusable measurement-guide IDs referenced by sizes;
6. assert physical-asset capacity using the shared entitlement guard;
7. create one product/style;
8. create one variant per selected size;
9. create one active serialized physical asset per selected size;
10. append the redacted catalogue audit event;
11. finalize the idempotency outcome.

Any unhandled database failure rolls back the complete graph, audit row, and idempotency claim together.

## Measurement-guide stability

A `default_guide` size now persists the exact `measurement_guide_id` supplied by the validated request. The service no longer substitutes the tenant's current default guide at execution time. A later change to `is_default` therefore does not silently rewrite the clothing variant's reusable guide reference.

New clothing may reference only same-tenant active measurement guides. Missing/foreign references are concealed as not found; archived guides fail with `INVALID_MEASUREMENT_GUIDE`.

## Category and code safety

New clothing requires an active same-tenant category. Existing inactive categories remain valid historical references for existing products but cannot be selected for a new clothing command. An inactive category fails with `INVALID_CATEGORY`.

Tenant-local requested clothing-code conflicts now return `DUPLICATE_CLOTHING_CODE`; generated-code exhaustion remains a generic state conflict.

## Money and physical-piece expansion

Wire money remains decimal-string integer PHP minor units. Before persistence the service bounds amounts to the current PostgreSQL integer storage range and computes fixed-duration minutes server-side.

V1 selected sizes are expanded explicitly: `N` selected sizes create `N` variants and `N` active physical assets. There is no quantity/stock shortcut.

## Concurrency finding and fix

Initial PostgreSQL quota-race evidence exposed a real deadlock: separate create intents inserted idempotency rows first, then both attempted to upgrade to the tenant quota row lock.

The fix establishes one lock order for asset-creating commands: acquire the shared tenant quota lock before claiming idempotency. The idempotency claim still happens before the capacity assertion, so a same-key replay remains successful even if the first request filled the plan limit.

The shared entitlement service now exposes `lockTenantQuotaScope`, and `assertPhysicalAssetCapacity` continues to use the same lock internally.

## Evidence

`api/tests/integration/catalogue-add-clothing.test.ts` passes 10/10 against the disposable local PostgreSQL database as the non-superuser `drezivo_app` runtime role. Coverage includes:

- one product + one variant + one active physical asset per selected size;
- exact PHP minor-unit pricing persistence;
- exact reusable measurement-guide references;
- sequential same-intent replay;
- concurrent same-intent double-fire at the 75-asset Starter quota edge;
- changed-payload idempotency-key reuse rejection;
- concurrent different-intent quota contention with exactly one final create reaching the cap;
- service-level closed-contract validation;
- service-level permission denial before writes;
- inactive category, archived guide, and out-of-range money failures without partial products;
- rollback of product/audit/idempotency state when a foreign branch is injected as failure evidence.

Regression evidence:

- `tests/integration/entitlements.test.ts`: 9/9 passed;
- API non-integration unit suite: 82/82 passed;
- API typecheck: passed;
- API lint: passed.

## Handoff

CLT-020 is complete. CLT-021 should verify the existing HTTP route as the authoritative staff command boundary (Clerk auth, active local membership, tenant action policy, `assets.manage`, body/rate limits, safe errors, and required idempotency key). CLT-022 remains responsible for the full accepted-file/upload attachment workflow.
