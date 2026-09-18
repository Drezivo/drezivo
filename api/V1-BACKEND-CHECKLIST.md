# V1 Backend Delivery Checklist

**Status:** authoritative task list for the full V1 backend · **Created:** 16 September 2026
**Scope:** full V1 backend surface, tiered by build priority (High → Medium → Low). The tenancy,
owner onboarding, Clerk, membership, and billing lifecycle is governed by the staged
`TENANCY-ONBOARDING-V1-CHECKLIST.md` linked below; post-V1 releases stay in the PRD/TRD version
gates.

## Authority and how to use this checklist

Source priority for every decision, in order:

1. [../Drezivo-PRD.md](../Drezivo-PRD.md) — Product Requirements Document v2.0 (revised)
2. [../Drezivo-TRD.md](../Drezivo-TRD.md) — Technical Requirements Document rev 1.1
3. [../Drezivo-Data-Model.md](../Drezivo-Data-Model.md) and [../Drezivo-ERD.dbml](../Drezivo-ERD.dbml) — logical schema and entity relationships
4. `../contracts/src/` — `@drezivo/contracts` 0.2.0 (the wire contract `api` implements and `app`/`web` consume)
5. The existing scaffold in `src/` and `src/db/migrations/`

For account, organization, onboarding, Clerk, membership, subscription, and trial decisions,
[`TENANCY-ONBOARDING-V1-CHECKLIST.md`](TENANCY-ONBOARDING-V1-CHECKLIST.md) is the canonical
implementation sequence. This checklist owns the wider rental backend and must treat the tenancy
phases as prerequisites wherever a task touches tenant context, staff access, plans, or billing.

`V1-BUSINESS-BACKEND-TASKS.md` in this directory is retained as historical context only. Where it
conflicts with the documents above (fittings in V1, `/organizations/:organizationId` routes,
`STAFF`/`NO_SHOW` roles, date-only rentals, `UNPAID/PAID` payment states), the documents above win
and this checklist does not repeat those ideas.

Working rules:

- **Priority tier = build order.** Within a tier, tasks are listed in dependency order; a task is
  complete only when its acceptance criteria and tests pass.
- **Tenancy phases come first for tenant-scoped work.** Complete TBF-010 through TBF-012 before
  pre-tenant commands, TBF-020 through TBF-022 before Clerk-dependent onboarding, TBF-030 through
  TBF-033 before tenant context or entitlements, and TBF-040 through TBF-043 before staff invitation
  or membership management. Do not infer a different order from the High/Medium/Low labels below.
- **Contracts first.** Every feature task adds or extends Zod schemas in `../contracts/src/`
  (regenerating the committed OpenAPI document) before `api` implements the route. `api` imports
  `@drezivo/contracts`; it never re-declares a wire shape locally.
- **Every mutating endpoint** satisfies `.codex/rules/nonnegotiables.md`: the shared idempotency
  middleware, or a conditional version-guarded transition, or a database unique constraint with
  recovery outside the aborted transaction — plus a sequential and concurrent double-fire test.
- **Conventions are already fixed** by the scaffold and `AGENTS.md`: thin routes → `validate`
  middleware → services (typed actor from `req.tenantContext`) → repositories (only via
  `withTenantTransaction`, explicit selects) → allowlisted DTO mappers; typed `AppError`s only;
  minor-unit money; outbox rows committed with the business change; fail closed on unknown values.

Policy values for the agreed V1 tenancy lifecycle are: 15-minute hold TTL, 24-hour maximum review
window, a single seven-day trial per verified person, and seven days of normal past-due grace before
restriction. Starter allows 75 active physical assets and 1 Front Desk seat; Professional allows
250 and 3; Business allows 1,000 and 10. Trial signup does not require a card; post-trial
activation is an audited operator payment flow until a payment gateway is selected. Implement these
as named configuration, never as scattered literals.

## Already built — do not redo

The scaffold already provides these. Tasks below build on them; none of them re-implements them.

- **App wiring** (`src/app.ts`): request-id → pino-http (redacted) → Clerk context → bounded JSON
  body → `/api/v1` routers → global error handler → standard 404 shape. Graceful shutdown in
  `src/server.ts`.
- **Validated config** (`src/config/index.ts`): every env var declared once, startup fails closed.
  Includes S3 and worker settings.
- **Database client** (`src/db/client.ts`): one shared pool; `withTenantTransaction` sets
  `app.tenant_id`/`app.principal_id` via parameterized `SET LOCAL` on the same checked-out
  connection and fails closed on a missing tenant.
- **Migrations 0000–0008** (`src/db/migrations/`): extensions (`btree_gist`), tenancy (partial
  unique default branch, same-tenant FK triggers), catalogue/assets, **`asset_allocation` with the
  GiST exclusion constraint and one-blocking-allocation-per-line partial index**, reservations
  (state CHECKs, custody business keys), finance (posting business keys, append-only guards),
  outbox/jobs/billing, idempotency, **RLS with `FORCE ROW LEVEL SECURITY`, `drezivo_app` /
  `drezivo_worker` roles, no `BYPASSRLS`, `REVOKE`d UPDATE/DELETE on append-only tables**.
- **Middleware**: `validate` (Zod at the boundary), `requireStaffAuth` (Clerk → typed principal),
  `requireTenantContext` (org → tenant + active membership + permission codes, concealed 404/403),
  `idempotent` (claim/replay/finalize), in-process `rateLimit`, `requestId`, `errorHandler`.
- **Shared layer**: typed error hierarchy, success/error envelopes, keyset pagination helper,
  minor-unit money helpers, `Result` type, redacted logger.
- **Worker** (`src/worker.ts`, `src/worker/runner.ts`): lease-claim polling with
  `FOR UPDATE SKIP LOCKED`, bounded retry with backoff, dead-letter; hold-expiry sweep that
  conditionally expires and releases allocations per tenant; outbox dispatcher stub that fails
  closed (no provider wired).
- **Storefront read repository** (`src/modules/storefront/storefront.repository.ts`): published
  slug → tenant resolution and a day-bucket availability read model (not yet routed; routes return
  501).

No migration has been applied to a live database yet. Merged migration files are still immutable —
schema corrections ship as new numbered migration files, never edits to 0000–0008.

---

## Tenancy foundation prerequisite (TBF)

These phases are the required dependency chain for all tenant-scoped backend work. The detailed
acceptance criteria and evidence remain in [`TENANCY-ONBOARDING-V1-CHECKLIST.md`](TENANCY-ONBOARDING-V1-CHECKLIST.md).

1. **Phase 1, global account and pre-tenant state:** TBF-010 through TBF-012.
2. **Phase 2, Clerk integration and owner onboarding:** TBF-020, TBF-022, then TBF-021.
3. **Phase 3, tenant bootstrap, context, and entitlements:** TBF-030 through TBF-033.
4. **Phase 4, Front Desk invitations and memberships:** TBF-040 through TBF-043.
5. **Phase 5, operator payment, recovery, and closure:** TBF-050 through TBF-053.
6. **Phase 6, reconciliation, security tests, and operating readiness:** TBF-060 through TBF-062.

The API creates the Clerk organization for a verified owner. An operator does not create an
owner's organization as the normal signup path. A user with an invitation bypasses owner onboarding
and can become Front Desk only through the verified invitation-claim flow.

TBF-032 is complete as an internal service slice: actor context and tenant bootstrap share the
authoritative active v1 plan resolver, and catalogue/seat writers must use its tenant-lock quota
guards. TBF-040 now extends Front Desk seat usage with unexpired pending invitation reservations;
the invitation outbox is a TBF-041 dispatch boundary. The H06 and L02 lifecycle work remains open.

TBF-033 is implemented as the Phase 3 lifecycle boundary: request-time actor resolution and the
durable worker share database-time trial/grace transitions, the restricted/cancelled action matrix,
and the Owner-only trial plan-change command. Paid-plan changes, payment activation, and recurring
billing remain L03/L05 work after TBF-051.

TBF-041 is implemented as the invitation provider-dispatch boundary (integration evidence pending):
the durable worker validates TBF-040 payloads, locks the tenant invitation, resolves the persisted
Clerk organization, decrypts recipient data only inside the worker, and uses a private dispatch
marker to recover accepted provider invitations without duplicates. Resends revoke prior active
provider invitations; cancellations compensate provider state; stale dispatch versions are no-ops.
The worker now claims only due rows and requires its lease token for completion and dead-lettering.
Membership-removal dispatch remains TBF-043 and invitation claim remains TBF-042.

---

## HIGH (P0) — owner workspace transactional core

Build these first, in order. Together they let one rental business operate real rentals
end-to-end: catalogue → booking → payment verification → pickup → return → inspection → cleaning
→ completion → deposit settlement.

### H01 — Adopt `@drezivo/contracts` as the api wire boundary

- **Depends on:** nothing (the contracts package exists and builds).
- **Basis:** TRD §2.1, §4 ("`api` implements the contract and does not define it"); `contracts/src/common/{envelope,pagination,errors,ids,money,idempotency}.ts`; `src/shared/{response,pagination,errors}.ts`; `src/modules/storefront/storefront.schemas.ts`.
- **Outcome:** `api` imports every wire shape from `@drezivo/contracts`; the local duplicates are deleted; response envelopes match the contract exactly.
- **Shipped in `feat/unified-response-envelope` (contracts 0.2.0):** the discriminated envelope `{ success: true, data, request_id }` / `{ success: false, error: { code, message, fields? }, request_id }`; nested error details; the closed error-code enum including the tenancy lifecycle codes; `CAPACITY_CONFLICT`/`STATE_CONFLICT` replacing generic `CONFLICT`; the contract `field` key on validation errors; 200 + `data: null` for no-content mutations; `Retry-After` on 429; 500 `INTERNAL_ERROR` for unhandled failures; app/web clients unwrap `data` and read nested errors.
- **Acceptance criteria:**
  - [x] Success responses use the contract envelope, discriminated on `success`, with `request_id` on every response; no-content mutations return 200 + `data: null`; no freeform envelope-level `meta`.
  - [x] Error codes come from the contract `errorCode` enum — `CAPACITY_CONFLICT` and `STATE_CONFLICT` replace the generic `CONFLICT`; `NOT_IMPLEMENTED` added additively in `contracts/src/common/errors.ts`, never as inline strings.
  - [ ] List endpoints use the contract `page_meta` shape (`next_cursor` + `has_more`, limit ≤ 100) — replacing the local `next_cursor` + `limit` variant.
  - [ ] Branded IDs from `contracts/src/common/ids.ts` are used in schemas and DTOs so a cross-resource ID is a compile-time error.
  - [ ] `src/modules/storefront/storefront.schemas.ts` is deleted; route validation uses the contract schemas.
  - [ ] `api` imports `@drezivo/contracts` types at the response boundary instead of re-declaring envelopes locally (the shipped helpers currently mirror the contract shapes by hand).
  - [x] `npm run openapi:generate` in `contracts` produces no diff once committed (TRD §4).

### H02 — Corrective migrations: reconcile the database with the PRD, ERD, and contracts

- **Depends on:** nothing (database-only; can proceed in parallel with H01).
- **Basis:** PRD §3 (canonical states); Data-Model §2 (bigint minor units, `date` for event dates), §7; ERD column types; `contracts/src/finance/payment-status.ts`, `files/uploads.ts`, `tenancy/tenant.ts`; `src/db/migrations/0001–0008` vs `src/db/schema/*.ts`.
- **Outcome:** one vocabulary and one set of column types across migrations, Drizzle schema, contracts, and the PRD — shipped as new numbered migrations (0009+), never edits to merged files.
- **Confirmed mismatches to fix:**
  - [ ] Money columns are `integer` in migrations 0002/0004/0005/0006 but the ERD mandates `bigint` minor units — widen all `*_minor` columns (expand step; no data exists yet).
  - [ ] `payment.status` is `pending/verified/failed/voided`; the contract and PRD money lifecycle are `pending/partially_paid/paid/failed/refunded`. Evidence review state must not live on `payment.status`.
  - [ ] `payment_receipt.evidence_status` is `submitted/accepted/rejected`; PRD §3 requires the seven-state evidence lifecycle `not_required/awaiting_upload/uploaded/under_review/verified/rejected/superseded`, stored where the lifecycle actually runs (payment-level evidence state or per-receipt rows derived into it — pick one and make the wire match `paymentEvidenceStatus`).
  - [ ] `payment_verification.decision` lacks `ask_info` (PRD §4 "Reject/ask-info is audited") and uses `approved` where the contract says `verified`.
  - [ ] `refund.purpose` values `rental/security_deposit` do not match the contract `rental_refund/security_deposit_release/goodwill_adjustment`.
  - [ ] `branch.status` reuses the tenant states `active/restricted/cancelled`; the contract says `active/archived` and a branch is not a tenant.
  - [ ] `membership.status` must match the agreed `active` / `suspended` / `removed` contract enum;
        invitation `pending` is not a membership state.
  - [ ] `storefront.status` includes `suspended`, which no PRD workflow defines (tenant-level restriction already blocks publish changes) — remove it from the database; the contract stays `draft/published`.
  - [ ] `file_purpose` values disagree: database `payment_receipt/verification_document` vs contract `payment_evidence/identity_document`. Unify to `catalogue_image/payment_evidence/identity_document/storefront_asset/export_result` (database renames two values; contract adds the two it lacks, additively).
  - [ ] `reservation.event_date` is `timestamptz`; the ERD and contract use a calendar `date`.
  - [ ] Drizzle schema modules declare `pgEnum` types while the authoritative migrations use `text` + `CHECK` — align on one convention in both systems so `drizzle-kit generate` shows no phantom diff, and unknown values still reject at the boundary.
- **Acceptance criteria:**
  - [ ] Fresh-database migration from scratch (0000 → last) succeeds and the integration harness (H03) runs against the result.
  - [ ] A checklist audit comparing every enum/check value in migrations against `contracts/src/` and the PRD state tables finds zero remaining disagreements.
  - [ ] Corrective migrations follow the expand → backfill → validate → switch → contract rule from `src/db/migrations/README.md` where a live-compatible path matters; here no data exists, so single-step corrective files are acceptable but must be new files.

### H03 — Integration-test harness against real PostgreSQL

- **Depends on:** H02 (tests assert the corrected schema).
- **Basis:** TRD §11 ("Tests run against PostgreSQL, not SQLite or mocked locking"); `vitest.config.ts` (already includes `tests/integration/**`); CONTRIBUTING.md local `postgres:16` recipe; `src/db/migrations/README.md`.
- **Outcome:** deterministic integration tests that migrate, seed, and clean an isolated database, plus factories for the core entities.
- **Acceptance criteria:**
  - [ ] Helpers apply all migrations from scratch, truncate between tests, and never connect to a development or production database (enforced by test config, not convention).
  - [ ] Factories exist for tenant, branch, membership, category, product, variant, physical asset, customer, and staff actor contexts.
  - [ ] A sample test proves RLS behavior under the real restricted roles: `drezivo_app` with no tenant context reads zero tenant-owned rows; a cross-tenant query through the API returns 404/403 without disclosure.
  - [ ] `npm run test:integration` runs green from a clean environment against the local Docker database.

### H04 — Actor context and membership enforcement

- **Depends on:** H01, H03, TBF-030, TBF-031, TBF-040 through TBF-043.
- **Basis:** TRD §3 (staff request path, membership freshness); PRD §5 (Owner manages users; Front Desk read-only); `contracts/src/tenancy/{tenant,actor-context}.ts`; `src/middleware/tenant-context.ts`; migration 0001.
- **Outcome:** the `app` frontend can resolve a provisioned business, active local membership,
  branch grant, subscription state, and entitlement context. Workspace discovery and active
  organization resolution are server-owned; Owner staff-management routes consume the invitation
  and membership lifecycle defined by TBF-040 through TBF-043.
- **Acceptance criteria:**
  - [x] `GET /api/v1/workspaces` returns only provisioned tenants where the authenticated Clerk
        subject has an active local membership; it uses the narrow account-scoped workspace
        resolver instead of a global RLS exception.
  - [x] `GET /api/v1/actor-context` returns the contract `actorContext` shape (tenant,
        membership, active branches, selected-branch grants, subscription, and numeric
        entitlements) for an authenticated active member whose token organization matches the
        local tenant.
  - [x] `X-Drezivo-Branch-Id` is validated as a selector among active branches and never grants
        authority; missing, foreign, suspended, or removed memberships fail closed.
  - [x] Restricted and cancelled tenant states reach one shared lifecycle policy gate, with
        `TENANT_CANCELLED` represented in the closed contract error enum.
  - [x] PostgreSQL integration evidence passes for cross-tenant workspace isolation, tenant-scope
        denial, branch selection, and lifecycle resolution (`tests/integration/actor-workspace-resolution.test.ts`).
  - [ ] Owner-only membership list and removal endpoints; Front Desk actors receive 403 and can
        only read their own membership context.
  - [ ] Removal or suspension takes effect on the member's next request even with a still-valid
        Clerk session (the existing per-request membership check proves it in a test).
  - [ ] Membership records are never deleted — removal is a status change so custody/audit actors keep resolving.
  - [ ] Cross-tenant membership IDs produce concealed not-found/forbidden responses without confirming existence.

### H05 — Files and object storage module

- **Depends on:** H01, H02, H03.
- **Basis:** TRD §4 (`/uploads`), §7 (presign, finalize, privacy); PRD §5 (private document access rules); `contracts/src/files/uploads.ts`; `src/config/index.ts` (S3 settings exist); `src/db/schema/files.ts`; migration 0002.
- **Outcome:** validated, tenant-scoped upload authorization and immutable accepted objects for catalogue photos, payment-method QR images, receipts, and identity documents.
- **Acceptance criteria:**
  - [ ] `POST /uploads` authorizes purpose, content type, and byte size per the contract; keys use generated tenant-aware prefixes and never trust client filenames.
  - [ ] Finalization freezes the exact accepted bytes (object version or immutable final-key copy plus `sha256` and `frozen_at`); a later reuse of the same upload URL cannot change what was accepted (TRD §7 adversarial test 8).
  - [ ] Private files are readable only through short-lived signed URLs after authorization; public derivative URLs are issued only for explicitly public assets — replacing the storage-key-as-URL placeholder in `storefront.repository.ts`.
  - [ ] Cross-tenant file references are rejected at attach and read time.
  - [ ] Upload-purpose policy (10 MB bound; tighter per-purpose limits) is enforced server-side before signing.

### H06 — Catalogue and physical asset management

- **Depends on:** H02, H03, H04, H05 (images), TBF-032 (entitlement service).
- **Basis:** PRD §3 (three identities), §4 (FR8 inventory model, FR9 categories), §6 (asset quotas); Data-Model §5; TRD §2 (Catalogue/assets row); ERD `category/product/product_variant/physical_asset/product_image`; migrations 0002; contracts `storefront/catalogue.ts` (public projection already defined).
- **Outcome:** owners and front desk manage styles, variants, individually tracked garments, and imagery; the public projection stays separate from staff DTOs.
- **Acceptance criteria:**
  - [ ] Category, style, variant, and asset CRUD with archive-not-delete; records referenced by transactions cannot be hard-deleted.
  - [ ] Variants carry validated numeric measurements with unit, `fixed_duration`/`daily` pricing, extra-day price, prep and turnaround minutes — all bounded and nonnegative.
  - [ ] Physical assets carry unique codes, lifecycle, readiness, custody kind, condition and alteration notes, and a version column for conditional updates.
  - [ ] Plan entitlements are seeded with the authoritative prices (Starter 30000 / Professional 49900 / Business 129900 PHP minor units per month) and the active-asset quota is checked under a tenant lock at creation and activation, with a clear upgrade/archive path that never deletes records.
  - [ ] Product images attach, order, and designate a primary through finalized file objects of the same tenant; exactly one primary when images exist.
  - [ ] Staff DTOs never expose storage keys; public-safe DTOs (contract `catalogue.ts`) omit internal notes, asset codes, and condition data.
  - [ ] Double-fire and tenant-isolation tests pass for every mutating route.

### H07 — Operational availability blocks

- **Depends on:** H06.
- **Basis:** PRD §4 (cleaning/maintenance/manual blocks, FR7 calendar conflict reasons); Data-Model §5 (canonical planned block); TRD §5; ERD `maintenance_work_order`, `asset_allocation` (kind `maintenance`); migration 0003.
- **Outcome:** staff can block an asset for cleaning, repair, or manual unavailability through the same exclusion-protected allocation table reservations use.
- **Acceptance criteria:**
  - [ ] Creating a block writes a `maintenance_work_order` plus one blocking `asset_allocation` in one transaction; a conflicting block or booking fails on the GiST exclusion, not in service code.
  - [ ] Periods are nonempty, finite, half-open `[)` ranges; reversed/invalid ranges reject with 422.
  - [ ] Closing a block releases its allocation transactionally; historical blocks are retained.
  - [ ] A staff availability query explains blocking reasons per asset/date window without exposing other customers' personal data.
  - [ ] Concurrent block-vs-block and block-vs-hold races produce exactly one winner (adversarial test).

### H08 — Customer directory

- **Depends on:** H03, H04.
- **Basis:** PRD §4 (FR10 customers, privacy minimums); Data-Model §4/§12 (`customer`); migration 0004; ERD `customer`.
- **Outcome:** owners and front desk create, find, view, and update tenant-scoped customer records with notes and history.
- **Acceptance criteria:**
  - [ ] Present emails are normalized (trim + lowercase) and deduplicated within the tenant only; staff-created customers may omit email.
  - [ ] Search covers name, phone, and email with keyset pagination and deterministic order.
  - [ ] Detail includes authorized notes (with author and timestamps) and paginated reservation/payment history projected from source transactions — no duplicated mutable totals.
  - [ ] Customer records are invisible across tenants; anonymization (erasure) preserves legally required reservation facts per the documented retention process.
  - [ ] New contract surfaces for customer endpoints are added to `contracts/src/` first.

### H09 — Reservations core: shared allocator and staff booking

- **Depends on:** H06, H07, H08, H01, H03.
- **Basis:** TRD §5 (hold transaction steps 1–5); Data-Model §6 (hold recipe); PRD §3 (invariants), §4 (walk-in uses same allocator, FR6); `contracts/src/reservations/{hold,reservation,state}.ts` (staff create shapes already defined); ERD `reservation/reservation_line/asset_allocation`; migrations 0003/0004.
- **Outcome:** one transactional booking service that computes the quote server-side, claims an asset exclusively, and snapshots everything — used by staff walk-ins now and the guest flow in M03 without change.
- **Acceptance criteria:**
  - [ ] The service validates storefront/branch/dates/policy bounds, computes price and due-now from variant pricing and the policy snapshot, and ignores any client-sent totals.
  - [ ] Candidate assets are locked in deterministic ID order; expired holds are transitioned using database time before claiming; the blocking allocation insert is protected by the GiST exclusion.
  - [ ] Reservation header, line, snapshots, blocking allocation, audit event, and outbox event commit atomically; payment instructions appear only after commit.
  - [ ] `POST /reservations` (staff) uses the contract `staffReservationCreateRequest` and starts at `held` with the reference code generated server-side.
  - [ ] List and detail read models support status, payment, date-range, clothing, and customer filters with keyset pagination, stable indexed sort, and the shared reservation summary projection.
  - [ ] Two concurrent bookings for the same garment produce one success and one `CAPACITY_CONFLICT`; sequential and concurrent double-fire with the same idempotency key produce one reservation.
  - [ ] Failure at any step rolls back with no orphaned allocations.

### H10 — Reservation lifecycle actions

- **Depends on:** H09; the confirm action additionally requires H11's verification transaction.
- **Basis:** Data-Model §6 (state machine and recipes — reject unknown transitions and stale versions); TRD §5 (reschedule/cancellation/return contracts); PRD §4 (operations, FR6, OR10); `contracts/src/reservations/actions.ts` (confirm/reschedule/cancel/pickup/return shapes already defined); ERD `custody_event/disruption`.
- **Outcome:** every state transition is a single conditional, version-guarded update with its side effects in the winning transaction.
- **Acceptance criteria:**
  - [ ] Confirm, reject, cancel, reschedule, pickup, return, and complete reject illegal transitions and stale versions with `STATE_CONFLICT` (409) and no partial writes.
  - [ ] Reschedule acquires the new allocation before releasing the old one in one transaction; a conflict rolls back completely and preserves the original booking and accepted price; repricing requires explicit `accept_price_change`.
  - [ ] Cancellation before handover releases the future block and records any financial obligation atomically; a picked-up rental cannot be cancelled into "available".
  - [ ] Pickup requires confirmed booking, allocation, physical presence, readiness, and payment/policy prerequisites; it records an immutable custody event (business-key duplicate-safe) and transitions custody/readiness in the same transaction.
  - [ ] Return records the actual time and condition even when late — never rejected because it intersects a future allocation — flags affected future bookings as disruptions, and leaves inspection/cleaning as separate steps (readiness is not implied).
  - [ ] Expiry after evidence submission still honors the maximum review deadline; late external payments route to the payment-exception queue (refund or fresh booking), never a revived allocation.
  - [ ] Every transition writes audit and outbox rows in the winning transaction and passes double-fire tests.

### H11 — Payments and money workflow

- **Depends on:** H09, H02 (corrected enums), H05 (receipt files), H04 (owner capability).
- **Basis:** TRD §6 (operational finance); Data-Model §7 (posting meanings, balances, concurrency); PRD §3 (money lines), §4 (FR12, FR22, OR9 deposit settlement); `contracts/src/finance/{payment-status,receipts,refunds}.ts`; ERD `payment/payment_receipt/payment_verification/charge/payment_allocation/refund/deposit_entry`; migration 0005.
- **Outcome:** a correct rental subledger: installments, evidence review, verified collections, deposit liability, and capped refunds.
- **Acceptance criteria:**
  - [ ] Payments are recorded per reservation with manual rails (cash/manual_qr/manual_transfer); multiple payments model installments and the money status reaches `partially_paid` correctly; payment state is independent of reservation state.
  - [ ] Receipts attach finalized private file objects; uploading evidence never marks money as collected — evidence status and money status stay separate tracks.
  - [ ] Owner verification records an immutable decision (`verified`/`rejected`/`ask_info`) with actor, amount, reference, and note; `ask_info` is audited and cannot extend the maximum review deadline; repeated approval returns the original outcome (one successful settlement per payment via locked conditional transition).
  - [ ] Verified collections post append-only `charge`/`payment_allocation`/`deposit_entry` rows with `(tenant_id, business_key)` keys; the runtime role's `REVOKE`s make update/delete fail at the database.
  - [ ] Deposit settlement is itemized: full release, partial refund less approved charge, or retention with reason and snapshot; refunds reserve the refundable balance immediately and are capped by `U = P − A − H − R ≥ 0` under row locks — two concurrent refunds can never jointly exceed the remaining balance.
  - [ ] Refund completion is a verified manual record, never automatic money movement; failure/cancellation restores reserved balances atomically.
  - [ ] Cash collected, rental revenue, and deposit liability are displayed as separate totals; summaries only count finalized states.
  - [ ] Concurrent posting and refund-race tests pass against real PostgreSQL.

### H12 — Security and adversarial matrix for the owner workspace

- **Depends on:** H04–H11.
- **Basis:** TRD §3 (tenant context rules, boundary tests), §11 (adversarial tests 1–14); PRD §8 (tests before V1); Data-Model §11 (falsification checklist).
- **Outcome:** the High tier's isolation, duplicate-safety, and capacity invariants are proven, not assumed.
- **Acceptance criteria:**
  - [ ] Cross-tenant IDs submitted through every implemented route, job, and export produce no disclosure or mutation — including pooled-connection reuse after rollback.
  - [ ] Every owner-only route has a front-desk denial test; every protected route has an unauthenticated test.
  - [ ] Every mutating endpoint has sequential and concurrent double-fire tests asserting one business effect.
  - [ ] Last-garment contention, approval-vs-expiry races, failed reschedules, late returns, and refund-cap races behave exactly as the TRD §11 scenarios describe.
  - [ ] A worker job with no resolvable tenant fails closed; consecutive jobs for different tenants on the same pooled connection leak nothing (TRD §11 test 13).

---

## MEDIUM (P1) — V1 completeness

Required for the V1 release; sequenced after the transactional core. Guest-facing work reuses the
H09 allocator unchanged.

### M01 — Storefront publish workflow and settings

- **Depends on:** H04 (owner), H05 (QR image), H06 (rentable asset).
- **Basis:** PRD §4 (onboarding/live publish, FR13, FR14); TRD §4; Data-Model §12; ERD `storefront/policy_snapshot/payment_method`; migration 0004.
- **Outcome:** an owner can author policies, configure payment methods, and publish a storefront that meets the PRD publish prerequisites.
- **Acceptance criteria:**
  - [ ] Policy snapshots are versioned and immutable once referenced by a reservation; edits create a new version, never mutate an existing one.
  - [ ] Payment methods are owner-edit-only with versioned destination snapshots (a new version replaces shown instructions, never an in-place edit) and optional QR image via the files module.
  - [ ] Publish requires contact, policy, payment instruction, and at least one active rentable asset; preview equals the public route using draft content.
  - [ ] Publish and first-availability events are instrumented (outbox) for the PRD §9 gate metrics.
  - [ ] Contract surfaces for owner settings/publish endpoints are added first.

### M02 — Wire public storefront reads to the contracts

- **Depends on:** M01, H06, H01.
- **Basis:** TRD §4 (`/public/stores/{slug}` and `/availability` rows); `contracts/src/storefront/{storefront,catalogue}.ts`, `availability/availability.ts`; `src/modules/storefront/storefront.repository.ts` (exists, unrouted).
- **Outcome:** the existing repository is aligned to the contract shapes and routed; the 501s are gone.
- **Acceptance criteria:**
  - [ ] `GET /public/stores/{slug}` returns the contract `publicStorefront` projection; unpublished or foreign slugs return 404.
  - [ ] Catalogue listing/detail return the contract `catalogueItem`/`itemDetail` shapes with public derivative image URLs (not storage keys).
  - [ ] Availability answers the contract `availabilityResult` shape (`variant_id` + `requested_interval`, available + server-computed price preview) and is documented as advisory — never a capacity guarantee.
  - [ ] Hidden categories and unpublished content never appear in public results.

### M03 — Guest checkout flow

- **Depends on:** M01, M02, H09, H10, H11, H05; resend delivery additionally requires M08.
- **Basis:** PRD §4 (FR15–FR22, OR5 hashed guest link); TRD §3 (guest access), §4, §5 (receipt and confirmation); `contracts/src/reservations/hold.ts`, `guest/guest.ts`, `finance/receipts.ts`; ERD `guest_access_token`.
- **Outcome:** a guest can hold one garment, submit evidence, see their own status, and cancel/reschedule through a scoped capability.
- **Acceptance criteria:**
  - [ ] `POST /public/stores/{slug}/holds` runs the shared H09 allocator with a rate-limited anonymous checkout principal and idempotency; it returns payment instructions and expiry only after commit.
  - [ ] The guest capability token is high-entropy, returned once, stored only as a hash, scoped to one reservation with allowlisted per-state scopes, and exchangeable for a host-only HttpOnly Secure cookie; reference codes and emails are never authentication.
  - [ ] Receipt submission attaches finalized private evidence before expiry and moves evidence + reservation to `pending_confirmation` while retaining the allocation; review deadline stays bounded at 24 hours from initial acquisition.
  - [ ] Guest reservation view is `no-store`, shows snapshots and separate money lines, and never says "Paid" for uploaded evidence.
  - [ ] Resend link returns a generic response, is rate-limited by destination and source, and never reveals a reservation before verification.
  - [ ] Cancel/reschedule through the guest capability revalidate availability before releasing the old allocation; a failed reschedule leaves the old booking intact.

### M04 — Operations dashboard read model

- **Depends on:** H09, H10, H11, H07.
- **Basis:** PRD §4 (FR5 dashboard queues); TRD §2 (Dashboard derived read model); PRD §8 (instrumented metrics).
- **Outcome:** one bounded read endpoint supplies the dashboard's operational queues.
- **Acceptance criteria:**
  - [ ] Queues cover today's pickups and returns (tenant-timezone "today"), pending evidence review, expiring holds, overdue/late flags, and cleaning/maintenance work.
  - [ ] Counts and linked lists use identical status definitions; sections have explicit item limits linking to the paginated modules.
  - [ ] Empty tenants return valid zero/empty states; queries fetch only required fields.

### M05 — Unified calendar

- **Depends on:** H09, H10, H07.
- **Basis:** PRD §4 (FR7 interval calendar with conflict reasons); TRD §9 (bounded calendar windows); Data-Model §5.
- **Outcome:** a derived calendar projection across reservations, pickups, returns, and blocks — no separately editable calendar table.
- **Acceptance criteria:**
  - [ ] A required, bounded date range rejects or caps oversized windows.
  - [ ] Events carry stable types, source IDs, status, start/end, and customer-safe summaries rendered in the tenant timezone.
  - [ ] Blocking reasons are visible per asset/day (booking hold, confirmed rental, cleaning, maintenance, manual block) without exposing other customers' private data.
  - [ ] Cancelled/rejected sources follow explicit visibility filters; daily counts match filtered events.

### M06 — CSV import (OR6)

- **Depends on:** H06, H05, H03.
- **Basis:** PRD §4 (CSV preview, row validation, duplicate detection, idempotent commit); Data-Model §8 (`import_job`); migration 0006.
- **Outcome:** owners can bulk-import catalogue rows with preview and all-or-nothing commit.
- **Acceptance criteria:**
  - [ ] Preview validates every row and reports per-row errors; invalid rows write nothing.
  - [ ] Commit is atomic and idempotent by `(tenant_id, intent_key)`; duplicate submissions produce one import.
  - [ ] Duplicate detection covers asset codes and SKUs; the asset-quota check runs under the same tenant lock as manual creation.
  - [ ] Result summaries are bounded and contain no secrets or private data.

### M07 — Async exports (OR7)

- **Depends on:** H05, H04, worker.
- **Basis:** PRD §4 (exports show progress and require authorization); TRD §4 (`/exports`); Data-Model §8 (`export_job`); migration 0006.
- **Outcome:** durable, authorized, expiring CSV exports through the existing outbox worker.
- **Acceptance criteria:**
  - [ ] Export requests create a durable job with a scope snapshot; the worker renders CSV with formula-injection protection.
  - [ ] Results are private file objects with expiring downloads; authorization is rechecked at download time.
  - [ ] Progress and completion are queryable; failures are surfaced, never silently dropped.
  - [ ] Exports include stable IDs and understandable booking/financial references (PRD §11 portability row).

### M08 — Email adapter and notification delivery

- **Depends on:** H03 (tests); worker scaffolding exists.
- **Basis:** TRD §8 (outbox, retries, exactly-once caveats), §1 (SES adapter recommendation); PRD §6 (notification states); `src/worker/handlers/outbox-dispatcher.ts` (fails closed today); ERD `notification_delivery`.
- **Outcome:** queued guest/merchant notifications actually send, with honest delivery states.
- **Acceptance criteria:**
  - [ ] A provider adapter behind an interface handles sender verification and bounces; the outbox dispatcher is wired to it.
  - [ ] `notification_delivery` distinguishes queued / provider-accepted / delivered / bounced / failed; the UI never says "sent" before provider acknowledgment.
  - [ ] Reservation success is never coupled to email success; retries use the existing lease/backoff/dead-letter machinery.
  - [ ] Reminder-type messages recheck the reservation version before sending so obsolete details are not sent after a reschedule.

### M09 — Audit coverage completion

- **Depends on:** H04–H11 (features whose actions need auditing).
- **Basis:** PRD §5 (audited actions), §7 (OR8); Data-Model §4 (`audit_event` append-only); migration 0006.
- **Outcome:** every sensitive owner/operator action writes a redacted audit event.
- **Acceptance criteria:**
  - [ ] Payment verification, refunds, deposit settlement, policy/payment-method changes, membership changes, publish, imports, and exports all write audit rows with actor, action, entity, request id, and a redacted summary.
  - [ ] Audit rows never contain full before/after payloads, tokens, or payment destination secrets; the role's `REVOKE` prevents updates.
  - [ ] Audit reads are owner-scoped and tenant-isolated.

### M10 — API reference for frontend integration

- **Depends on:** H01 and the contract surfaces of completed features.
- **Basis:** TRD §4 (OpenAPI generated and committed); `contracts/openapi/`; the old tasks doc's DOC-001 intent, restated on the current model.
- **Outcome:** `app` and `web` teams can integrate against generated OpenAPI plus a written reference.
- **Acceptance criteria:**
  - [ ] Generated OpenAPI matches the implemented routes with no diff after regeneration.
  - [ ] The reference documents enums, state transitions, permissions, error envelopes, pagination, money, dates, and upload flows, matching the Zod schemas exactly.
  - [ ] Examples contain no real credentials or personal data.

---

## LOW (P2) — platform, operator, and hardening

Required before paid production launch, but not for the owner workspace to operate against
factory-seeded tenants during development.

### L01 — Operator-assisted payment activation and recovery (OR1)

- **Depends on:** TBF-050, TBF-051, TBF-052, TBF-053.
- **Basis:** TBF-050 through TBF-053; TRD §3 (platform support separation); ERD
  `tenant/branch/membership/storefront`.
- **Outcome:** a Drezivo operator can verify payment, recover provider drift, or close a tenant
  through audited, operator-only workflows. Normal signup and tenant bootstrap remain owner-driven
  through TBF-021 and TBF-030.
- **Acceptance criteria:**
  - [ ] Payment-pending activation, provider-organization loss, and permanent closure are
        idempotent, recoverable, and audited.
  - [ ] Operator identity and routes are separate from tenant accounts; no default impersonation.
  - [ ] No route claims automated recurring billing or accepts card/payment credentials in V1.

### L02 — Entitlement and plan-quota lifecycle (OR2)

- **Depends on:** H06 (quota check machinery), plan seed.
- **Basis:** PRD §6 (authoritative plans, quota semantics); TRD §6; ERD `plan/plan_entitlement`; migration 0006.
- **Outcome:** plan versions and entitlements are managed as data, not code, and quota checks stay correct under concurrency.
- **Acceptance criteria:**
  - [ ] Plan prices are versioned rows (30000/49900/129900 PHP minor units) with authoritative
        active-asset limits 75/250/1,000 and Front Desk seat limits 1/3/10; marketing/entitlement
        values never come from the outdated screenshot.
  - [ ] Entitlement changes are additive/versioned; unreleased features (fittings, branches) cannot be purchased as available.
  - [ ] Concurrent import/activation quota checks cannot exceed the cap; the path is upgrade/archive, never deletion.

### L03 — Subscription billing lifecycle (OR3)

- **Depends on:** TBF-033, TBF-051, L02.
- **Basis:** PRD §6 (trial/active/past_due/restricted/cancelled); TRD §6 (billing lifecycle); ERD `subscription/subscription_event/subscription_payment`; migration 0006.
- **Outcome:** billing state transitions are recorded and enforced without breaking existing rentals.
- **Acceptance criteria:**
  - [ ] One current subscription per tenant; transitions are immutable events with business keys; no silent repricing of an existing period.
  - [ ] V1 collection verification is audited operator action, not implied automated recurring billing.
  - [ ] Expiry/grace processing runs through durable jobs plus request-time checks; the seven-day
        trial and seven-day normal past-due grace are named configuration.
  - [ ] Restricted state blocks new bookings/publish changes while preserving returns, refunds,
        exports, and existing-rental read access (verified by L04).

### L04 — Restricted-tenant continuity tests (OR3)

- **Depends on:** L03, M03.
- **Basis:** TRD §11 adversarial test 11; PRD §6.
- **Outcome:** mid-rental suspension is proven safe.
- **Acceptance criteria:**
  - [ ] A restricted tenant's public checkout fails closed; authorized staff return/refund/export
        operations still succeed.
  - [ ] Existing guest capability links keep read/settlement scopes but cannot create new holds.

### L05 — Operator support grants (OR4, OR8)

- **Depends on:** H04, M09 (audit).
- **Basis:** TRD §3 (platform support, time-limited grants); PRD §7 (OR4, OR8); ERD `support_grant/audit_event`.
- **Outcome:** audited, time-boxed operator access to one tenant with a separate private-evidence permission.
- **Acceptance criteria:**
  - [ ] Grants are reason-coded, time-bounded, revocable, and audited at issuance/use/revocation.
  - [ ] Private evidence access requires the separate capability; there is no universal bypass role.
  - [ ] Grant expiry is enforced at request time, not only by a sweep.

### L06 — Clerk webhook reconciliation hardening

- **Depends on:** TBF-022, TBF-041, TBF-042, H03; `webhook_inbox` schema exists.
- **Basis:** TBF-022, TBF-041, and TBF-042; TRD §3 (membership freshness, webhook inbox), §8
  (webhook safety); ERD `webhook_inbox/membership`.
- **Outcome:** the verified Clerk intake and invitation claim paths are reconciled periodically so
  provider drift and out-of-order events cannot re-enable removed users. Raw webhook intake is a
  Phase 2 prerequisite, not a deferred low-priority feature.
- **Acceptance criteria:**
  - [ ] Webhook endpoints verify signatures over exact raw bytes, insert unique provider event IDs before processing, and return success for duplicates without re-processing.
  - [ ] Local removal always wins over an out-of-order re-add; periodic reconciliation repairs drift.
  - [ ] Sensitive actions recheck membership freshness per TRD §3.

### L07 — Production indexes and query bounds (PERF)

- **Depends on:** M04, M05 (read models to measure).
- **Basis:** TRD §9 (scaling triggers, keyset pagination, bounded windows); Data-Model §10 (invariant 10).
- **Outcome:** list, availability, calendar, dashboard, and overdue queries are index-backed and bounded.
- **Acceptance criteria:**
  - [ ] Indexes lead with `tenant_id` for tenant-scoped access patterns; GiST interval indexes cover overlap reads.
  - [ ] Status/date, customer-search, hold-expiry, and outbox-dispatch queries are covered by measured plans, not guesswork.
  - [ ] Page sizes are enforced maxima with deterministic sorts; unbounded windows reject.

### L08 — NFR and load verification

- **Depends on:** L07 and feature completion.
- **Basis:** TRD §11 (targets and falsification); PRD §8.
- **Outcome:** the proposed launch targets are measured once, with recorded environment, dataset, error mix, and raw percentiles.
- **Acceptance criteria:**
  - [ ] Availability p95 ≤ 500 ms and mutation p95 ≤ 1 s measured at the TRD §11 representative load (100 tenants, 1,000 assets busiest tenant, 50 req/s incl. 5 mutations/s for 30 minutes).
  - [ ] Expired-hold release p95 ≤ 60 s with the worker stopped for an hour, then reclaimed.
  - [ ] Same-asset contention tested separately from the general load profile.

### L09 — V1 release gate (REL)

- **Depends on:** everything above.
- **Basis:** PRD §9 (release gates); TRD §12 (operational readiness); the old tasks doc's REL-001 intent, restated on the current model.
- **Outcome:** the backend is ready for controlled V1 deployment.
- **Acceptance criteria:**
  - [ ] Fresh-database migrations apply cleanly; lint, typecheck, unit, integration, and build pass from a clean environment.
  - [ ] No test touches a development or production database; environment variables and operational setup are documented.
  - [ ] The full test matrix below is green, including zero duplicate allocations/postings.
  - [ ] Deferred work (none within V1 scope after M/L completion) is recorded without blocking.

---

## Required test matrix (release requirements)

From TRD §11 and PRD §8, scoped to V1. These hold even when a task also lists them; the release
gate re-runs the whole matrix.

**Tenant isolation and membership**

- A verified account can create only its own Clerk organization and resume one unfinished
  onboarding; concurrent create/bootstrap retries produce one organization, tenant, and lifetime
  trial. An invited user cannot take the owner path and can activate Front Desk only through a
  verified invitation claim.
- Tenant A submits tenant B's branch/asset/file/payment/reservation IDs through every route, job,
  and export — no disclosure, no mutation. Repeat with pooled-connection reuse after rollback.
- Revoked or suspended members lose access on their next request despite valid Clerk sessions;
  out-of-order webhook events cannot restore access (after L06).
- Front Desk receives 403 from every owner-only route; foreign objects return 404, never 403.

**Capacity and transactions**

- Two guests (or staff) request the same physical garment concurrently: exactly one blocking
  allocation; the loser gets `CAPACITY_CONFLICT`. Repeat with different idempotency keys, retries,
  and a stale catalogue cache.
- Adjacent `[)` intervals succeed; overlapping inserts fail on the exclusion constraint.
- Submit/approve/reject/expire the same hold concurrently: one legal result, one posting, one
  event per business key.
- Failed reschedule preserves the original allocation, price, and policy snapshots.
- Sequential and concurrent double-fire of every mutation produces one business effect.
- Worker stopped for an hour: holds are reclaimed transactionally, notifications stay queued,
  replay duplicates nothing financial.

**Money, dates, and timezones**

- Two concurrent refunds/deposit releases cannot jointly exceed the remaining refundable balance;
  deposit receive/apply/release/reversal round-trips keep `U = P − A − H − R` nonnegative.
- Minor-unit money round-trips without floating-point loss; historical snapshots never change
  after catalogue or settings edits.
- DST for a future non-Manila tenant, exact adjacent intervals, midnight returns, and invalid
  ranges are exercised; rental dates never shift through timezone conversion.

**Files and privacy**

- Reused upload URLs cannot change approved evidence; oversized/deceptive content and foreign
  file attachments reject.
- Private receipt URLs expire and require authorization; public DTOs never contain storage keys,
  internal notes, tokens, or other customers' data; logs contain none of it.

**Read models and API consistency**

- Every endpoint uses the shared envelopes; every list uses the fixed `page_meta`; filters, counts,
  and details apply identical status definitions; empty tenants return valid empty states.

## Definition of done

The V1 backend is complete when:

- A verified owner can create/resume onboarding, choose a plan, and provision one tenant through
  TBF-021/TBF-030; the owner can then configure policies and payment methods (M01), build a
  catalogue with individually tracked garments (H06), and manage staff access (H04).
- Owners and front desk can book, verify money, hand over, inspect, and settle rentals end-to-end
  (H09–H11) with dashboard and calendar visibility (M04/M05).
- Guests can complete the single-garment checkout flow against a published storefront (M02/M03).
- Every mutation is duplicate-safe, every route is tenant-safe, and the full test matrix above is
  green against real PostgreSQL (H03/H12, L04, L08).
- Migrations, lint, typecheck, unit, integration, and build pass from a clean environment, and the
  generated OpenAPI document matches the implemented contract (H01, M10, L09).
