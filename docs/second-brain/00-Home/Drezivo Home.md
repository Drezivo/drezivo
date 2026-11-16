---
title: Drezivo Home
type: index
status: active
owner: Drezivo team
source: "ROOT-REPOSITORY-ARCHITECTURE.md and linked second-brain notes"
updated: 2026-11-15
tags: [drezivo, index]
---

# Drezivo Home

The navigation hub for the Drezivo second brain.

## Start here

- [[01-Product/Drezivo Product Brief]] — concise product and pricing orientation.
- [[02-Architecture/Drezivo Architecture]] — system boundaries and implementation pointers.
- [[04-Decisions/Decision Register]] — accepted decisions and supersession history.
- [[03-Repositories/Repository Map]] and [[05-Operations/Operating Model]] — ownership and operations.
- [[06-Research/Research Register]], [[07-Glossary/Glossary]], and [[99-Archive/README]] — supporting context.

## Canonical specifications

- [[01-Product/Drezivo-PRD|Product requirements]] and [[01-Product/Drezivo-Market-Research|market research]].
- [[02-Architecture/Drezivo-TRD|Technical requirements]] and [[02-Architecture/Drezivo-Data-Model|data model]].
- [[02-Architecture/Drezivo-Data-Model-v2|Data model v2 proposal]] is a proposal, not an applied migration.
- [ERD sources](../../architecture/README.md) and [runbooks](../../runbooks/README.md) remain outside the vault.

Daily notes in `08-Daily` and archived plans are historical working context, not automatic first reads.

## Current truth

The system is one monorepo containing five workspaces. `contracts -> api -> app/web` is the
normal dependency direction. See the root [architecture guide](../../../ROOT-REPOSITORY-ARCHITECTURE.md)
and the private [security foundation](../../../SECURITY-FOUNDATION.template.md) pointer outside this vault for the complete map and
security baseline.
