# Drezivo AI Agent Onboarding

This is the machine-facing first-read protocol for any Codex, Claude, or other coding agent entering
the Drezivo workspace. Agents follow this file, `AGENTS.md`, and
`ROOT-REPOSITORY-ARCHITECTURE.md`; the DOCX is a separate human orientation manual and is not an
agent authority.

## 1. Establish context before editing

1. Read this file, [`AGENTS.md`](AGENTS.md), [`ROOT-REPOSITORY-ARCHITECTURE.md`](ROOT-REPOSITORY-ARCHITECTURE.md), and `SECURITY-FOUNDATION.template.md`. If the private local `SECURITY-FOUNDATION.md` is present, read it too. The private guide is required before authentication, authorization, data, storage, or deployment decisions.
2. Identify the owning workspace: `contracts`, `api`, `app`, `web`, or `docs`.
3. Read that workspace's `AGENTS.md`, `CLAUDE.md`, `.codex/rules/`, and `README.md`.
4. Inspect `git status --short --branch`; preserve unrelated user changes.
5. Read the relevant canonical PRD/TRD/data-model/ADR before proposing implementation.
6. State a short plan, files, validation, and falsification checks before editing.

## 2. Ownership and dependency direction

```text
contracts  →  api  →  app/web
    └──────────────→ shared request/response and error shapes
docs       → defines intent, decisions, runbooks, and evidence for all of them
```

- `contracts` owns versioned Zod schemas, enums, money/error serialization, and OpenAPI. It has
  no database, provider credentials, or authorization authority.
- `api` owns Clerk verification, tenant/branch/role authorization, business transitions, Drizzle
  queries, reviewed SQL migrations, and the lease-based worker.
- `app` owns authenticated staff journeys and `web` owns marketing, public storefront, and guest
  booking. Both use the exact contracts package and API; neither owns authoritative state.
- `docs` owns the narrative and operations. Update it when behavior, data, deployment, or a
  decision changes.

## 3. Boundary rules that must hold

- Validate untrusted input at the boundary with the shared schema; reject unknown enum/state/route.
- Authorize every API route on the server using verified identity plus tenant/branch membership.
- Recompute prices, quantities, totals, and policy snapshots on the server.
- Every mutation has a UI pending/disabled state and early-return guard while in flight.
- Every mutation is duplicate-safe through an idempotency key, conditional transition, unique
  constraint, or central posting layer. Test sequential and concurrent double-fire.
- Side effects that must survive a crash go through the outbox/queue with lease, bounded retry,
  and terminal failure state. Never use fire-and-forget work.
- Never log or return secrets, tokens, payment evidence, or personally identifiable information.
- Keep Clerk secret keys, Supabase database URLs, S3 credentials, and environment values out of Git and the
  Obsidian vault.

## 4. How to trace a feature

For a new or changed capability, follow this order:

1. **Contract:** request, response, error, enum, money, and OpenAPI compatibility.
2. **API:** route → middleware → schema → authz/tenant context → module → repository → transaction.
3. **Database:** Drizzle schema plus a reviewed, ordered SQL migration and invariant tests.
4. **Worker:** outbox event, lease claim, retry policy, handler, and terminal outcome if asynchronous.
5. **Consumer:** `app` or `web` API client, page/component, pending/error/empty states, and tests.
6. **Docs:** PRD/TRD/data model/ADR/runbook and a durable Obsidian note with source/date.

For `api/src/modules/storefront`, the split is intentional: `*.schemas.ts` validates input,
`*.dto.ts` describes transport payloads, `*.repository.ts` owns scoped Drizzle queries, and
`*.routes.ts` composes HTTP middleware and responses. Tests prove the boundary as the module grows.

## 5. Validation and delivery

Run the owning workspace's typecheck, lint, tests, and build. Add integration/e2e checks when a
boundary or workflow changes. Inspect the diff and search for stale product names or secrets.
Use branches named `<type>/<short-kebab-slug>` and Conventional Commits such as
`feat(api): add storefront availability` or `fix(web): guard duplicate hold submission`.

Do not merge, deploy, change GitHub settings, create remotes, or publish packages without explicit
authorization. A green scaffold build is evidence of compilation only; it is not proof of Supabase PostgreSQL
isolation, production recovery, payment correctness, or availability concurrency.

## 6. Shared Obsidian second brain

Open `docs/second-brain/` as a project-only Obsidian vault and begin at
`00-Home/Drezivo Home.md`. Use vault-relative wikilinks, YAML properties, source/date fields, and
the numbered folders. Update the Canvas only when relationships change and keep node IDs stable.
Use private Obsidian Sync or a private Git repository; never sync credentials, customer PII,
payment evidence, or production exports. The vault is a linked memory layer, not an authority over
code, migrations, PRD/TRD, or accepted ADRs.

## 7. Finish the turn

Report changed files, tests and command output, known limitations, and any follow-up that needs
human authorization. Leave the workspace reproducible for the next agent; add durable lessons to
the appropriate memory/lessons file when a mistake or non-obvious constraint was discovered.
