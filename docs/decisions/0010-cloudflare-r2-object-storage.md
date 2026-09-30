# 0010. Cloudflare R2 for production object storage

**Status:** Accepted as the production storage target; production cutover remains gated
**Date:** 30 September 2026
**Owners:** Product and API/platform owners

## Context

Drezivo already exposes provider-neutral file workflows through `ObjectStorage`: the browser asks the
API for a bounded upload authorization, uploads directly with a presigned PUT, and then asks the API
to finalize the object. The previous concrete adapter was AWS-specific: it hand-signed S3 requests,
used AWS regional hostnames by default, trusted `x-amz-checksum-sha256` during finalization, and could
pin reads to an S3 `version_id`.

The product owner selected Cloudflare R2 to replace Amazon S3 for production object storage while
keeping the existing presigned-URL architecture. Local development continues to use MinIO.

## Decision

- Cloudflare R2 is the production object-storage target. The API accesses it through R2's
  S3-compatible endpoint; the AWS SDK is used only as an S3 protocol client.
- MinIO remains the local-development provider behind the same `ObjectStorage` interface.
- Browser upload contracts remain provider-neutral: Drezivo returns `upload_url`, `upload_method`,
  `required_headers`, and expiry; clients PUT directly to the returned URL.
- Upload keys are unique and create-only. Presigned PUTs bind `If-None-Match: *`, preventing a reused
  upload authorization from overwriting an accepted key.
- Finalization does not trust provider checksum headers. The API streams the stored object, bounds the
  read to the upload limit, computes SHA-256 over the actual bytes, verifies content type and magic
  bytes, and compares the result with the authorization metadata stored in PostgreSQL.
- New R2 objects do not depend on provider version IDs. R2-native inspection returns `versionId=null`;
  accepted objects are pinned by their SHA-256 plus immutable unique key. If a legacy database row
  still carries a non-null AWS version ID, an R2 read fails closed until that object is reconciled.
- Runtime configuration uses `OBJECT_STORAGE_*` names. Production and staging require an HTTPS R2 S3
  endpoint, region `auto`, virtual-hosted addressing, and deployment-managed credentials.
- Production upload authorization can be paused with `OBJECT_STORAGE_UPLOADS_ENABLED=false`. It
  defaults to false in production and true outside production.

## Compatibility and evidence

On 30 September 2026 the adapter's live test succeeded against the configured non-production R2
bucket for create-only upload, overwrite prevention, stored-byte SHA-256 verification, private
presigned GET, and object deletion. A forced literal bucket named `test-bucket` returned 403 because
the current credential is scoped to the configured test bucket instead. Browser CORS for
`http://localhost:3000` is not yet enabled on that bucket, so browser upload remains blocked until
Cloudflare-side CORS is configured.

The live test is opt-in and requires an explicit bucket confirmation variable so it cannot casually
run against production.

## Consequences

- Catalogue images, storefront assets, measurement guides, and payment receipts continue using the
  same authorize → direct PUT → finalize workflow.
- Clients treat HTTP 412 from a retried create-only PUT as eligible for finalization. This recovers
  from the case where the first PUT succeeded but its response was lost; the API still rejects the
  object unless the stored bytes exactly match the expected metadata and SHA-256.
- R2 bucket CORS is an infrastructure requirement for browser direct uploads and is not an
  authorization boundary. Private objects remain private and are read through short-lived presigned
  GET URLs.
- Existing AWS-backed objects, if any, require inventory and byte-for-byte reconciliation before a
  production endpoint cutover. The old provider must not be deleted until rollback is no longer
  required.
- No database migration is required for new R2 objects because the existing accepted-file invariant
  already permits SHA-256 pinning when `version_id` is null.

## References

- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 AWS SDK JavaScript example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [Object-storage migration runbook](../runbooks/object-storage-migration.md)
- [Technical Requirements Document](../architecture/Drezivo-TRD.md)
