---
title: Decision Register
type: decision-index
status: current
owner: Drezivo team
source: "../../decisions/ and accepted owner decisions"
updated: 2026-10-01
tags: [drezivo, decisions, adr]
---

# Decision Register

- [[Monorepo Consolidation]] - one root Git repository with five deployable workspaces.
- [[Drizzle and PostgreSQL]] - Drizzle plus reviewed SQL for PostgreSQL constraints and RLS.
- [[Supabase Managed PostgreSQL]] - Supabase hosts PostgreSQL only; Drezivo keeps Clerk, Express authorization, and restricted runtime roles.
- [[Cloudflare R2 Object Storage]] - production object storage targets Cloudflare R2; local development keeps MinIO behind the same S3-compatible boundary.
- [[Single Standard Pilot Plan]] - one sellable Standard offer at PHP 300/month, internally backed by `starter` v1.
- [[Shared Contracts Package]] - workspace package `@drezivo/contracts` as the API contract authority.
- [[Obsidian Second Brain]] - project-only linked notes, Canvas, and Bases with no secrets.

Each decision records context, choice, consequences, and supersession. The accepted ADRs in
`../../decisions/` remain the engineering authority.
