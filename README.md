# Drezivo — Product and Architecture Pack

**Updated:** 15 September 2026. Planning documents; no application/database deployed.

## Root operating guide

Read [Root Repository Architecture](ROOT-REPOSITORY-ARCHITECTURE.md) first for the complete
monorepo folder map, workspace ownership, setup commands, release order, glossary, and agent
instructions. New coding agents should also read [AI Agent Onboarding](AI-AGENT-ONBOARDING.md).
The companion [human architecture guide](Drezivo-Human-Repository-Architecture-Guide.docx)
contains the same orientation in a visual Word document.

## Read in this order

1. [Enhanced PRD](Drezivo-PRD.md) — V1 scope, V1.1/V2/V3 progression, workflows, permissions, prices and release gates.
2. [Market research](Drezivo-Market-Research.md) — competitor/Philippine evidence, original gaps, assumptions and validation plan.
3. [TRD](Drezivo-TRD.md) — recommended implementation using Next.js/TypeScript, Express/TypeScript, Neon, Clerk, S3 and REST.
4. [Logical data model](Drezivo-Data-Model.md) — entity dictionary, invariants, state transitions and transaction rules.
5. [ERD input](Drezivo-ERD.dbml) — 50 entities and 132 relationships, grouped by release. Import into a DBML-compatible diagram tool. Do not treat exported SQL as complete production migrations.
6. [Legal drafts](docs/product/legal/) — Philippines-first Terms of Service and Privacy Policy for counsel and Data Protection Officer review.
7. [Security foundation template](SECURITY-FOUNDATION.template.md) — instructions for obtaining the private session, tenant isolation, risk, bot, monitoring, and incident guidance.
8. [GitHub ruleset runbook](docs/runbooks/github-ruleset.md) — exact `main` protection settings and the plan/CI prerequisites.

## Confirmed decisions

- Clothing rental operations, Philippines first; one branch at launch with branch-aware ownership from day one.
- Monthly prices: **Starter ₱300 · Professional ₱499 · Business ₱1,299**.
- Familiar stack retained. A modular Express API plus durable worker is recommended.
- Receipt evidence is not payment confirmation. Exclusive expiring holds precede payment instructions.
- Separate catalogue variants, physical garments, planned allocation, actual custody and refundable deposits.

## Verification and limitations

The DBML was successfully converted by `@dbml/cli` to a PostgreSQL SQL dump for syntax/reference validation. SQL was generated in a temporary directory only. No Neon database was created or modified. RLS, interval exclusion, financial invariants, concurrency, performance and recovery still require implementation tests; they are specified, not claimed as proven.

The original PRD is preserved [here](docs/archive/Rentivo-PRD-v1.0-original.md), with SHA-256 matching the frozen graph input. All source images remain unchanged. Research is desk research with first-party sources, not customer interviews or evidence of product–market fit.

## Baseline knowledge graph

[Interactive graph](graphify-out/graph.html) · [Report](graphify-out/GRAPH_REPORT.md) · [Integrity report](graphify-out/GRAPH_HEALTH.txt)

Scope is the **original PRD only**, not the revised pack. It contains 82 nodes, 140 graph links and seven communities. Seven reverse-direction pairs collapse in the undirected representation; raw extraction is retained. No missing/dangling endpoints were found. Extraction token counts were unavailable and are marked unknown.

The requested exploration/graph skills informed the review. The compression skill was read; no existing user-selected memory target was supplied for its overwrite workflow, so human-facing documents were not compressed. [Project memory](MEMORY_BANK.md) records concise decisions and review lessons.

## Development scaffold

One root monorepo with five workspaces: `contracts` (shared API schemas), `api` (Express server and
worker), `app` (staff dashboard), `web` (public storefront), and `docs` (canonical specifications).
See [scaffold setup and verification](docs/runbooks/scaffold-setup.md).
Each workspace retains `.claude` and `.codex` context, while root rules and the root lockfile govern
the whole change.

## Drezivo second brain

`Drezivo-Second-Brain/` is the project-only Obsidian vault. Start at
[`00-Home/Drezivo Home.md`](Drezivo-Second-Brain/00-Home/Drezivo%20Home.md), then use the Canvas,
Base view, decision register, and [hosting runbook](Drezivo-Second-Brain/05-Operations/Hosting%20the%20Vault.md). The Codex and Claude copies of the upstream
Obsidian skills live under `.codex/skills/obsidian-skills/` and `.claude/skills/obsidian-skills/`.
