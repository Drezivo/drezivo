---
title: Decision Register
type: decision-index
status: current
owner: Drezivo team
source: "../../decisions/ and accepted owner decisions"
updated: 2026-09-26
tags: [drezivo, decisions, adr]
---

# Decision Register

- [[Monorepo Consolidation]] - one root Git repository with five deployable workspaces.
- [[Drizzle and PostgreSQL]] - Drizzle plus reviewed SQL for PostgreSQL constraints and RLS.
- [[Supabase Managed PostgreSQL]] - Supabase hosts PostgreSQL only; Drezivo keeps Clerk, Express authorization, restricted runtime roles, and S3/MinIO.
- [[Shared Contracts Package]] - workspace package `@drezivo/contracts` as the API contract authority.
- [[Obsidian Second Brain]] - project-only linked notes, Canvas, and Bases with no secrets.

Each decision records context, choice, consequences, and supersession. The accepted ADRs in
`../../decisions/` remain the engineering authority.
