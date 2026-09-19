---
title: Operating Model
type: operations
status: current
updated: 2026-09-16
tags: [drezivo, operations]
---

# Operating Model

Use the repository runbooks for deployment, rollback, migration rehearsal, incidents, and release.
The current scaffold has no live Neon, Clerk, S3, email, or production deployment configuration.

Before production, prove tenant isolation, session expiry and revocation, exclusion constraints,
idempotency under concurrency, outbox recovery, backup restore, provider timeouts, and alerting.
