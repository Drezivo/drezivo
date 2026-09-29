# 0010. Cloudflare R2 for production object storage

**Status:** Accepted as the production-provider target; production cutover remains gated
**Date:** 29 September 2026
**Owners:** Product and API/platform owners

## Context

Drezivo already has a provider-neutral upload API and an `ObjectStorage` boundary, but its
implementation hand-signs AWS requests, falls back to AWS regional hostnames, and expects provider
checksum/version behavior that Cloudflare R2 does not guarantee in the same way. Local development
already provisions MinIO. The product owner has directed that Cloudflare R2 become the production
object-storage provider and that AWS S3 not remain a production runtime provider.

The current `file_object` schema does not record a provider. Some existing accepted records may
refer to AWS object versions, while R2 does not implement S3 bucket versioning. No production data
inventory, workload cost model, provider migration, legal/subprocessor review, or live R2 smoke test
is claimed by this decision.

## Decision

- Use Cloudflare R2 as the only production object-storage provider. The API continues to use the
  S3-compatible protocol through an explicitly configured endpoint and credentials; the AWS SDK is
  a protocol client, not an AWS service dependency or fallback.
- Keep MinIO as the local development provider. Production must configure an HTTPS R2 S3 endpoint,
  region `auto`, virtual-hosted addressing, a private bucket, and deployment-managed credentials.
- Keep public catalogue derivatives out of the Stage A private-source/evidence bucket. Stage B
  public delivery remains a separate implementation and infrastructure gate.
- Make upload keys write-once with a signed `If-None-Match: *` condition. Finalization streams the
  actual stored bytes through the API to verify byte size, content type, SHA-256, and file signature;
  client metadata and provider checksum headers are not the trust anchor.
- New R2 records do not depend on `version_id`. The API fails closed when a legacy non-null version
  is requested against an R2 endpoint. Before production cutover, inventory and reconcile every
  AWS-backed accepted or pending object, including exact source versions and hashes.
- Treat production cutover as blocked until the workload/cost review, object inventory and
  migration/rollback design, live R2 compatibility test, deployment-host configuration, and
  privacy/subprocessor review are complete. This ADR selects the target provider but does not claim
  that R2 costs, production data transfer, or operational readiness have been validated.
- Do not remove legacy AWS resources or credentials until the approved migration and rollback window
  closes. Do not deploy, transfer production objects, or change provider infrastructure as part of
  this repository decision.

## Consequences

- Runtime configuration uses `OBJECT_STORAGE_*` names and requires an explicit endpoint; there is
  no AWS region or default AWS hostname path.
- R2 presigned URLs remain short-lived bearer capabilities. Browser clients never receive storage
  credentials, and CORS remains a browser policy rather than an authorization boundary.
- Tenant isolation remains enforced by Drezivo authentication, tenant-scoped database access, and
  server-generated keys. A bucket-scoped provider credential does not replace those controls.
- The selected runtime credential's actual permissions must be reviewed, not inferred from its
  bucket scope. Cloudflare's standard Object Read & Write permission includes listing, and write
  actions include destructive object operations such as `DeleteObject`; treat that credential as
  destructive access to its entire bucket and prove recovery before production use. [R2 token
  permissions](https://developers.cloudflare.com/r2/api/tokens/), [temporary-credential action
  definitions](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/) (verified
  2026-09-29).
- Existing legacy versioned reads cannot be switched to R2 until their exact accepted bytes have
  been migrated and reconciled. If the inventory finds durable AWS objects, a reviewed migration
  path is required before production config changes.
- The low-level storage boundary can delete an object, but no retention or legal-hold deletion
  lifecycle is implied. Approved retention schedules and governed deletion remain separate work.
- No cost, latency, residency, compliance, or availability claim is made by this decision.

## Open production gates

- Count and classify existing objects without placing keys, signed URLs, file contents, or personal
  data in operational notes.
- Measure the expected storage, upload, verification-read, signed-read, and future derivative
  workload against current R2 pricing.
- Prove R2 and local MinIO accept the exact conditional PUT and signed header behavior in use.
- Complete the migration/rollback design and authorization-drain procedure before the first R2
  production write.
- Record the responsible privacy/legal review outcome before transferring or newly writing real
  customer files to R2.
- Configure staging/production buckets, runtime credentials, CORS, alerts, and host secrets only
  through their reviewed operational procedures.

## References

- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 JavaScript SDK example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/)
- [Technical Requirements Document](../architecture/Drezivo-TRD.md)
- [Data Model](../architecture/Drezivo-Data-Model.md)
- [Cloudflare R2 migration checklist](../second-brain/05-Operations/Cloudflare%20R2%20Migration%20Checklist.md)
