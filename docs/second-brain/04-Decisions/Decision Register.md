---
title: Decision Register
type: decision-index
status: current
owner: Drezivo team
source: "../../decisions/ and accepted owner decisions"
updated: 2026-10-28
tags: [drezivo, decisions, adr]
---

# Decision Register

- [[Monorepo Consolidation]] - one root Git repository with five deployable workspaces.
- [[Drizzle and PostgreSQL]] - Drizzle plus reviewed SQL for PostgreSQL constraints and RLS.
- [[Supabase Managed PostgreSQL]] - Supabase hosts PostgreSQL only; Drezivo keeps Clerk, Express authorization, and restricted runtime roles.
- [[Fittings Backend Decision Record]] - approved Fittings domain and backend behavior.
- [[Cloudflare R2 Object Storage]] - production object storage targets Cloudflare R2; local development keeps MinIO behind the same S3-compatible boundary.
- [[Single Standard Pilot Plan]] - historical one-plan pilot, superseded by [ADR 0015](../../decisions/0015-starter-and-standard-plans.md) and [ADR 0016](../../decisions/0016-app-only-growth-scale-plans.md).
- [[Shared Contracts Package]] - workspace package `@drezivo/contracts` as the API contract authority.
- [[Obsidian Second Brain]] - project-only linked notes, Canvas, and Bases with no secrets.

Each decision records context, choice, consequences, and supersession. The accepted ADRs in
`../../decisions/` remain the engineering authority.
