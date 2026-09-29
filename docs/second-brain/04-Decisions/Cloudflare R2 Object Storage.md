---
title: Cloudflare R2 Object Storage
type: architecture-decision
status: accepted-target-cutover-gated
owner: Drezivo team
source: "[Canonical ADR 0010](../../decisions/0010-cloudflare-r2-object-storage.md); product-owner direction; [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) (checked 2026-09-29)"
updated: 2026-09-29
tags: [drezivo, decision, storage, cloudflare, r2]
---

# Cloudflare R2 Object Storage

Cloudflare R2 is the selected production object-storage target. MinIO remains the local
development provider. The API uses the maintained AWS SDK only as an S3-compatible protocol
client, with an explicit endpoint and credentials; it has no AWS provider or endpoint fallback.

The repository adapter now signs create-only uploads, streams actual stored bytes to verify
SHA-256, size, MIME type and file signature, and signs private reads. R2 does not provide S3 bucket
versioning, so the adapter fails closed on legacy version-specific reads rather than silently
returning current bytes for a historical record.

Production cutover is not complete. The object inventory, cost model, exact migration/rollback
path, R2 live compatibility test, selected-host configuration, and privacy/subprocessor review
remain open. Do not infer production readiness, cost savings, data residency, or legal approval from
the provider decision or adapter tests alone.

See the canonical [ADR 0010](../../decisions/0010-cloudflare-r2-object-storage.md) and the
[[05-Operations/Cloudflare R2 Migration Checklist]].

## Sources

- Product-owner direction to use R2 for production uploads, recorded 2026-09-29.
- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) checked
  2026-09-29: region `auto`, conditional `PutObject` support, no `PutBucketVersioning`, and the
  documented checksum algorithm/type matrix.
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
  checked 2026-09-29: supported endpoint and signed-header behavior.
