---
title: Cloudflare R2 Object Storage
type: decision
status: accepted
date: 2026-09-30
source: "../../decisions/0010-cloudflare-r2-object-storage.md"
tags: [drezivo, storage, r2, architecture]
---

# Cloudflare R2 Object Storage

Production object storage targets Cloudflare R2 through Drezivo's S3-compatible `ObjectStorage`
boundary. Local development remains on MinIO. Browser flows stay authorize → create-only presigned
PUT → finalize; the API computes SHA-256 from the bytes actually stored before acceptance.

New R2 objects do not depend on `version_id`. A legacy non-null provider version fails closed until
migration/reconciliation is complete. Production upload authorization remains explicitly gated.

The non-production R2 storage round-trip passed on 30 September 2026. Browser CORS for the local app
origin is still an infrastructure gate on the configured test bucket; see the canonical ADR and
`../../runbooks/object-storage-migration.md`.
