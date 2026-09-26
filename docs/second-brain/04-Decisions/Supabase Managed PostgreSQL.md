---
title: Supabase Managed PostgreSQL
type: decision
status: accepted
owner: Drezivo product and platform owners
source: "../../decisions/0009-supabase-managed-postgresql.md"
updated: 2026-09-26
tags: [drezivo, decisions, database, supabase, postgresql]
---

# Supabase Managed PostgreSQL

Supabase replaces Neon as Drezivo's managed PostgreSQL provider. This changes hosting and
operations, not application authority.

## What remains unchanged

- Clerk proves staff identity.
- The Express API authorizes accounts, tenants, branches, roles, permissions, and entitlements.
- Drizzle and `node-postgres` execute reviewed PostgreSQL transactions and migrations.
- `drezivo_app` and `drezivo_worker` remain restricted, non-owner, non-`BYPASSRLS` roles.
- S3/MinIO remains the object-storage boundary.

## Supabase boundary

- Use Supabase as managed PostgreSQL only.
- Disable the Data API. Do not give browsers Supabase database or service-role credentials.
- Use a direct connection for migrations, backup, and restore.
- Use a direct or session-pooled restricted connection for the persistent API and worker;
  transaction pooling is reserved for a separately reviewed serverless deployment.
- Keep staging and production in separate Supabase projects and rehearse restore plus custom-role
  password recovery before production.

See [[02-Architecture/Drezivo Architecture]], [[05-Operations/Operating Model]], and the canonical
[ADR 0009](../../decisions/0009-supabase-managed-postgresql.md).

## Decision history

- **2026-09-26:** Accepted before Neon held any Drezivo data, so no data-transfer or dual-write
  period is required.
