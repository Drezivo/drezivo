# Object-storage migration and cutover

This runbook covers the repository's Cloudflare R2 target, local MinIO parity, and the safe path
from any legacy production provider. The AWS SDK in `api` is only the S3-compatible protocol
client. AWS is not a production runtime provider after cutover.

**Status:** Not executed. Production cutover is blocked until the evidence gates in ADR 0010 and
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

Before the first R2 production write, rollback may restore the previous provider configuration only
if every database reference remains readable there. Keep the old credentials and source objects
available through the recorded rollback window.

After the first R2 production write, do not blindly point the application back at the old provider.
Pause new upload authorization, compare redacted object counts and per-object integrity, and either
copy/reconcile every R2-only object to the rollback provider or keep R2 active and fix forward. Do
not mark database rows readable under a provider that does not contain the exact accepted bytes.
Never remove old credentials or objects until migration verification and the approved rollback
window have closed.

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
