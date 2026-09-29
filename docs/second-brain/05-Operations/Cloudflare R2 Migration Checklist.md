---
title: Cloudflare R2 Object Storage Migration Checklist
type: implementation-checklist
status: in-progress
owner: Drezivo team
source: "Product-owner direction, ADR 0010, Cloudflare R2 documentation, and repository inspection"
updated: 2026-09-29
tags: [drezivo, files, storage, cloudflare, r2, migration, checklist]
---

# Cloudflare R2 Object Storage Migration Checklist

**Status:** Repository implementation is in progress under the product owner's explicit R2 direction. Production cutover remains blocked on the object inventory, workload/cost model, migration/rollback design, privacy review, live provider tests, and deployment configuration below.
**Decision direction:** Replace the AWS S3 production-storage design with Cloudflare R2 while keeping the existing provider-neutral upload API and local MinIO development workflow. CloudFront is not an implemented repository runtime dependency today; if external CloudFront infrastructure exists outside this repo, inventory and reconcile it explicitly rather than treating it as an assumed in-repo migration target.
**Canonical specifications:** [PRD](../../product/Drezivo-PRD.md), [TRD](../../architecture/Drezivo-TRD.md), [Data Model](../../architecture/Drezivo-Data-Model.md), [ERD](../../architecture/Drezivo-ERD.dbml), and [ADR 0010](../../decisions/0010-cloudflare-r2-object-storage.md). ADR 0010 records R2 as the selected target, not a completed production cutover.
**Primary code:** `api/src/integrations/storage/`, `api/src/modules/files/`, `api/src/config/`, `contracts/src/files/uploads.ts`, and the staff upload callers under `app/src/`.

## How to use this checklist

Implement in order. This migration is not just an endpoint swap. The current file model intentionally freezes accepted bytes, and the R2 migration must preserve that invariant without relying on AWS S3 bucket versioning.

Before marking a task complete:

- Browser clients never receive unrestricted object-storage credentials.
- Every object key remains tenant-aware and unpredictable.
- Accepted files cannot be overwritten by reusing an unexpired upload authorization.
- File finalization still verifies authorized size, MIME type, SHA-256, and actual file signature.
- Private evidence remains private and uses short-lived signed reads.
- Public catalogue delivery is separated from private source/evidence storage.
- The R2 production path does not introduce a runtime dependency on AWS-specific region, IAM, CloudFront, bucket-versioning, or hostname behavior; any externally provisioned AWS/CloudFront infrastructure discovered during inventory is reconciled explicitly.
- Local MinIO remains usable for development unless a reviewed replacement is explicitly approved.
- Secrets are deployment-managed only; no `.env*` file is tracked.

## Pre-implementation baseline snapshot (verified 2026-09-29 before adapter changes)

The following records the repository state before this migration's implementation began; it is
historical evidence, not a description of the current branch.

- The API already exposes a provider-neutral `ObjectStorage` interface with `authorizeUpload`, `authorizeRead`, and `inspectUploadedObject`.
- Staff upload callers already forward `required_headers` verbatim to the presigned `PUT`, so provider-specific signed headers should not require duplicated frontend upload logic.
- Current storage implementation manually signs AWS Signature V4 in `s3-object-storage.ts` and is coupled to `AWS_REGION` / `S3_*` config names.
- Current finalization stores `version_id` when the provider returns one and also persists SHA-256 plus `frozen_at`.
- R2's S3 compatibility uses region `auto`, supports S3-style presigned URLs and conditional `PutObject`, but does not implement S3 bucket versioning. See [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/).
- The current `S3_BUCKET_PUBLIC` configuration is not used by the storage adapter.
- New `file_object` rows are currently inserted as private, and no implemented production path promotes catalogue source files into a public derivative bucket.
- The storefront repository currently expects `is_private = false` for public images but still returns storage keys because the public CDN/base-URL layer is not implemented.
- The API README still says the object-storage adapter is not wired even though the upload/finalize flow now exists.

## Review findings captured before implementation (2026-09-29)

These are historical findings from the pre-implementation review, not a statement of the current
repository state. Preserve them as the reasoning behind the checklist; use the implementation status
and current canonical docs below for present state.

- At the time of the review, the TRD named S3 as the production file provider and the ADR sequence ended at `0009`; ADR 0010 and TRD 1.5 now record R2 as the selected target, with production cutover still gated.
- The API already authorizes and finalizes uploads. `file_object` persists `storage_key`, nullable `version_id`, and `sha256`, but it does not persist a storage-provider identifier. Existing accepted AWS-backed objects therefore cannot be assumed to survive a blind adapter switch to an empty R2 bucket.
- At the time of the review, `ObjectStorage` had no deletion operation. It now has a low-level idempotent delete primitive, but the repository still has no complete governed object-deletion path. Stage A must not claim that retention/deletion is complete merely because uploads and reads work.
- The canonical deployment runbook still says the managed container host is a decision to make. Render may be the current practical deployment target, but the architecture/runbook must explicitly record that selection before provider-specific cutover instructions are treated as canonical.
- The retention standard still has unapproved durations for payment evidence/private uploads and generated exports. This migration must not invent retention periods.
- Cloudflare documents R2 `PutObject` conditional operations including `If-None-Match`, while `PutBucketVersioning` is not implemented. That validates the write-once-key direction but requires provider tests before it becomes a Drezivo invariant.
- Cloudflare's current checksum table does not support SHA-256 as `FULL_OBJECT` and does support SHA-256 as `COMPOSITE`. The current AWS-style single-PUT + HEAD checksum assumption must therefore be proven against R2 rather than inferred from generic S3 compatibility. Client-supplied checksum metadata alone is never sufficient proof of stored bytes.
- Cloudflare documents `r2.dev` as a non-production access path that is independent of custom-domain access. Production public buckets must explicitly disable the Public Development URL rather than merely stop linking to it.
- R2's free egress does not make the service cost-free: Standard storage and Class A/Class B operations are billable after the monthly free tier, while Infrequent Access adds retrieval charges and does not receive the Standard free tier. The provider decision needs a workload-based pilot cost model.
- The current upload authorization lifetime is ten minutes (`UPLOAD_EXPIRY_SECONDS = 10 * 60`). A production cutover must therefore drain or reconcile already-issued AWS upload authorizations before declaring the source inventory final; otherwise a browser could still write to AWS after the copy/inventory pass.
- The repository does not implement a CloudFront-backed public delivery path today. If a CloudFront distribution exists only as manually provisioned/external infrastructure, it must be inventoried in R2-003 and handled in the cutover/rollback runbook; otherwise the migration must not claim that an active CloudFront runtime was replaced.
- Standard long-lived R2 Object Read & Write credentials are bucket-scoped, not a substitute for Drezivo tenant authorization inside an allowed bucket. Prefix/exact-object credential denial is only an expected provider control when the selected credential type explicitly supports it, such as appropriately scoped R2 temporary credentials.

## Implementation authorization and current status (2026-09-29)

The product owner explicitly selected R2 as the production target and directed repository
implementation. This supersedes the checklist's original prohibition on beginning code before
R2-007 for repository work only. It does not waive the object inventory, cost, migration/rollback,
privacy, host, bucket, credential, or live-provider gates required before any production cutover.
No infrastructure, production object, secret, or deployment has been changed.

The repository has ADR 0010, provider-neutral `OBJECT_STORAGE_*` configuration, a maintained AWS
SDK S3-compatible client/presigner, create-only upload authorization, streamed actual-byte
inspection, private signed reads, and a low-level idempotent delete primitive. Local MinIO remains
configured through the same adapter. Production upload authorization now defaults off unless the
host explicitly enables it; local development remains enabled by default. An opt-in database-backed
provider test now exercises the file service through a signed PUT and finalization, including a
mismatched-digest rejection. `NODE_ENV=staging` is now supported, uses production-style R2 config
validation, and does not inherit the shared developer `.env`; staging uploads remain enabled by
default for rehearsal. API typecheck, lint, and build pass; the full unit suite passes (117 tests,
2 skipped), and the focused storage/config/upload-gate suite passes (27 tests). An opt-in live smoke
test against loopback MinIO also passed
for create-only upload, repeated-write rejection, stored-byte SHA-256 inspection, and signed read,
deleting its synthetic object afterward. The database-backed integration suite remains unverified
because PostgreSQL at `127.0.0.1:55432` is not reachable. The R2 live test, production inventory,
cost/privacy/host approvals, and cutover remain unverified. Frontend upload-caller coverage now
passes seven focused tests across the shared exact-header helper, add/edit clothing photos,
measurement guides, reservation receipts, and payment QR uploads; app typecheck passes. A broader
selected-suite run still encounters an unrelated existing Add Clothing measurement-menu test
failure, and app ESLint cannot load the locally installed Next config because its expected
`next/dist/compiled/babel/eslint-parser` module is missing. The edited vault notes' frontmatter,
local links, wikilinks, and Canvas references validate directly; the repository link checker currently
stops before scanning because `app/AGENTS.md` and `web/AGENTS.md` reference missing `.codex/rules/`
directories. Markdown lint still reports repository-wide issues, and the dependency audit could not
reach the npm registry. No production infrastructure, object, secret, or deployment has been changed.

## Phase 0: Decision, scope, and migration baseline

- [x] **R2-000 — Record the owner-directed R2 target and its production gates**
  - **Outcome:** The selected implementation target is explicit while production readiness remains contingent on workload, migration, rollback, privacy, and live-provider evidence.
  - **Acceptance:**
    - [x] ADR 0010 records the owner-selected R2 target and makes no unsupported cost, scale, compliance, residency, or readiness claim.
    - [x] Record that MinIO remains the local development provider.
    - [x] Record that R2 `r2.dev` is development-only and production public assets require a separately approved custom-domain path.
    - [x] Keep the workload/cost model, existing-object inventory, migration/rollback model, deployment-host compatibility, live R2 signing tests, and production-data privacy/subprocessor review as open production gates.
    - [x] Do not treat repository implementation authorization as approval to create production infrastructure, transfer production data, or deploy.
  - **Tests/evidence:** Accepted target ADR and canonical architecture distinguish provider selection from production cutover readiness.

- [x] **R2-001 — Freeze the migration scope**
  - **Depends on:** R2-000.
  - **Outcome:** R2 provider migration is separated from unrelated image-processing/product work.
  - **Acceptance:**
    - [x] Stage A covers private source/evidence upload, finalization, and signed reads.
    - [x] Stage B covers public catalogue derivatives and custom-domain delivery.
    - [x] Malware scanning/image optimization is not silently declared complete by this migration.
    - [x] No unrelated catalogue, payment, reservation, or calendar behavior is changed.
  - **Tests/evidence:** Reviewed implementation scope in PR description/checklist.

- [ ] **R2-002 — Establish before-change behavior evidence**
  - **Depends on:** R2-001.
  - **Outcome:** Existing upload invariants are captured before provider code changes.
  - **Acceptance:**
    - [ ] Existing file integration tests pass or existing failures are documented before edits.
    - [ ] Record current response contract for `POST /api/v1/uploads` and `POST /api/v1/uploads/:fileId/finalize`.
    - [ ] Record the current upload callers: catalogue image, measurement guide, payment receipt, and payment QR/storefront asset.
    - [ ] Record all direct imports/usages of `s3ObjectStorage`.
  - **Tests/evidence:** Baseline test output and code-reference inventory.

- [ ] **R2-003 — Inventory existing stored objects before choosing the migration path**
  - **Depends on:** R2-002.
  - **Outcome:** Cutover planning is based on real file/object state rather than assuming all buckets are empty.
  - **Acceptance:**
    - [ ] Count `file_object` rows by lifecycle status and purpose in every environment that can contain non-synthetic data.
    - [ ] Count accepted rows with non-null `version_id` and record whether those identifiers refer to AWS S3 object versions.
    - [ ] Identify which provider currently holds every accepted object that must remain readable after cutover.
    - [ ] Independently inventory provider-side objects and incomplete multipart uploads where supported; reconcile unreferenced/orphaned objects against database records and document their safe disposition.
    - [ ] Confirm whether any production/customer uploads exist; if none exist, record that evidence explicitly so an unnecessary dual-provider migration is not built.
    - [ ] Do not copy object keys, signed URLs, receipt contents, or customer PII into the checklist or long-lived deployment notes.
  - **Tests/evidence:** Redacted inventory counts and provider mapping reviewed before adapter cutover.

- [ ] **R2-004 — Confirm the deployment host decision**
  - **Depends on:** R2-000.
  - **Outcome:** Storage deployment instructions match the selected runtime host instead of assuming Render while canonical docs still say the host is undecided.
  - **Acceptance:**
    - [ ] Record the selected V1/pilot API + worker container host in the accepted architecture/deployment docs, or keep the migration checklist host-neutral if that selection is not yet approved.
    - [ ] If Render is confirmed, describe it as the current deployment provider rather than a requirement of the storage adapter.
    - [ ] Keep the API/worker storage integration portable to another ordinary container host.
  - **Tests/evidence:** Deployment decision is traceable in an accepted ADR/runbook update before production cutover.

- [ ] **R2-005 — Record the R2 pilot cost model**
  - **Depends on:** R2-003.
  - **Outcome:** The provider decision is justified by expected Drezivo workload, not by free egress alone.
  - **Acceptance:**
    - [ ] Estimate stored object count, average object size, and total GB-month for the pilot.
    - [ ] Estimate monthly Class A operations, including uploads and future derivative writes.
    - [ ] Estimate monthly Class B operations, including signed reads, HEAD/inspection, range/verification reads, and storefront derivative reads where applicable.
    - [ ] Include the additional reads required by the selected trustworthy checksum/finalization strategy.
    - [ ] Use R2 Standard for V1 unless measured access patterns justify another class.
    - [ ] Do not select Infrequent Access merely for a lower storage rate; account for its retrieval charges, operation pricing, minimum-duration behavior, and lack of the Standard free tier.
    - [ ] Record a budget/usage threshold at which the team must re-evaluate the storage design.
  - **Tests/evidence:** Reviewed pilot worksheet against current [R2 pricing](https://developers.cloudflare.com/r2/pricing/); results inform production readiness in R2-007, not the already owner-directed implementation target.

- [ ] **R2-006 — Choose the existing-object migration and rollback model**
  - **Depends on:** R2-003, R2-004.
  - **Outcome:** The cutover cannot orphan existing AWS objects or silently lose access to objects written after the switch.
  - **Acceptance:**
    - [ ] If no durable AWS-backed objects exist, explicitly approve a clean cutover with no object migration.
    - [ ] If existing objects do exist, choose and document one reviewed strategy before production cutover: migrate+verify all required objects before cutover, or temporarily support provider-aware reads until migration finishes.
    - [ ] For every accepted AWS-backed object being migrated, copy the exact AWS object version referenced by `version_id` when one is recorded; never substitute the current/latest object at the same key without proving it is the accepted version.
    - [ ] Verify each migrated accepted object individually against the database record: destination byte size must equal `byte_size`, and SHA-256 of the actual destination bytes must equal the recorded `sha256`.
    - [ ] When an accepted legacy row has no usable recorded SHA-256, compute the hash from the exact accepted AWS source version/object and define a reviewed reconciliation/backfill step before declaring that object migrated; do not treat object-count equality as integrity proof.
    - [ ] Define how stale AWS `version_id` values are reconciled so R2 reads never send unsupported/meaningless AWS version identifiers.
    - [ ] Define a live-upload drain procedure around the current ten-minute upload authorization lifetime: keep the currently deployed legacy release and provider active, block only new upload-authorization requests through a verified host-level route gate, keep old-provider finalize/read available, wait for all issued URLs to expire plus a recorded safety margin, then re-query every `pending_upload` row before final migration inventory. The R2-only release cannot be deployed against an AWS endpoint because production config intentionally rejects non-R2 endpoints.
    - [ ] If temporary provider-aware reads are selected, add explicit per-file provider identity or an equally durable, unambiguous routing record, a reviewed schema/backfill plan, and tenant/integrity tests before implementation. The current `file_object` schema stores `storage_key` and nullable `version_id`, not provider identity, and the runtime currently selects one endpoint; never infer provider from a key or silently fall back between providers.
    - [ ] If the selected host cannot block authorization while preserving finalize/read, do not cut over until a reviewed, tested drain mechanism is available.
    - [ ] For each remaining `pending_upload`, explicitly choose the safe outcome: finalize/verify it on the old provider and migrate the resulting accepted object, migrate/reconcile it under a reviewed pending-upload procedure, or expire/cancel it only through an approved lifecycle path when no valid uploaded object exists.
    - [ ] Do not reopen new upload authorization until the final accepted/pending reconciliation is complete for the chosen cutover model.
    - [ ] Define rollback **before the first R2 production write**, when reverting code/config is still sufficient.
    - [ ] Define rollback **after R2 has accepted new writes**, when AWS and R2 can contain divergent object sets and a blind provider switch is unsafe.
    - [ ] Never point the runtime at a provider that does not contain every object referenced by the database for the active read path.
    - [ ] Do not delete AWS credentials/resources until the approved rollback window closes and migration verification is complete.
  - **Tests/evidence:** Reviewed cutover/rollback decision with an object-by-object integrity reconciliation plan and an explicit pending-upload authorization drain procedure.

- [ ] **R2-007 — Approve or defer production-readiness preparation**
  - **Depends on:** R2-004, R2-005, R2-006, R2-040.
  - **Outcome:** The already selected R2 target is not confused with approval to transfer or write production data. This decision allows readiness preparation only; it is not final cutover authorization.
  - **Acceptance:**
    - [ ] Review ADR 0010 together with the pilot cost model, deployment-host decision, existing-object inventory, migration/rollback outline, live R2 evidence, and any preliminary privacy questions; record the responsible reviewer for the formal R2-059 review.
    - [ ] Record one decision: authorize continued readiness preparation with named conditions, defer preparation pending evidence, or change the target through a superseding ADR.
    - [ ] Keep this preparation decision and the current ADR's R2 target status separate from final production cutover authorization; do not claim "fit for current scale" without the reviewed R2-005 workload model.
    - [ ] Do not create production buckets/credentials, transfer production data, enable customer uploads, or deploy the R2 path until the applicable privacy, migration, host, and cutover gates pass.
  - **Tests/evidence:** A reviewed readiness-preparation decision is traceable; R2-064 remains the production cutover execution gate.

## Phase 1: Provider-neutral configuration

- [x] **R2-010 — Define provider-neutral object-storage config names**
  - **Depends on:** R2-000.
  - **Outcome:** Runtime config describes object storage rather than AWS specifically.
  - **Acceptance:**
    - [x] Replace production-facing `AWS_REGION` / `S3_*` names with reviewed `OBJECT_STORAGE_*` names.
    - [x] Any temporary legacy variable-name compatibility is local MinIO-only, restricted to loopback hosts, and ignored in production.
    - [x] Include endpoint, region, private bucket, access key ID, secret access key, and path-style addressing.
    - [x] Make the public-derivatives bucket optional until Stage B actually uses it.
    - [x] Validate all values centrally at startup in `api/src/config/index.ts`.
    - [x] Do not expose storage credentials to `app` or `web` runtime config.
    - [x] Do not create or track `.env.example` or any other `.env*` file.
  - **Tests/evidence:** Config parser/startup tests for missing/malformed storage values.

- [x] **R2-011 — Define production R2 config semantics**
  - **Depends on:** R2-010.
  - **Outcome:** The selected container host can configure R2 without AWS-specific assumptions.
  - **Acceptance:**
    - [x] Region is `auto` for the R2 S3 API.
    - [x] Endpoint is the account-scoped R2 S3 endpoint.
    - [x] If a jurisdiction-specific bucket is selected, use and live-test its matching jurisdiction endpoint; do not infer geographic residency from region `auto` alone. *(No jurisdiction-specific bucket has been selected.)*
    - [x] Path-style/virtual-host behavior matches the SDK/R2 endpoint combination actually used.
    - [x] Private bucket is required for Stage A.
    - [x] Public bucket/base URL is not required until Stage B.
    - [x] New production upload authorization defaults to disabled; local development remains enabled by default, and production enablement is explicit after reconciliation.
    - [x] Environment runbook documents variable names and meanings without real values.
  - **Tests/evidence:** Production-config fixture parsing with synthetic values only.

- [x] **R2-012 — Preserve local MinIO configuration**
  - **Depends on:** R2-010.
  - **Outcome:** Local development still uses the same `ObjectStorage` boundary.
  - **Acceptance:**
    - [x] Docker Compose continues creating private local buckets.
    - [x] Local endpoint/path-style settings map to provider-neutral config.
    - [x] No developer needs Cloudflare credentials for normal local development.
    - [x] Local upload/finalize flow continues working after config rename.
  - **Tests/evidence:** Local MinIO smoke test and updated local-development runbook.

## Phase 2: Replace manual AWS signing with an SDK-backed S3-compatible adapter

- [x] **R2-020 — Add maintained S3 client/presigner dependencies**
  - **Depends on:** R2-010.
  - **Outcome:** Drezivo stops maintaining its own SigV4 implementation.
  - **Acceptance:**
    - [x] Add the AWS SDK S3 client and presigner packages required for R2-compatible signing.
    - [x] No AWS managed service is required at runtime; the SDK is used only as an S3 protocol client.
    - [x] Dependency versions match repository Node support and lockfile policy.
  - **Tests/evidence:** Install, typecheck, dependency audit as applicable.

- [x] **R2-021 — Implement provider-neutral S3-compatible object-storage adapter**
  - **Depends on:** R2-020.
  - **Outcome:** `ObjectStorage` is backed by the maintained SDK and works against R2 and MinIO.
  - **Acceptance:**
    - [x] Preserve the existing `ObjectStorage` interface unless a proven provider-neutral contract change is required.
    - [x] Replace hand-written canonical request/HMAC signing code.
    - [x] Use configured endpoint, region, credentials, bucket, and addressing mode.
    - [x] Keep dependency/provider failures mapped to Drezivo typed dependency errors.
    - [x] Do not leak provider credentials or signed secrets into logs.
    - [x] Rename AWS-specific implementation symbols/files where useful without changing feature-layer behavior.
  - **Tests/evidence:** Unit tests for adapter request construction and failure mapping.

- [x] **R2-022 — Remove direct feature imports of `s3ObjectStorage` naming**
  - **Depends on:** R2-021.
  - **Outcome:** Catalogue, Files, Operations, and Reservations no longer encode AWS in their default dependency name.
  - **Acceptance:**
    - [x] Replace `s3ObjectStorage` default dependency imports with provider-neutral `objectStorage` (or reviewed equivalent).
    - [x] Keep dependency injection points used by existing fake-storage tests.
    - [x] No feature service imports Cloudflare SDKs directly.
  - **Tests/evidence:** Repository-wide search has no feature-layer AWS/S3 provider coupling beyond intentionally generic protocol references.

- [x] **R2-023 — Add a provider-neutral object deletion primitive without inventing retention policy**
  - **Depends on:** R2-021.
  - **Outcome:** The storage boundary can eventually remove sources/derivatives through governed application logic instead of leaving deletion as an undocumented provider-console operation.
  - **Acceptance:**
    - [x] Add an `ObjectStorage` delete capability only at the provider boundary; do not expose arbitrary storage-key deletion directly to browser clients.
    - [x] Treat provider "not found" as an idempotent no-op where the calling lifecycle explicitly permits replay.
    - [x] Keep authorization, legal-hold, retention, and business-lifecycle decisions outside the low-level adapter.
    - [x] Do not invent retention durations or automatically delete accepted evidence merely because the primitive exists.
    - [x] Ensure delete operations never log signed URLs, credentials, or private object contents.
  - **Tests/evidence:** Adapter delete/not-found/failure tests; no user-facing deletion path is declared complete by this task alone.

## Phase 3: Write-once upload semantics for R2

- [x] **R2-030 — Make each authorized upload key write-once**
  - **Depends on:** R2-021.
  - **Outcome:** Reusing a still-valid presigned URL cannot replace bytes at the same storage key.
  - **Acceptance:**
    - [x] Presigned `PutObject` includes a conditional create-only requirement using `If-None-Match: *` or an equally strong reviewed R2-supported mechanism.
    - [x] `If-None-Match` is included in the signed request requirements returned to the browser.
    - [x] Existing unpredictable key format `tenant-files/{tenantId}/{fileId}/source` remains unique per upload intent.
    - [x] First valid PUT succeeds.
    - [x] Second PUT to the same key fails and cannot replace the object.
    - [x] Frontend continues sending all `required_headers` verbatim without provider-specific branching.
  - **Tests/evidence:** Adapter tests and sequential/concurrent overwrite attempts passed against loopback MinIO. Live R2 signing/checksum behavior remains open under R2-040/R2-100.

- [ ] **R2-031 — Update bucket CORS requirements for signed browser uploads**
  - **Depends on:** R2-030.
  - **Outcome:** R2 accepts the exact browser headers required by the signed upload flow.
  - **Acceptance:**
    - [ ] Production CORS allows only approved Drezivo origins, including `https://partners.drezivo.shop` when that is the deployed staff origin.
    - [ ] Allowed methods match the actual presigned operations (`PUT`, and `GET`/`HEAD` only where browser access requires them).
    - [ ] Allowed headers include `Content-Type`, the chosen checksum header, and `If-None-Match` when signed/sent by the browser.
    - [ ] No wildcard production origin is used.
    - [ ] CORS is documented as browser policy, not authorization.
  - **Tests/evidence:** Approved-origin preflight succeeds; unapproved-origin preflight fails.

- [ ] **R2-032 — Remove new R2 accepted-file dependence on provider version IDs**
  - **Depends on:** R2-006, R2-030.
  - **Outcome:** New R2 accepted-file immutability remains valid without S3 bucket versioning while existing AWS-backed rows are handled explicitly.
  - **Acceptance:**
    - [ ] `version_id` remains nullable unless a migration/provider-awareness design independently justifies a schema change.
    - [ ] Newly accepted R2 objects may persist `version_id = null`.
    - [ ] For new R2 objects, `sha256 + frozen_at + write-once key` is sufficient to identify/freeze accepted bytes after checksum verification succeeds.
    - [ ] Existing AWS-backed rows with `version_id` follow the migration/read strategy selected in R2-006; do not silently discard version IDs before the referenced bytes are reconciled.
    - [ ] Existing domain checks that allow `(version_id OR sha256)` remain valid or are clarified with provider-neutral naming/comments.
    - [ ] R2 signed reads never append stale AWS `versionId` query parameters.
  - **Tests/evidence:** New R2 object with null `version_id` remains readable and valid evidence; any migrated AWS fixture follows the approved version-ID reconciliation path.

## Phase 4: R2 checksum and finalization compatibility

- [ ] **R2-040 — Prove the exact R2 checksum behavior used by Drezivo**
  - **Depends on:** R2-021, R2-030.
  - **Outcome:** Drezivo does not assume AWS single-PUT + HEAD checksum semantics that R2 has not proven.
  - **Acceptance:**
    - [ ] Use a dedicated non-production test bucket and test-only credential; this synthetic-data test setup may be created before R2-007 and is not production infrastructure or authorization to transfer real data.
    - [ ] Verify how the chosen AWS SDK version signs/sends checksums to R2, including any automatic SDK checksum behavior enabled by default.
    - [ ] Test the browser-generated standard base64 SHA-256 value against the exact presigned `PutObject` request shape Drezivo plans to ship.
    - [ ] Record whether R2 independently validates that checksum for this request shape and whether HEAD/GET exposes a checksum that is cryptographic proof of the stored bytes.
    - [ ] Do not treat client-supplied custom metadata containing a SHA-256 string as proof that R2 stored those bytes.
    - [ ] Account for Cloudflare's current checksum matrix, where SHA-256 is not supported as `FULL_OBJECT` and is supported as `COMPOSITE`; do not infer compatibility from the algorithm name alone.
    - [ ] Do not weaken finalization to size/MIME-only validation if the current checksum path is incompatible.
  - **Tests/evidence:** Bounded live R2 test-bucket matrix using JPEG/PNG/WebP/PDF fixtures and the production SDK/presigner configuration.

- [ ] **R2-041 — Select and implement a trustworthy stored-byte SHA-256 verification path**
  - **Depends on:** R2-040.
  - **Outcome:** Finalization proves the actual bytes stored in R2 match the SHA-256 authorized by Drezivo.
  - **Acceptance:**
    - [ ] Prefer a provider-returned cryptographic checksum only if R2-040 proves it is calculated/validated from the stored object for the exact upload mode used.
    - [ ] Otherwise stream the stored object through the API during finalization and compute SHA-256 server-side from the actual bytes.
    - [ ] The server-side hash path must stream rather than load the whole object into memory; current upload size limits make bounded verification practical but are not a reason to use unbounded buffering.
    - [ ] Client-supplied checksum metadata may be useful as an expectation but is never the sole trust anchor.
    - [ ] If server-side streaming is selected, account for the extra R2 Class B/read cost in R2-005.
    - [ ] Keep provider failures fail-closed; an unavailable verification read never marks a file accepted.
  - **Tests/evidence:** Tampered-byte test proves a mismatched stored object cannot finalize even if client/request metadata claims the authorized SHA-256.

- [ ] **R2-042 — Make uploaded-object inspection provider-neutral and preserve finalization invariants**
  - **Depends on:** R2-041.
  - **Outcome:** `inspectUploadedObject` (or a reviewed replacement) validates R2 objects without AWS-only assumptions and without weakening `files.service`.
  - **Acceptance:**
    - [ ] Retrieve/verify actual byte size and content type.
    - [ ] Use the trustworthy SHA-256 path selected in R2-041.
    - [ ] Retrieve enough actual bytes for JPEG/PNG/WebP/PDF signature validation; combine this with the streaming verification read when practical to avoid redundant provider reads.
    - [ ] Uploaded byte size must equal authorized byte size.
    - [ ] Uploaded content type must equal authorized MIME type.
    - [ ] Verified stored-byte SHA-256 must equal authorized SHA-256.
    - [ ] Magic-byte/file-signature validation remains active.
    - [ ] Missing object returns `null`/clean not-found rather than a false acceptance.
    - [ ] Invalid upload becomes rejected and never accepted.
    - [ ] Provider/network failure never marks the file accepted and maps to a typed dependency error where applicable.
    - [ ] Finalize idempotency behavior remains unchanged.
  - **Tests/evidence:** Existing file integration suite plus R2 adapter/provider tests for success, 404, mismatch, bad signature, and dependency outage.

## Phase 5: API contracts and frontend upload flows

- [ ] **R2-050 — Confirm no external upload contract break is needed**
  - **Depends on:** R2-030, R2-042.
  - **Outcome:** Provider migration stays behind the existing upload contract when possible.
  - **Acceptance:**
    - [ ] `POST /api/v1/uploads` still returns `file_id`, `upload_url`, `upload_method`, `required_headers`, and `expires_at`.
    - [ ] `POST /api/v1/uploads/:fileId/finalize` response remains provider-neutral.
    - [ ] `required_headers` carries any new conditional/checksum header without adding Cloudflare-specific fields.
    - [ ] If a contract change is truly required, land the contracts change before API/app consumers per repository workflow.
  - **Tests/evidence:** Contract parsing and route/integration tests.

- [ ] **R2-051 — Verify all existing staff upload callers without R2-specific branching**
  - **Depends on:** R2-050.
  - **Outcome:** Existing upload UI works through provider-neutral authorization.
  - **Acceptance:**
    - [x] Add Clothing catalogue image upload works.
    - [x] Edit Clothing catalogue image upload works.
    - [x] Measurement guide upload works.
    - [x] Reservation payment receipt upload works.
    - [x] Payment method QR/storefront-asset upload works.
    - [ ] Existing pending/error UI remains usable when direct R2 PUT fails.
    - [x] In-flight/idempotency guards remain intact.
  - **Tests/evidence:** Component/browser walkthrough against API + test R2 or local MinIO as appropriate.
    Focused component tests pass for all five existing upload callers plus exact-header/error behavior
    (7 tests); the API + test-provider browser walkthrough remains open.

- [ ] **R2-052 — Verify signed private read consumers**
  - **Depends on:** R2-041.
  - **Outcome:** Admin/operations screens continue receiving short-lived private read URLs.
  - **Acceptance:**
    - [ ] Catalogue list/detail image reads work.
    - [ ] Measurement guide image reads work.
    - [ ] Reservation/operations image projections work.
    - [ ] Private evidence is not converted to a permanent public URL.
    - [ ] Expired signed URLs fail safely and are refreshed through normal API reads.
  - **Tests/evidence:** API/service tests and browser image-load tests.

## Phase 6: R2 infrastructure and pre-cutover readiness

- [ ] **R2-059 — Complete the production-data privacy/subprocessor review gate**
  - **Depends on:** R2-007.
  - **Outcome:** Real customer/tenant data is not transferred to or newly written into production R2 until the responsible privacy/legal owner has decided whether the provider change requires policy, DPA, subprocessor, contractual, or notice updates.
  - **Acceptance:**
    - [ ] Review the proposed AWS S3 -> Cloudflare R2 production-provider change against the current Privacy Policy, DPA/subprocessor commitments, Terms, and other applicable disclosures.
    - [ ] Review the selected R2 bucket jurisdiction/data-placement behavior and any applicable transfer commitments; record only verified facts and make no unverified residency or processing-location claim.
    - [ ] Record the responsible reviewer's conclusion without assuming in advance that any specific document must change.
    - [ ] If the review requires pre-transfer updates, notices, or approvals, complete them before copying existing production/customer objects to R2 or enabling the first new production customer upload to R2.
    - [ ] If no pre-transfer change is required, record that reviewed outcome so the cutover gate is explicit rather than silently skipped.
    - [ ] This gate does not block local MinIO development or synthetic/non-personal-data R2 integration testing.
  - **Tests/evidence:** Review outcome is traceable without embedding legal advice, customer PII, secrets, or private object identifiers in this checklist.

- [ ] **R2-060 — Create dedicated R2 buckets/environments**
  - **Depends on:** R2-007, R2-040 proof complete, R2-059.
  - **Outcome:** Production/staging object storage is isolated and private by default.
  - **Acceptance:**
    - [ ] Create a private source/evidence bucket for the target environment.
    - [ ] Create a separate public-derivatives bucket only when Stage B is ready.
    - [ ] Do not use a production bucket for automated integration tests.
    - [ ] Keep private bucket public access disabled, including the Public Development URL.
    - [ ] Record bucket ownership/environment naming in deployment docs without secrets.
  - **Tests/evidence:** R2 dashboard/config review.

- [ ] **R2-061 — Create least-privilege R2 API credentials**
  - **Depends on:** R2-060.
  - **Outcome:** The selected API runtime has only the object-storage permissions Drezivo needs, with provider scope and application tenant scope kept conceptually separate.
  - **Acceptance:**
    - [ ] Use a dedicated R2 API token/access-key pair for the API service rather than account-wide credentials.
    - [ ] Use separate credentials for staging and production; never reuse the production R2 credential in staging or local development.
    - [ ] Keep normal local development on MinIO credentials, not Cloudflare production credentials.
    - [ ] Scope each standard R2 credential to only the bucket(s) required by that environment.
    - [ ] Verify and record the effective operation scope of the selected R2 credential type. Cloudflare's standard `Object Read & Write` permission can include listing and destructive object-write operations; do not claim that application-level absence of a delete route removes those credential capabilities.
    - [ ] If the selected credential allows object deletion before a governed delete path exists, explicitly review and accept that residual blast radius, and prove recovery from accidental/malicious deletion before production cutover.
    - [ ] Grant only the narrowest operations the selected supported credential type can express for authorize/finalize/read and any explicitly implemented governed-delete path.
    - [ ] Do not claim that a standard bucket-scoped R2 credential enforces tenant-prefix isolation inside an allowed bucket; tenant isolation remains enforced by Drezivo authentication/authorization, tenant-scoped database lookup/RLS, and server-controlled storage keys.
    - [ ] Only expect provider-level prefix/exact-object denial when the selected credential type explicitly supports it, such as appropriately scoped R2 temporary credentials; do not add temporary credentials merely to satisfy this checklist if presigned URLs already meet the browser-upload use case.
    - [ ] Do not place credentials in Netlify/frontend variables.
    - [ ] Store secrets only in the selected container host's secret-management/environment settings.
    - [ ] Leave client-IP filtering unset unless the selected host provides verified stable outbound addresses; do not guess an allowlist.
  - **Tests/evidence:** Runtime credential can access its allowed bucket(s), is denied against a deliberately out-of-scope bucket, and cross-tenant object access is denied through Drezivo API/integration tests. Prefix/object-level credential denial is tested only when that credential type actually promises it.

- [ ] **R2-062 — Configure the selected API host for R2**
  - **Depends on:** R2-004, R2-011, R2-061.
  - **Outcome:** Deployed API signs, verifies, reads, and later deletes R2 objects through provider-neutral config.
  - **Acceptance:**
    - [ ] Set provider-neutral endpoint/region/bucket/credential variables on the selected host, with `OBJECT_STORAGE_UPLOADS_ENABLED=false` on the first R2 release until the final inventory and smoke checks pass.
    - [ ] If Render is the accepted host, use Render's secret environment settings without encoding Render assumptions in storage-domain code.
    - [ ] Keep obsolete AWS S3 runtime variables available only as long as the approved migration/rollback path in R2-006 requires them.
    - [ ] Startup/deploy fails fast if required storage config is missing.
    - [ ] No credentials, presigned URLs, or private object contents appear in deployment logs.
  - **Tests/evidence:** Host health check plus real bounded upload/finalize/read smoke test against a non-production R2 bucket.

- [ ] **R2-063 — Prepare migration, cutover, rollback, and storage-incident runbooks before production cutover**
  - **Depends on:** R2-006, R2-059, R2-061, R2-062.
  - **Outcome:** The team has an executable plan for switching providers and recovering from a failed or partially completed switch.
  - **Acceptance:**
    - [ ] Document the exact pre-cutover object inventory/reconciliation step.
    - [ ] Document the existing-object copy/verification procedure when R2-006 requires migration, including reading the exact AWS `version_id` where recorded and verifying each destination object's actual size and SHA-256 against `file_object`.
    - [ ] Document how accepted legacy rows without a usable recorded SHA-256 are hashed/reconciled before being declared migrated.
    - [ ] Document the upload-authorization drain procedure on the currently deployed legacy release: use a tested host-level route gate to block new authorization requests while the old provider continues to serve finalize/read; wait for the current ten-minute authorization window to expire plus a recorded safety margin, then re-query and resolve every `pending_upload` before final inventory. Do not claim the R2-only release can run against the old AWS endpoint.
    - [ ] Verify the selected host can apply and remove that route gate without blocking finalize/read; if not, stop before production cutover and design a safe alternative.
    - [ ] Document how each remaining pending upload is resolved (finalize+verify+migrate, reviewed pending-object migration/reconciliation, or approved expiry/cancellation when no valid object exists) and when new upload authorization is allowed to resume.
    - [ ] Document the pre-first-R2-write rollback path.
    - [ ] Document the post-first-R2-write rollback/reconciliation path; explicitly prohibit a blind switch back to AWS when object sets have diverged.
    - [ ] Document how to rotate/revoke the R2 runtime token after credential compromise.
    - [ ] Document immediate containment for accidental private-bucket public exposure.
    - [ ] Document that presigned URLs remain bearer secrets until expiry and cannot be centrally revoked individually through ordinary object-store credential rotation.
    - [ ] Define the Stage A observation gate before cutover: record both a minimum observation duration appropriate to the pilot and the representative operations/events that must succeed; elapsed time alone is not sufficient evidence.
    - [ ] Update the critical deployment/environment/incident runbook sections needed to execute these steps before the cutover; broader post-migration cleanup may remain in Phase 9.
    - [ ] Do not put real secrets, signed URLs, customer object keys, or PII in the runbook.
  - **Tests/evidence:** Tabletop walkthrough of authorization drain, object-by-object migration verification, cutover + both rollback states + credential-leak containment.

- [ ] **R2-064 — Execute controlled Stage A cutover**
  - **Depends on:** R2-003, R2-007, R2-042, R2-052, R2-059, R2-062, R2-063, R2-090, R2-091.
  - **Outcome:** The deployed environment uses R2 for all current source/evidence file flows without orphaning existing objects or leaving an old-provider upload window open.
  - **Acceptance:**
    - [ ] Complete the R2-063 authorization drain before the final migration inventory: no new AWS upload URLs are being issued, the old ten-minute authorization window plus recorded safety margin has elapsed, and every remaining `pending_upload` has a documented safe disposition.
    - [ ] The R2-006 migration strategy is complete for every object that must remain readable before traffic is switched.
    - [ ] For every migrated accepted object, verify the exact source identity/version selected by the migration plan and prove the R2 object's actual `byte_size` and SHA-256 match the authoritative `file_object` record/reconciled hash; counts/readability are supplementary checks, not the integrity proof.
    - [ ] Database rows that previously referenced AWS versions are reconciled according to the approved migration/read design.
    - [ ] Catalogue upload/read works after deployment.
    - [ ] Payment receipt upload/read/finalize works after deployment.
    - [ ] Direct anonymous access to private objects fails.
    - [ ] Reconcile expected database file count against readable provider objects using redacted counts/IDs safe for operations in addition to object-by-object integrity verification.
    - [ ] Re-enable new production upload authorization only after the final accepted/pending reconciliation passes on the active R2 path.
    - [ ] Old AWS credentials/resources are not deleted merely because the first R2 smoke test passes; retain them until the R2-006 rollback window/migration verification explicitly closes.
  - **Tests/evidence:** Deployment smoke-test plus object-by-object integrity reconciliation and pending-upload drain record, with no secret URLs or customer file contents copied into long-lived docs.

- [ ] **R2-065 — Complete the Stage A observation gate before Stage B**
  - **Depends on:** R2-064.
  - **Outcome:** Public-derivative work does not start merely because the initial cutover survived; the active R2 path has representative operational evidence over the observation window chosen in R2-063.
  - **Acceptance:**
    - [ ] The recorded minimum observation duration has elapsed; do not invent a universal seven-day or other arbitrary duration in this checklist.
    - [ ] Representative catalogue upload/finalize/read succeeds on the active R2 path.
    - [ ] Representative private payment-receipt upload/finalize/read succeeds on the active R2 path.
    - [ ] Repeated PUT/write-once rejection behavior has been observed or revalidated against the deployed configuration.
    - [ ] Signed-read expiry/refresh behavior works as designed.
    - [ ] No unresolved migrated-object mismatch, checksum/finalization mismatch, unexpected storage authorization error, or unexplained provider 4xx/5xx remains open from the observation window.
    - [ ] If traffic volume is too low to exercise a required representative operation naturally, run a bounded non-sensitive verification rather than treating idle elapsed time as evidence.
  - **Tests/evidence:** Redacted observation record containing duration, representative operation classes, and unresolved-issue count; no customer file contents or signed URLs.

## Phase 7: Public catalogue derivatives on R2

- [ ] **R2-070 — Define the public-derivative lifecycle**
  - **Depends on:** R2-065.
  - **Outcome:** Public catalogue delivery is intentionally separate from private source files.
  - **Acceptance:**
    - [ ] Define which purposes can produce public derivatives (`catalogue_image`, approved storefront assets, etc.).
    - [ ] Payment receipts, verification documents, and other private evidence can never enter the public bucket.
    - [ ] Define derivative key naming, cache behavior, deletion linkage, and replacement behavior.
    - [ ] Define how public derivatives are sanitized and reviewed for EXIF, embedded metadata, or other information not intended for public release; do not publish unsanitized originals by default.
    - [ ] Define when `file_object.is_private` changes, or replace that overloaded flag with a clearer reviewed projection if needed.
    - [ ] Do not expose original private source objects as the public catalogue path.
  - **Tests/evidence:** Threat/data-flow review.

- [ ] **R2-071 — Implement derivative publication service**
  - **Depends on:** R2-023, R2-070.
  - **Outcome:** Accepted catalogue sources can produce an explicitly public derivative object.
  - **Acceptance:**
    - [ ] Publication is server/worker controlled, never a client-selected public flag.
    - [ ] Derivative creation is idempotent and safe under retries.
    - [ ] Replacement/deletion updates old derivative lifecycle safely.
    - [ ] Public metadata contains no private customer/tenant-internal information.
    - [ ] Strip or explicitly review embedded image metadata before making a derivative publicly accessible.
    - [ ] Processing failure leaves the private accepted source intact.
  - **Tests/evidence:** Duplicate publication, replacement, and deletion tests.

- [ ] **R2-072 — Configure production public delivery domain and close the development access path**
  - **Depends on:** R2-071.
  - **Outcome:** Public catalogue assets use one approved Cloudflare-backed hostname, and the independent `r2.dev` development path is not left publicly enabled in production.
  - **Acceptance:**
    - [ ] Use a reviewed custom domain such as `cdn.drezivo.shop` or approved equivalent.
    - [ ] Confirm the domain/DNS plan works with Drezivo's current registrar/DNS arrangement before production cutover.
    - [ ] Explicitly disable the bucket's R2 **Public Development URL** (`r2.dev`) in production; not linking to it is insufficient because Cloudflare treats custom-domain and `r2.dev` access as independent paths.
    - [ ] Verify the old/managed `r2.dev` URL no longer serves the bucket after it is disabled.
    - [ ] Configure cache/security rules appropriate for public immutable derivatives.
    - [ ] Keep private bucket inaccessible through the public domain and keep its Public Development URL disabled.
  - **Tests/evidence:** Public derivative loads through custom domain; direct `r2.dev` access is denied/disabled; private object path does not load.

- [ ] **R2-073 — Implement public URL projection**
  - **Depends on:** R2-072.
  - **Outcome:** Storefront/API responses return stable public derivative URLs instead of raw storage keys.
  - **Acceptance:**
    - [ ] Public URL construction belongs to the files/storage boundary, not SQL repositories.
    - [ ] Storefront repository no longer returns a raw `storage_key` as an image URL.
    - [ ] Admin private-source reads may remain signed while storefront uses the public derivative URL.
    - [ ] No tenant can cause another tenant's object key to be projected.
  - **Tests/evidence:** Storefront projection tests with multi-tenant fixtures.

- [ ] **R2-074 — Allow R2 public image host in Next.js**
  - **Depends on:** R2-073.
  - **Outcome:** `app`/`web` image components can render the approved R2 custom-domain URLs.
  - **Acceptance:**
    - [ ] Add only the approved CDN/custom-domain host to Next image remote patterns where required.
    - [ ] Do not wildcard arbitrary remote image hosts.
    - [ ] Static marketing assets remain unaffected.
  - **Tests/evidence:** Production-like storefront/catalogue image render test.

## Phase 8: Retention, deletion, and security operations

- [ ] **R2-080 — Define deletion/retention ownership without pretending policy is complete**
  - **Depends on:** R2-023, R2-032, R2-070.
  - **Outcome:** The R2 migration identifies every object lifecycle that eventual retention/erasure must cover without inventing unapproved retention durations.
  - **Acceptance:**
    - [ ] State explicitly that Stage A upload/read cutover does **not** mean Drezivo's retention/deletion lifecycle is complete.
    - [ ] Update design/docs that currently assume S3 versions so they reflect the accepted R2 immutable-key object model.
    - [ ] Inventory deletion ownership for private source objects, public derivatives, generated exports, temporary uploads, and any future cached/processed copies.
    - [ ] Define which application service is allowed to call the low-level `ObjectStorage` delete primitive for each lifecycle; the storage adapter itself never decides business retention.
    - [ ] Legal-hold behavior is not claimed until an application-level mechanism actually enforces it.
    - [ ] Retention periods remain policy-driven; the current retention standard is unapproved for private evidence/exports, so do not invent a universal duration.
    - [ ] Decide which deletion capabilities are required for Stage B replacement/removal versus which governed retention jobs remain deferred until the schedule is approved.
  - **Tests/evidence:** Delete/hold/lifecycle design review against the Data Retention and Deletion Standard.

- [ ] **R2-081 — Verify operational incident response after cutover**
  - **Depends on:** R2-063, R2-064.
  - **Outcome:** The pre-cutover incident steps are reconciled with the deployed R2 reality and can be executed without AWS assumptions.
  - **Acceptance:**
    - [ ] Verify R2 token/key rotation steps against the actual production credential type.
    - [ ] Verify immediate containment steps for accidental private-bucket public access.
    - [ ] Verify the team can revoke/replace compromised runtime credentials without exposing the replacement in logs/docs.
    - [ ] Treat presigned URLs as bearer secrets until expiry and document their residual validity after runtime-token rotation.
  - **Tests/evidence:** Tabletop/credential-rotation drill using non-production credentials; no real secrets in evidence.

- [ ] **R2-082 — Add observability for storage failures**
  - **Depends on:** R2-021.
  - **Outcome:** Provider outages and signing/finalization failures are diagnosable without exposing secrets.
  - **Acceptance:**
    - [ ] Log safe provider-operation context only (operation class, status, request ID where safe), not signed URLs or credentials.
    - [ ] Distinguish authorization/config failures from temporary dependency failures.
    - [ ] Add monitoring/alert thresholds only after representative traffic exists.
  - **Tests/evidence:** Failure-path log review.

- [ ] **R2-083 — Implement governed source-object deletion when retention policy is approved**
  - **Depends on:** R2-023, R2-080, an approved retention/deletion schedule for the affected purpose.
  - **Outcome:** Drezivo can actually erase governed source objects and related derivatives when policy says deletion is due, rather than only marking database rows deleted.
  - **Acceptance:**
    - [ ] Add the application/service path that decides an object is eligible for deletion; do not let the low-level adapter make that decision.
    - [ ] Enforce `legal_hold`, approved retention timing, tenant ownership, and relevant lifecycle/state checks before deletion.
    - [ ] Delete all provider objects that the approved lifecycle requires, including linked derivatives/exports where applicable.
    - [ ] Make retries idempotent; an already-missing object must not turn a successful prior deletion into a 500.
    - [ ] Persist a non-sensitive audit record of the deletion outcome without retaining the erased bytes or sensitive object data.
    - [ ] Do not mark this task complete while the governing retention schedule is still unapproved.
  - **Tests/evidence:** Governed deletion, legal-hold denial, replay, provider-not-found, and partial-failure tests.

## Phase 9: Documentation and provider disclosures

- [ ] **R2-090 — Complete architecture and deployment documentation cleanup**
  - **Depends on:** R2-000, R2-004, R2-063.
  - **Outcome:** Before cutover, durable docs describe R2 as the selected target, distinguish CloudFront as previously planned or externally provisioned rather than an implemented repository runtime, and remove stale active AWS-storage assumptions.
  - **Acceptance:**
    - [x] Update `docs/architecture/Drezivo-TRD.md`.
    - [x] Update `docs/runbooks/deploy.md`.
    - [x] Update `docs/runbooks/environments.md`.
    - [x] Update `docs/runbooks/local-development.md` while retaining MinIO instructions.
    - [x] Reconcile `docs/runbooks/oncall-checklist.md` and `docs/runbooks/security-incident.md` with the pre-cutover operational updates from R2-063.
    - [x] Update `api/README.md` to reflect the now-implemented object-storage flow.
    - [x] Update any second-brain deployment notes that still prescribe AWS S3 or treat CloudFront as an active in-repo runtime dependency.
    - [ ] If R2-003 found externally provisioned CloudFront infrastructure, document its actual disposition; if none exists, explicitly avoid implying that CloudFront was migrated from production.
  - **Tests/evidence:** Repository search for stale production `Amazon S3`, `CloudFront`, `AWS_REGION`, and old `S3_*` assumptions; retain historical/planned/external references only when clearly labeled.

- [ ] **R2-091 — Apply reviewed privacy/legal provider disclosures before transfer when required**
  - **Depends on:** R2-059.
  - **Outcome:** Customer-facing/provider documentation matches the responsible privacy/subprocessor review before production data is transferred or newly written, without turning the engineering checklist into legal advice.
  - **Acceptance:**
    - [ ] Apply Privacy Policy, DPA/subprocessor, Terms, and provider-reference changes required by R2-059 before the first production transfer/write; after cutover, verify no stale active AWS-provider disclosure remains.
    - [ ] If the responsible review concluded that a particular document does not need a change, preserve that reviewed outcome rather than editing it only for checklist symmetry.
    - [ ] Describe Cloudflare/R2 accurately and only to the extent approved for the legal/customer-facing document.
    - [ ] Do not claim certifications, residency, processing location, or guarantees that have not been verified.
  - **Tests/evidence:** Legal/provider-reference search reconciled with the R2-059 review outcome.

## Phase 10: Migration test matrix and completion gate

- [ ] **R2-100 — Complete provider adapter and stored-byte verification test matrix**
  - **Depends on:** R2-023, R2-030, R2-031, R2-042, R2-060.
  - **Outcome:** R2 compatibility and checksum trust are proven beyond fake-storage service tests.
  - **Acceptance:**
    - [x] Presigned PUT succeeds for allowed file types.
    - [x] Presigned GET succeeds for an accepted private file.
    - [x] HEAD/GET inspection returns the metadata actually used by finalization.
    - [x] Range/stream GET returns actual object bytes required for signature/hash validation.
    - [ ] The chosen SDK's automatic checksum/signing behavior is covered by a live R2 test so an SDK upgrade cannot silently change the request shape without detection.
    - [ ] Tampered stored bytes fail finalization even when client-supplied metadata claims the expected SHA-256.
    - [x] Missing object is handled as not found.
    - [ ] Wrong MIME fails finalization.
    - [ ] Wrong byte size fails finalization.
    - [ ] Wrong SHA-256 fails finalization.
    - [ ] Bad magic bytes fail finalization.
    - [x] Second PUT to the same write-once key cannot mutate accepted bytes.
    - [x] Provider-neutral delete primitive handles delete/not-found/failure safely.
    - [ ] Unauthorized origin fails browser CORS.
    - [ ] Cross-tenant file lookup remains concealed.
    - [ ] An opt-in database-backed live-provider test authorizes a synthetic file, uploads through the signed URL, finalizes through the file service using actual stored-byte inspection, and rejects a mismatched declared digest; its credentials and bucket are explicitly non-production and synthetic data is deleted in `finally`.
    - [ ] Live R2 tests require a non-secret exact-bucket confirmation matching the configured private test bucket, reject placeholder credentials, and require upload authorization to be explicitly enabled for the database-backed finalization test.
  - **Tests/evidence:** Adapter tests and loopback MinIO smoke tests cover the checked upload/read/stream/missing-object/write-once/delete behaviors. Unit + integration + bounded live R2 smoke-test results using the production SDK/presigner settings remain incomplete; live R2 and database-backed finalization are unverified.

- [ ] **R2-101 — Verify local MinIO parity**
  - **Depends on:** R2-030, R2-042.
  - **Outcome:** Local development catches the same major upload invariants as production.
  - **Acceptance:**
    - [x] MinIO accepts the chosen write-once conditional upload behavior or an explicit reviewed local parity strategy is documented.
    - [x] Local checksum/finalization flow passes.
    - [ ] Docker Compose setup remains one-command reproducible.
  - **Tests/evidence:** Local upload/finalize/read smoke test.

- [ ] **R2-102 — Run repository quality gates**
  - **Depends on:** Implementation tasks complete for the phase being shipped.
  - **Outcome:** Migration does not regress unrelated app behavior.
  - **Acceptance:**
    - [x] API typecheck passes.
    - [x] API lint passes.
    - [x] API unit tests pass.
    - [ ] Relevant integration tests pass.
    - [x] API build passes.
    - [ ] Relevant app typecheck/lint/tests pass if upload callers/config changed.
    - [ ] Markdown/link checks pass for changed docs where available.
    - [ ] Secret scan has no real credential findings.
  - **Tests/evidence:** Actual command output recorded in implementation review/PR.

- [ ] **R2-103 — Mark R2 Stage A migration complete**
  - **Depends on:** R2-006, R2-064, R2-065, R2-090, R2-091, R2-100, R2-101, R2-102.
  - **Outcome:** All currently implemented Drezivo upload/private-read flows use R2 in the deployed environment without orphaned legacy objects.
  - **Acceptance:**
    - [ ] No deployed runtime dependency on AWS S3 remains for the active read/write path.
    - [ ] The R2 Stage A path introduces no CloudFront dependency; if R2-003 identified externally provisioned CloudFront infrastructure, its migration/decommission/rollback disposition is explicitly recorded rather than claiming an in-repo CloudFront runtime was replaced.
    - [ ] Existing-object reconciliation from R2-006/R2-064 is complete. A temporary provider-aware read path is not sufficient to mark Stage A complete while any active runtime read still depends on AWS.
    - [ ] Private evidence remains private and signed-read only.
    - [ ] Accepted-byte immutability is proven under repeated PUT attempts.
    - [ ] Stored-byte SHA-256 verification is proven by R2-100; client metadata is not the trust anchor.
    - [ ] Stage A is **not** labeled as complete retention/deletion implementation; R2-080 remains the authority for that scope.
    - [ ] AWS resources/credentials may be removed only after this gate passes and the approved rollback window/migration verification is closed.
  - **Tests/evidence:** Production/test smoke checklist, object reconciliation, and deployment config review.

- [ ] **R2-104 — Mark R2 Stage B public delivery complete**
  - **Depends on:** R2-059, R2-070 through R2-074, R2-080, R2-091, R2-102.
  - **Outcome:** Public catalogue images use controlled R2 derivatives through the approved production custom domain.
  - **Acceptance:**
    - [ ] Storefront never exposes private source/evidence URLs.
    - [ ] Public derivative content and embedded metadata have passed the R2-070/R2-071 privacy-sanitization review.
    - [ ] Public catalogue images load from approved custom domain.
    - [ ] The production public-derivatives bucket's `r2.dev` Public Development URL is explicitly disabled and verified inaccessible.
    - [ ] Replacement/deletion of catalogue assets handles derivatives correctly.
    - [ ] Cache behavior is safe for immutable public derivatives.
  - **Tests/evidence:** Public storefront browser walkthrough plus direct private-object denial test.

## Deferred / separate work

- Malware scanning/quarantine provider and asynchronous scan workflow.
- Image resizing/format conversion strategy and exact derivative variants.
- Automatic EXIF/metadata stripping implementation.
- Final legal retention durations for payment evidence and other private uploads.
- Multi-region replication or disaster-recovery copies unless a measured/product requirement justifies them.
- Cloudflare Workers-based image/auth proxying unless direct R2 + custom domain is insufficient.

## External implementation references

- [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [R2 public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/)
- [R2 temporary credentials](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/)
