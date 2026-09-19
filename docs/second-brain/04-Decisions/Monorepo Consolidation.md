---
title: Monorepo Consolidation
type: decision
status: accepted
updated: 2026-09-16
tags: [drezivo, decision, monorepo]
---

# Monorepo Consolidation

The root Drezivo directory is one Git repository with five workspaces: `contracts`, `api`, `app`,
`web`, and `docs`. The root lockfile, CI, license, security rules, and review boundary govern all
workspaces. Former per-workspace Git metadata is archived outside normal operations.

The workspace boundaries still protect ownership and deployment concerns. The shared contracts
package is imported directly, so one pull request can expose API drift across every consumer.

Engineering authority: `docs/decisions/0006-monorepo.md` and
`ROOT-REPOSITORY-ARCHITECTURE.md` in the root filesystem.
