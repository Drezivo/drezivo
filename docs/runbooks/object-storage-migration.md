# Object-storage migration and cutover

This runbook covers the AWS S3 → Cloudflare R2 transition while preserving Drezivo's existing
presigned-URL architecture. It does not authorize a production cutover by itself.

## Runtime shape

```text
browser
  → POST authorize upload
  ← short-lived presigned PUT + required headers
  → PUT directly to R2 (production/staging) or MinIO (local)
  → POST finalize
API
  → GET stored object through ObjectStorage
  → verify byte size, content type, SHA-256, and magic bytes
  → mark file accepted in PostgreSQL
```

The browser never receives object-storage credentials. New upload keys are unique and the signed PUT
requires `If-None-Match: *`, so a reused URL cannot overwrite an existing object.

## Required configuration

Production and staging use these deployment-managed names:

- `OBJECT_STORAGE_ENDPOINT` — R2 S3 API endpoint only, `https://<account-id>.r2.cloudflarestorage.com`.
- `OBJECT_STORAGE_REGION` — `auto` for R2.
- `OBJECT_STORAGE_BUCKET_PRIVATE` — private source/evidence bucket.
- `OBJECT_STORAGE_BUCKET_PUBLIC` — optional; reserved for a separately reviewed public-derivative
  path. The current private upload flow does not require it.
- `OBJECT_STORAGE_ACCESS_KEY_ID` and `OBJECT_STORAGE_SECRET_ACCESS_KEY` — bucket-scoped S3 API
  credentials. Never expose them to `app` or `web`.
- `OBJECT_STORAGE_FORCE_PATH_STYLE` — `false` for R2; `true` for local MinIO.
- `OBJECT_STORAGE_UPLOADS_ENABLED` — explicit production cutover switch. Production defaults to
  disabled if the variable is omitted.

Local MinIO may temporarily use the legacy `S3_*` variable set only when `S3_ENDPOINT` is an HTTP
loopback/MinIO endpoint. Legacy variables never select a remote provider in staging or production.

## Browser CORS

Presigned URLs authorize an object operation; they do not bypass browser CORS. The R2 bucket must
allow each actual Drezivo browser origin that uploads directly. For local development that normally
includes `http://localhost:3000`; production/staging must use the exact deployed origins.

The bucket policy should permit at least:

```json
[
  {
    "AllowedOrigins": ["<exact-app-origin>", "<exact-storefront-origin>"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type", "if-none-match"],
    "ExposeHeaders": ["etag", "content-length", "content-type"]
  }
]
```

Do not use `*` for production origins. Re-run the live browser-preflight test after changing CORS.
The 30 September 2026 non-production storage round-trip passed, but the configured R2 test bucket did
not yet allow the local browser origin, so browser direct upload remains gated on this provider
setting.

## Non-production live verification

Use a dedicated R2 test bucket and credential. The live test is intentionally disabled by default.
It requires both an opt-in flag and exact bucket confirmation. Supply real secrets only through the
approved secret file or host environment; never paste them into a command, ticket, or Git file.

The test proves:

- presigned create-only PUT works;
- reusing the same PUT cannot overwrite the key;
- API inspection hashes the bytes actually stored;
- private presigned GET returns the same bytes;
- anonymous object GET is denied;
- optional browser CORS allow/deny behavior when test origins are supplied.

Any live-test object is created below `tenant-files/r2-live-test/`. If the deliberately narrow test
credential cannot delete, configure short test-bucket lifecycle cleanup for that prefix.

## Existing AWS object inventory

Before production cutover, query `file_object` and classify every non-deleted row by lifecycle,
storage key, expected SHA-256, byte size, MIME type, and any non-null `version_id`. Do not put object
keys, signed URLs, file contents, receipts, or customer PII into tickets or shared notes.

For every accepted AWS-backed object:

1. Stop issuing new AWS upload authorizations for the cutover window.
2. Allow already-issued upload authorizations to expire or explicitly reconcile their resulting
   objects before taking the final inventory.
3. Copy the exact accepted AWS object/version to the same planned immutable R2 key or an approved
   replacement key.
4. Read the copied R2 bytes and verify SHA-256 and byte size against the database record.
5. Only after successful object-by-object verification may the row be considered migrated.
6. Legacy rows with non-null `version_id` must be reconciled before R2 reads; the runtime fails
   closed rather than silently dropping that identifier.

Do not infer migration success from object counts alone.

## Cutover

1. Complete the non-production live tests, including browser CORS.
2. Complete object inventory/migration if AWS-backed objects exist.
3. Configure R2 runtime secrets on the deployment host.
4. Keep `OBJECT_STORAGE_UPLOADS_ENABLED=false` while read-only smoke checks are performed.
5. Verify representative private reads and finalize behavior in staging.
6. Enable new upload authorization explicitly.
7. Watch storage dependency failures, finalize rejections, upload error rate, and signed-read failures.
8. Keep AWS resources and credentials available through the approved rollback window.

## Rollback

If R2 write/read verification fails during cutover, disable new upload authorization immediately.
Do not switch an R2-written database row back to AWS by endpoint change alone. Reconcile every object
created during the cutover window first; object keys and SHA-256 values are the authority for exact
bytes. Restore the previous provider only for rows known to exist there, then investigate before
re-enabling uploads.

## Provider references

- [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
