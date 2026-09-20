---
title: Clothing Phase 2 File Attachment Flow
type: implementation-evidence
status: complete
owner: Drezivo team
updated: 2026-09-20
tags: [drezivo, v1, clothing, files, uploads, catalogue, evidence]
---

# Clothing Phase 2 File Attachment Flow

## Scope

This note records the evidence for **CLT-022 — Implement clothing image/file attachment flow**.
It covers the canonical direct-upload lifecycle, accepted-file validation, tenant ownership,
and the idempotent ordered photo set for a clothing product. It does not connect the Add Clothing
frontend; that remains CLT-041.

## Canonical upload flow

The browser never receives AWS access keys or unrestricted storage credentials.

1. Staff calls `POST /api/v1/uploads` with `purpose`, declared content type, byte size, and a
   standard-base64 SHA-256 digest plus an `Idempotency-Key`.
2. Drezivo resolves Clerk staff/tenant/membership/branch permissions server-side, applies the
   tenant lifecycle write gate, and requires `assets.manage`.
3. Drezivo creates a tenant-owned private `file_object` in `pending_upload` and returns only a
   short-lived checksum-bound presigned `PUT` URL plus the exact required headers.
4. The browser PUTs bytes directly to private object storage.
5. Staff calls `POST /api/v1/uploads/:fileId/finalize`.
6. Drezivo re-resolves tenant authority, conceals foreign file IDs, inspects the uploaded object
   server-side, and checks declared content type, byte size, SHA-256 checksum, and JPEG/PNG/WebP
   file signature.
7. Only a matching object is transitioned to `accepted` with `frozen_at` and the provider version
   ID when available. A mismatch becomes `rejected`; a provider outage leaves the row pending and
   cannot manufacture an accepted file.

The clothing file flow currently accepts JPEG, PNG, and WebP and caps source images at 10 MB.
The shared Files contract retains the canonical database purpose vocabulary; clothing routes only
allow `catalogue_image` and `measurement_guide` purposes.

## Product photo ordering / cover

Authorized staff can replace the complete product photo set through:

`PUT /api/v1/catalogue/clothing/:productId/images`

The request is a closed `file_ids` array capped at ten unique accepted catalogue-image file IDs.
Array order is authoritative. `file_ids[0]` is the cover image. Tenant/product/file authority comes
from server context and database ownership, never the body.

The mutation:

- conceals foreign product/file references as not found;
- rejects pending/rejected/non-image files;
- requires `assets.manage` and the normal tenant lifecycle write policy;
- requires an idempotency key;
- replaces the ordered `product_image` rows and appends the audit row in one tenant transaction;
- replays the same intent safely;
- rejects a changed payload under the same key without changing the existing photo set.

Add Clothing continues to validate `image_file_ids` before creating the catalogue graph, so a
product cannot claim an unaccepted or foreign file as one of its photos.

## Storage boundary

`api/src/integrations/storage/object-storage.ts` defines the provider-neutral interface.
`api/src/integrations/storage/s3-object-storage.ts` implements the private S3-compatible path using
server-side configuration only. The signed direct upload includes `Content-Type` and
`x-amz-checksum-sha256`; finalization uses authenticated server-side object inspection.

No browser response contains `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY`.

## Evidence

`api/tests/integration/catalogue-files.test.ts` passes **7/7** against disposable local PostgreSQL
as the non-superuser app role. It proves:

- bounded private upload authorization and safe response shape;
- checksum-bound accepted/frozen finalization;
- MIME/type and byte-size policy enforcement;
- checksum/object mismatch rejection;
- provider failure leaves the file pending, not falsely accepted;
- foreign file concealment before provider inspection;
- `assets.manage` authorization for upload and image mutation;
- ordered cover/photo replacement and idempotent replay;
- changed-payload idempotency rejection;
- duplicate attachment rejection;
- pending and foreign image references do not alter the current product photo set.

Regression gates after CLT-022:

- Contracts tests: **66/66 passed**.
- Contracts lint/build: passed.
- CLT-020 Add Clothing PostgreSQL suite: **10/10 passed**.
- CLT-021 Add Clothing route PostgreSQL suite: **10/10 passed**.
- API unit suite: **82/82 passed**.
- API typecheck/lint/build: passed.
- `git diff --check`: passed before checklist/evidence finalization and is rechecked after docs update.
