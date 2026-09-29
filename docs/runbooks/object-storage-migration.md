# Object-storage migration and cutover

This runbook covers the repository's Cloudflare R2 target, local MinIO parity, and the safe path
from any legacy production provider. The AWS SDK in `api` is only the S3-compatible protocol
client. AWS is not a production runtime provider after cutover.

**Status:** Strategy recorded; not executed. Production cutover is blocked until the evidence gates in ADR 0010 and
the [R2 migration checklist](../second-brain/05-Operations/Cloudflare%20R2%20Migration%20Checklist.md)
are complete. This document authorizes no production infrastructure, data transfer, secret update,
or deployment by itself.

## Preconditions

Before changing a production endpoint or copying real objects, record and review all of the
following without including credentials, object keys, signed URLs, file contents, or personal data:

- the selected API/worker host and rollback mechanism;
- separate private R2 buckets for staging and production, with public access disabled;
- separate bucket-scoped R2 credentials in the host secret manager;
- the selected credential's effective S3 action set; standard R2 Object Read & Write access can
  include bucket-level listing and destructive object writes. If the runtime key can delete objects,
  verify an independent recovery path and restore procedure before production use;
- the workload and cost estimate for stored bytes, PUTs, streamed finalization reads, signed reads,
  and later public derivative requests;
- the responsible privacy/subprocessor review outcome;
- the object-by-object migration and both rollback paths;
- a non-production live R2 test and a local MinIO parity test for the exact SDK version and
  conditional request headers;
- a verified upload-authorization drain mechanism on the currently deployed legacy release that
  leaves that release's finalize/read path available. The selected host is not yet finalized, so
  this must be demonstrated before cutover, not inferred from the new R2 runtime's feature flag.

The storage runtime requires `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`,
`OBJECT_STORAGE_BUCKET_PRIVATE`, `OBJECT_STORAGE_ACCESS_KEY_ID`, and
`OBJECT_STORAGE_SECRET_ACCESS_KEY`. `OBJECT_STORAGE_FORCE_PATH_STYLE` is optional and defaults to
`false`. R2 production config
uses an HTTPS account-scoped endpoint, region `auto`, and `false` for path-style addressing. Local
MinIO uses its loopback endpoint, local credentials, and `true` for path-style addressing.
`OBJECT_STORAGE_BUCKET_PUBLIC` is not needed for Stage A.
`OBJECT_STORAGE_UPLOADS_ENABLED` defaults to `false` in production and `true` outside production.
Keep it explicitly `false` on the initial R2 deployment until the final R2 inventory and smoke
checks pass; opt in only after the production cutover gate passes. The R2-target production config
rejects non-R2 endpoints, so this flag cannot be used by that release to pause uploads while
continuing to serve legacy-provider reads.

## Inventory without exposing object data

Run a read-only aggregate query once per environment using the approved database administration
connection. Do not export `tenant_id`, object keys, file IDs, signed URLs, names, contact data, or
file contents.

```sql
SELECT purpose,
       lifecycle_status,
       version_id IS NOT NULL AS has_version_id,
       sha256 IS NOT NULL AS has_sha256,
       count(*) AS object_count,
       coalesce(sum(byte_size), 0)::bigint AS total_bytes
  FROM file_object
 GROUP BY purpose, lifecycle_status, version_id IS NOT NULL, sha256 IS NOT NULL
 ORDER BY purpose, lifecycle_status, has_version_id, has_sha256;
```

The database does not store a provider identifier. Correlate the environment's configured source
provider and bucket inventory separately, then record only redacted counts and the provider mapping.
Do not assume the inventory is empty because this repository has no production credentials.

Also inventory the physical source bucket independently of `file_object`: count objects and
incomplete multipart uploads, then reconcile object keys against database records or an approved
migration record in a controlled environment. Do not put raw keys or customer filenames in this
runbook, logs, tickets, or long-lived notes. Investigate unreferenced objects and unfinished uploads
before declaring a clean cutover; do not automatically delete them without an approved lifecycle
action. Repeat the same aggregate inventory after the upload-authorization drain.

If all required accepted and pending object counts are zero, record the query date and reviewer and
use the clean-cutover path. If any required object exists, identify its exact source bytes. For a
legacy row with `version_id`, read that exact source version. For a row without a usable SHA-256,
compute and review the source hash before copying. For every object, prove destination byte size and
SHA-256 against the authoritative row or an approved reconciliation record. Counts and successful
reads are not integrity proof. The repository does not yet include a production migration utility;
do not switch the runtime until an approved tool/procedure performs this reconciliation.

## Selected migration model (2026-09-29)

Use **copy and verify all required objects before switching the single active storage endpoint**.
Do not add provider-aware reads or automatic fallback between AWS and R2. The current database has
no provider column and the runtime selects one endpoint; a mixed-provider read path would require a
separate schema, backfill, authorization, and integrity design that is not selected here.

This is an operational design decision, not approval to run a migration. R2-003 is still partial:
the production database aggregate could not be read with verified TLS, and the legacy AWS source
and staging inventories remain unavailable. The empty configured R2 buckets do not prove that the
source or database is empty. Therefore no zero-copy/clean-cutover approval is recorded. If a
complete reviewed inventory later proves there are no accepted objects, no pending uploads, no
incomplete source multipart uploads, and no unresolved physical objects, record the query date and
reviewer and obtain explicit owner approval for that clean cutover before R2-064. Otherwise, use the
copy-and-verify sequence below.

For a non-empty inventory:

1. Finish the legacy-provider upload drain below, then take the final redacted database/source
   inventory. Resolve every `pending_upload` before freezing the object set.
2. Prepare a restricted, encrypted, access-controlled migration manifest for the operator tool.
   It may contain the object key, database-row identifier, exact source provider/version, and
   expected integrity metadata needed for the one-time copy. Keep it outside Git, tickets, and
   general logs; retain it only under the approved rollback/reconciliation procedure. It is not an
   application routing table and must never enable cross-provider fallback.
3. Read the exact recorded AWS `version_id` when present. For an accepted row without a usable
   recorded SHA-256, compute the hash from the exact accepted source bytes and complete a separately
   reviewed reconciliation/backfill. If the accepted source identity cannot be established, stop;
   do not substitute the latest bytes at a key by assumption.
4. Copy to the private R2 destination without overwriting an existing key. If a destination key
   already exists, compare its actual bytes to the expected size and SHA-256; any mismatch or
   unexplained object is a stop condition, not permission to replace it.
5. Read back every destination object and compute size and SHA-256 from the actual R2 bytes. Require
   exact equality with the authoritative `file_object` values or the reviewed reconciliation
   record. An object-count match is only a supplementary check.
6. Only after an object's R2 bytes pass verification, reconcile its active R2 `version_id` to null
   so the R2 adapter never receives a stale AWS version identifier. Preserve the original AWS
   version mapping in the restricted migration manifest until the rollback window closes; rehearse
   restoring it before the first R2 production write.
7. Before deploying the R2-only runtime, prove every accepted row resolves to verified R2 bytes,
   no unresolved accepted/pending row remains, and the old AWS objects/credentials are still
   available for rollback. Deploy with upload authorization disabled and run the read-only checks
   below before any production R2 write.

No production migration utility or production-host route gate has been verified yet. R2-063 must
provide and test the controlled copy/reconciliation and drain procedures, including restoration of
the preserved version mapping. Until then, this section records the selected model and its stop
conditions only; it does not authorize data transfer or cutover.

## Drain pending uploads

The API's upload authorization lifetime is ten minutes. Drain on the currently deployed legacy
release before installing the R2-only runtime. The old release must continue using its existing
provider for finalization and reads during this step.

1. Confirm the old provider is still configured and readable by every serving API and worker.
2. Use the selected host's tested, path-specific route gate to block `POST /api/v1/uploads` while
   leaving finalize/read routes available. Record the time the last URL could have been issued.
   Verify the block using both a browser-origin request and a non-browser request; CORS alone is not
   an authorization gate. If the host cannot do this without disrupting finalize/read, stop and
   design/test another mechanism before cutover.
3. Wait at least 600 seconds plus a safety margin selected and recorded for this change.
4. Re-query `pending_upload` rows. Finalize and verify any valid object on the old provider. Do not
   silently discard pending records. If no approved lifecycle action exists for a missing/invalid
   object, stop and add that lifecycle before proceeding.
5. Repeat the aggregate inventory. Do not restore upload authorization or switch providers while a
   pending row or unreconciled accepted object remains.

After the drain and object reconciliation complete, deploy the R2-only runtime with
`OBJECT_STORAGE_UPLOADS_ENABLED=false`. First verify all database-referenced objects are readable
through R2, then perform the bounded non-production/live-provider checks and the production
read-only smoke checks. Enable upload authorization only after the final accepted/pending inventory
and the production cutover gate pass.

## Non-production provider tests

The live R2 smoke test is opt-in and skips by default. It requires `NODE_ENV=test`, a dedicated R2
test bucket whose name contains `test` and not `prod`, R2 credentials scoped only to that test
bucket, and the non-secret `OBJECT_STORAGE_LIVE_TEST_BUCKET_CONFIRM` set to the exact private bucket
name. The exact-match confirmation helps prevent accidental use of a different bucket. It also
requires distinct HTTPS origins in `OBJECT_STORAGE_LIVE_TEST_ALLOWED_ORIGIN` and
`OBJECT_STORAGE_LIVE_TEST_DENIED_ORIGIN`. Set `OBJECT_STORAGE_LIVE_TESTS=true` and
`OBJECT_STORAGE_UPLOADS_ENABLED=true` only for the test process. This synthetic-data test bucket may
be created before the production readiness gate; it is not a production bucket or authorization to
transfer real customer data. Never reuse the test credential for staging or production. Run:

```powershell
npm exec --workspace @drezivo/api vitest -- run src/integrations/storage/__tests__/r2-live.integration.test.ts
```

The test creates a random synthetic object, checks signed create-only PUT, rejected repeat PUT,
actual stored bytes/hash, signed and anonymous reads, and allowed/denied CORS preflight. It deletes
its object in `finally`. Never point it at a production bucket.

The local MinIO parity test is also opt-in. Supply explicit local MinIO credentials, a loopback
endpoint, path-style addressing, and `OBJECT_STORAGE_LIVE_MINIO_BUCKET_CONFIRM` equal to the exact
local private bucket name. Set `OBJECT_STORAGE_LIVE_MINIO_TESTS=true` only for the test process and
run the same file:

```powershell
npm exec --workspace @drezivo/api vitest -- run src/integrations/storage/__tests__/r2-live.integration.test.ts
```

It checks create-only PUT, repeat-PUT rejection, actual byte/hash inspection, and signed private
read; concurrent create-only attempts plus JPEG, PNG, WebP, and PDF fixture inspection are also
covered. It deletes its synthetic objects in `finally`. Normal local development continues to use
loopback MinIO and local-only credentials.

## Cutover and rollback

Set and record the rollback-window duration and the operator/approver in the cutover record before
the first R2 production write; if they are not recorded, do not enable production uploads. Keep the
old AWS objects and credentials available until that window has elapsed and reconciliation is
reviewed.

**Before the first R2 production write:** pause R2 upload authorization, restore the prior AWS
`version_id` values from the protected migration manifest for rows changed for R2, and restore the
previous application/configuration. Switch only after read checks prove every active database
reference resolves to the exact accepted AWS bytes. If the manifest or any source object is
unavailable, do not flip providers; keep uploads paused and recover the missing evidence first.

**After the first R2 production write:** never blindly point the application back at AWS. Pause new
upload authorization and reconcile the database-referenced objects on both providers. For every
R2-only object that must remain available, copy its actual accepted bytes to AWS without
overwriting an unexplained key, read back and verify size/SHA-256, and record the AWS version ID
returned by the copy (or null if the source provider does not version objects). Restore the saved
AWS version mappings for objects migrated before cutover. Switch the single active endpoint only
after every database reference resolves to the verified AWS bytes and pending uploads have a safe
disposition. If any object cannot be reconciled, keep R2 active and fix forward; do not introduce
provider-aware fallback as an emergency shortcut.

The rollback window closes only after its pre-recorded duration, the chosen observation checks,
and object reconciliation have all passed review. Never remove AWS credentials or source objects
before then. A rollback-window expiry by itself does not prove migration integrity.

The current adapter deliberately fails closed when an R2 read is requested with a legacy non-null
`version_id`. This prevents a stale AWS version identifier from being ignored and the current key
being mistaken for accepted historical bytes. A production release must not rely on this error path
as its migration strategy.

## Bucket browser policy and incident response

Configure bucket CORS for exact approved staff origins only. Allow the methods and headers actually
used by the browser upload (`PUT`, `Content-Type`, and `If-None-Match`). Add browser read methods only
if a verified client flow requires them. Do not use wildcard origins; CORS is not authorization.

Keep private-bucket public access and its Public Development URL disabled. If public access is
accidentally enabled, immediately disable the access path, preserve safe provider audit evidence,
assess possible exposure under `security-incident.md`, and notify the responsible incident/privacy
owners. Rotate a compromised R2 credential in Cloudflare and the API host secret manager. Treat
presigned URLs as bearer capabilities until expiry; rotation does not replace review of already
issued URLs or uploaded objects.

## Observation gate

Before the production cutover, choose and record an observation duration appropriate to the pilot.
During that window verify catalogue upload/finalize/private read, payment-receipt upload/finalize/
private read, repeated-PUT rejection, signed-read expiry/refresh, and provider error handling. If
normal traffic does not exercise an operation, use a bounded non-sensitive check. Record only the
duration, operation classes, redacted outcome, and unresolved issue count.

Do not enable public derivatives or change the public catalogue image projection in Stage A. Stage B
requires a separate public-bucket lifecycle, approved custom domain, disabled `r2.dev` access,
publication service, deletion linkage, and privacy review.
