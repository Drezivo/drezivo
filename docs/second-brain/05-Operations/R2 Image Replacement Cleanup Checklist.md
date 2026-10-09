---
title: R2 Image Replacement Cleanup Checklist
type: implementation-checklist
status: in-progress
owner: Drezivo team
source: "Owner request; API route/reference re-scan and cleanup implementation, 2026-10-09"
updated: 2026-10-09
tags: [drezivo, operations, storage, r2, checklist]
---

# R2 Image Replacement Cleanup Checklist

**Status:** In progress. Sections 0 and 1 have code changes in the current checkout; the migration is not applied and cleanup is not enabled in any deployed environment. Staging/storage and Operations-alert verification remain open.

## Goal and agreed behavior

When an owner replaces a current image or payment-method material, Drezivo must remove the old object from Cloudflare R2 only after the replacement transaction commits and a reference check confirms that the old file is safe to delete. A failed R2 deletion must not undo the already-committed replacement. The durable worker retries cleanup and alerts Operations if the job reaches its terminal failure state.

Objects use unique, create-only storage keys. Replacement means upload a new object and switch the database reference; never overwrite the old key in place. Do not copy an object just to preserve its history. If any current or historical record still refers to it, keep the object until every such reference is gone.

## Scope

The 2026-10-09 re-scan confirmed these three replacement routes. Search reviewed API route registrations and file replacement call sites; no additional replacement endpoint was found.

| Replacement endpoint | Current reference being replaced | Source |
| --- | --- | --- |
| `PUT /api/v1/catalogue/clothing/:productId/images` | The clothing item's current `product_image` set, including its cover image. | [catalogue.routes.ts](../../../api/src/modules/catalogue/catalogue.routes.ts), [catalogue.service.ts](../../../api/src/modules/catalogue/catalogue.service.ts) |
| `PATCH /api/v1/storefront` | Storefront document media references: logo, cover, hero, and about images. | [storefront-cms.routes.ts](../../../api/src/modules/storefront-cms/storefront-cms.routes.ts), [storefront-cms.service.ts](../../../api/src/modules/storefront-cms/storefront-cms.service.ts) |
| `PATCH /api/v1/payment-methods/:paymentMethodId` | The current QR image and presentation-material file; material may be an image or PDF. | [payment-methods.routes.ts](../../../api/src/modules/payment-methods/payment-methods.routes.ts), [payment-methods.service.ts](../../../api/src/modules/payment-methods/payment-methods.service.ts) |

This checklist covers old objects displaced by replacement uploads only. Remove-only or clear-only actions are out of scope. New upload authorization/finalization, clothing creation/import, guide creation/default changes, and immutable financial evidence are not replacement targets.

### Reference and object coverage confirmed on 2026-10-09

The reference check includes relational `file_object` references in `product_image.file_id`, `measurement_guide.file_id`, `payment_method.qr_file_id` / `material_file_id`, `payment_receipt.file_id`, `subscription_payment.proof_file_id`, `import_job.file_id`, and `export_job.result_file_id`; storefront JSON references in `branding.logo_file_id`, `branding.cover_file_id`, `content.hero.image_file_id`, and `content.about.image_file_id`; and `policy_snapshot.rental_rules.image_file_ids`. The cleanup outbox row carries only its opaque candidate `file_id`; it is excluded from the live-business-reference check so a job does not block itself. The re-scan found no other active outbox payload carrying separate file artifacts.

The storage implementation deletes the accepted source object's exact unique key. The current R2 adapter records no provider version ID and the API scan found no generated image derivatives. This is limited to the application's recorded source object; staging verification must still confirm the deployed bucket configuration and public/custom-domain cache behavior. Cloudflare documents `DeleteObject`-style deletion in its [R2 delete guide](https://developers.cloudflare.com/r2/objects/delete-objects/) and R2's [consistency behavior](https://developers.cloudflare.com/r2/reference/consistency/).

Keep these protected or versioned references intact:

- Published storefront policy versions append history. An image referenced by any retained policy snapshot stays in storage until that historical reference is gone.
- Reusable measurement-guide records are not replaced by the routes above and must keep their accepted image while referenced.
- Reservation and fitting receipts, subscription payment proofs, and other financial evidence are retained under their evidence/retention rules; never delete them as a side effect of a storefront or catalogue replacement.
- Any other tenant or current business record still referencing the same file prevents deletion. Do not assume the file belongs only to the endpoint that first uploaded it.

## Implementation checklist

### 0. Reconfirm route and reference coverage

- [x] Re-scan all API route registrations and image/file replacement call sites; confirmed the three routes above are complete and recorded no additions.
- [x] Map relational and JSON references to `file_object`, including product images, measurement guides, payment-method QR/material files, reservation and subscription evidence, import/export artifacts, storefront document media, and versioned policy image lists. The cleanup candidate's own job row is not treated as a live business reference to itself; no other active outbox payload carrying separate file artifacts was found.
- [x] Confirm the implementation targets the recorded accepted source object: R2 metadata has no provider version ID and no API-generated derivatives were found. Public/custom-domain cache behavior and deployed bucket configuration remain staging checks; do not claim those checks are complete yet.
- [x] Review the [`file_object` lifecycle](../../../api/src/db/schema/files.ts) and `ObjectStorage` interface. Added `deletion_pending` through forward migration `0075_file_object_cleanup.sql`, with API/worker rollout dependent on applying the migration first. Migration has not been run.

### 1. Make replacement and cleanup durable

- [x] For each in-scope endpoint, diff old and new file IDs inside the existing business transaction. Unchanged IDs and IDs retained by the replacement are skipped. Clear-only/removal-only edits do not queue cleanup.
- [x] Write cleanup-candidate outbox work in the same transaction that commits new references. A rollback leaves neither the replacement nor cleanup work visible.
- [x] Use the durable worker/outbox lease and bounded retry model. The payload contains only an opaque file ID; the worker loads the storage key from the database after the reference barrier.
- [x] The R2 S3-compatible storage adapter implements deletion. Providers without delete support defer cleanup and do not mark the file deleted.
- [x] Duplicate delivery is safe: absent-object deletion succeeds; unique candidate dedupe and lifecycle states prevent a second business effect. A final reference check plus the `deletion_pending` barrier blocks later attachments before physical deletion.
- [x] Replacement success is independent of cleanup success after the business transaction commits. Temporary deletion failures use the outbox retry policy; intentional reference/hold/retention waits are deferred without consuming attempts.
- [ ] Confirm the deployed alerting path notifies Operations when `outbox event moved to dead-letter` is emitted; the worker already writes a structured error event, but notification routing is not verified here.

### 2. Prove an object is deletable

- [x] In the cleanup worker, lock the file row and re-check every relational and JSON reference after the replacement has committed. The narrow security-definer function returns only a boolean, checks references across tenants, verifies worker tenant context, and fails closed.
- [x] Serialize reference attachment with cleanup for the re-scanned attachment paths: accepted file rows are locked `FOR SHARE`; cleanup obtains `FOR UPDATE` and transitions to `deletion_pending`; the database trigger prevents new holds/retention mutations after the barrier.
- [x] Retain the object if any reference remains, `legal_hold` is set, or `retention_until` is still in the future. Deferred events remain pending and are re-evaluated after their scheduled retry delay when references/protection may have changed.
- [x] Keep a durable cleanup candidate while deletion is deferred. Deferred outbox events stay pending without consuming attempts, so removal of the last reference, retention expiry, or hold release is picked up by a later retry.
- [x] Preserve historical/shared objects without automatic duplication. A policy-history reference is sufficient reason to defer deletion after a current storefront reference changes.
- [x] Only after reference and protection checks pass, call `ObjectStorage.deleteObject` for the recorded source key. No app derivatives/provider versions were found; public cache behavior still needs staging verification. Set the tombstone and deletion timestamp only after storage deletion succeeds (or the object is confirmed absent).
- [x] On storage failure, leave durable retry state and safe diagnostic context. The adapter and handler sanitize provider failures; no storage keys, signed URLs, credentials, or file contents are logged or persisted in cleanup diagnostics.

### 3. Test all three replacement flows

- [ ] Clothing image replacement queues only displaced, unreferenced IDs and preserves any image ID retained in the new set.
- [ ] Storefront document replacement covers logo, cover, hero, and about independently; unchanged or still-referenced media is not deleted.
- [ ] Payment-method replacement covers QR and material references, including switching presentation modes; historical/financial evidence is not swept up.
- [ ] For each endpoint, a business transaction rollback leaves old references and creates no cleanup work; a committed replacement remains successful when storage deletion fails.
- [ ] Test files shared by two current records, referenced by another tenant, referenced by a policy snapshot, or attached to a measurement guide. Each must remain available until all references are removed.
- [ ] Test legal hold, future retention, retention expiry, and safe retry after a worker crash before deletion, after R2 deletion, and before the tombstone update.
- [ ] Test concurrent replacement/reference attachment versus cleanup; exactly one safe outcome wins, and no live reference can point to an object already deleted.
- [ ] Test duplicate outbox delivery, missing-object idempotency, bounded retries, and Operations alerting after dead-letter.
- [ ] Verify deletion against local MinIO and non-production R2, including all applicable versions/derivatives. Do not use production objects for destructive tests.
- [ ] Assert logs and stored worker errors contain no storage keys, signed URLs, credentials, or image data.

### 4. Roll out safely

- [ ] Inventory the in-scope current references and confirm the worker supports the cleanup event before enabling enqueueing from any endpoint.
- [ ] Roll out worker-handler support first (it is dormant until producers enqueue this event), apply `0075_file_object_cleanup.sql`, and only then deploy/enable API replacement producers. This prevents an older worker from dead-lettering a new event type and prevents code from relying on a missing lifecycle state/function.
- [ ] Exercise replacement, retry, retention, legal-hold, and dead-letter alert paths in staging before enabling in production.
- [ ] Document the operator procedure for inspecting, retrying, or holding a cleanup job without exposing object keys or deleting a referenced object.
- [ ] Record evidence for each endpoint and each safety test above. A passing unit/build check alone does not establish that the R2 object and applicable versions were deleted.

## Related notes and sources

- [[00-Home/Drezivo Home]]
- [[05-Operations/API Security Review 2026-10-07]]
- [Accepted R2 storage decision](../../decisions/0010-cloudflare-r2-object-storage.md)
- [File-object schema](../../../api/src/db/schema/files.ts)
- [Object-storage interface](../../../api/src/integrations/storage/object-storage.ts)
- [R2 object deletion](https://developers.cloudflare.com/r2/objects/delete-objects/)
- [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/)
