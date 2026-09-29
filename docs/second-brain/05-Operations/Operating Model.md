---
title: Operating Model
type: operations
status: current
owner: Drezivo team
source: "../../runbooks/, ../../decisions/0009-supabase-managed-postgresql.md, and ../../decisions/0010-cloudflare-r2-object-storage.md"
updated: 2026-09-26
tags: [drezivo, operations]
---

# Operating Model

Use the repository runbooks for deployment, rollback, migration rehearsal, incidents, and release.
Supabase is selected as managed PostgreSQL only. Cloudflare R2 is the selected production object-
storage target, but the production object inventory, host secrets, R2 bucket configuration, and
cutover status have not been verified in this checkout. Do not assume production is empty or that
AWS-backed legacy objects have been reconciled. Its Data API remains disabled, and separate
restricted API/worker roles must be proven before business data is loaded.

Before production, prove tenant isolation, session expiry and revocation, exclusion constraints,
idempotency under concurrency, outbox recovery, backup restore, provider timeouts, and alerting.
