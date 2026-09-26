---
title: Drezivo Home
type: index
status: active
owner: Drezivo team
source: "ROOT-REPOSITORY-ARCHITECTURE.md and linked second-brain notes"
updated: 2026-09-26
tags: [drezivo, index]
---

# Drezivo Home

The navigation hub for the Drezivo second brain.

## Canonical maps

- [[01-Product/Drezivo Product Brief]]
- [[02-Architecture/Drezivo Architecture]]
- [[02-Architecture/API Module Boundaries and Layering]]
- [[02-Architecture/Tenancy Checklist - What Why How]]
- [[02-Architecture/Tenancy, Onboarding, Clerk, Memberships, and Billing Foundation]]
- [[02-Architecture/Drezivo System Canvas]]
- [[03-Repositories/Repository Map]]
- [[04-Decisions/Decision Register]]
- [[04-Decisions/Supabase Managed PostgreSQL]]
- [[05-Operations/Operating Model]]
- [[05-Operations/API Security Review 2026-09-23]]
- [[06-Research/Research Register]]
- [[07-Glossary/Glossary]]
- [[08-Daily/2026-09-16]]
- [[08-Daily/2026-09-17]]
- [[08-Daily/2026-09-18]]
- [[08-Daily/2026-09-23]]
- [[08-Daily/2026-09-26]]

## Current truth

The system is one monorepo containing five workspaces. `contracts -> api -> app/web` is the
normal dependency direction. See the root [architecture guide](../../../ROOT-REPOSITORY-ARCHITECTURE.md)
and the private [security foundation](../../../SECURITY-FOUNDATION.template.md) pointer outside this vault for the complete map and
security baseline.
