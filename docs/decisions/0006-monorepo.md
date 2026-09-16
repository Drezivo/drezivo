# 0006. Consolidate the Drezivo workspaces into one monorepo

**Status:** accepted
**Date:** 16 September 2026
**Supersedes:** [0001. Five repositories, not one monorepo](0001-polyrepo-five-repositories.md)

## Decision

Drezivo uses one Git repository at the workspace root. `contracts`, `api`, `app`, `web`, and
`docs` remain named workspace directories with explicit ownership. The root `package.json` and
`package-lock.json` manage installation and scripts. Root CI, pull requests, CODEOWNERS, licensing,
security checks, and release evidence cover the complete change.

## Why

The product is still at scaffold stage, so the cost of coordinating five histories and release
windows is higher than the isolation benefit. A monorepo lets the compiler and one pull request
expose contract drift across the API and both Next.js clients. It also gives security and legal
controls one review boundary while preserving deployable process boundaries.

## Boundaries that remain

- `contracts` owns shared request and response schemas, enums, money, errors, and OpenAPI.
- `api` owns tenant authorization, domain transactions, Drizzle migrations, and the worker.
- `app` and `web` consume the API and contracts package; neither owns business truth.
- `docs` owns product, architecture, legal, research, runbooks, and accepted decisions.
- A workspace may deploy as its own process, but it does not become a separate Git repository.

## Migration rules

1. The root Git history is authoritative. Do not initialize nested repositories.
2. The former checkout metadata is kept under the ignored `.polyrepo-git-archives/` folder only for
   reference. It is not part of builds, commits, or release commands.
3. Root CI runs affected workspace checks and a complete release gate. Workspace-specific scripts
   remain available through `npm run <script> --workspace <package-name>`.
4. Breaking contract changes use an expand, migrate, contract window. Update consumers and docs in
   the same pull request where feasible.
5. Root `LICENSE.md`, `LICENSE-POLICY.md`, `SECURITY-FOUNDATION.md`, and agent rules govern all
   workspaces. Workspace license files are retained as notices during the transition and must not
   conflict with the root policy.

## Consequences

The repository becomes larger and CI needs affected-workspace filtering. Teams must keep ownership
boundaries clear, avoid broad dependency coupling, and use CODEOWNERS for sensitive paths. The
benefit is a single review, dependency, security, and release boundary with shared type checking.
