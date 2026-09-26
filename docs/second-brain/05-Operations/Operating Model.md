---
title: Operating Model
type: operations
status: current
owner: Drezivo team
source: "../../runbooks/ and ../../decisions/0009-supabase-managed-postgresql.md"
updated: 2026-09-26
tags: [drezivo, operations]
---

# Operating Model

Use the repository runbooks for deployment, rollback, migration rehearsal, incidents, and release.
The current scaffold has no live Supabase production database, Clerk, S3, email, or production
deployment configuration. Supabase is selected as managed PostgreSQL only. Its Data API remains
disabled, and separate restricted API/worker roles must be proven before business data is loaded.

Before production, prove tenant isolation, session expiry and revocation, exclusion constraints,
idempotency under concurrency, outbox recovery, backup restore, provider timeouts, and alerting.
