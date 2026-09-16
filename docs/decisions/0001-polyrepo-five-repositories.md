# 0001. Five repositories, not one monorepo

> **Superseded 16 September 2026.** See [0006. Consolidate the Drezivo workspaces into one
> monorepo](0006-monorepo.md). This file is retained as historical decision context only.

**Status:** Accepted, dated 15 September 2026

## Context

Drezivo ships one product across five deployable/reviewable surfaces: the shared API contract
shapes, the Express business API and worker, the staff/business dashboard, the public
marketing site and tenant storefronts, and this specification repository. The owner chose to
give each surface its own repository (`contracts`, `api`, `app`, `web`, `docs`) rather than a
single monorepo, so that deploy pipelines, ownership, and review scope are separated at the
repository boundary instead of by convention inside one tree.

## Decision

Drezivo runs five repositories:

- `contracts` — `@drezivo/contracts`: Zod schemas and OpenAPI 3.1, published to GitHub
  Packages. Single source of truth for request/response shapes (see ADR 0003).
- `api` — the Express business API and, as a second process entrypoint in the same image, the
  durable worker (see ADR 0004).
- `app` — the Next.js staff/business dashboard.
- `web` — the Next.js marketing site and public tenant storefronts.
- `docs` — this repository: product, architecture, decisions, and runbooks.

Each repository has its own CI, its own branch protection, and its own release cadence. The
cross-repo release order is fixed: `contracts` → `api` → `app` / `web` (see
`docs/runbooks/release.md`).

## Consequences

**Good:**

- Deploy boundaries match repository boundaries — a `web` deploy cannot accidentally ship an
  unreviewed `api` change, and vice versa.
- Ownership and review scope (`CODEOWNERS`) are enforced by GitHub per repository instead of by
  a shared monorepo convention that everyone has to remember to respect.
- Each repository's CI only runs what that repository actually needs (no `web` build blocking
  on `api` test suite health).

**Bad — stated honestly, not hidden:**

- **The API contract is not compiler-enforced across repositories.** In a monorepo, a
  TypeScript type used by both `api` and `app` would fail the build the moment one side
  changed without the other. Across five repositories, that guarantee is gone; a contract
  break can only be caught by whichever repository has picked up the new `@drezivo/contracts`
  version and run its own CI. This is precisely why ADR 0003 exists — the contracts package is
  the compensating control, not a nicety.
- **A cross-cutting change is several PRs in a fixed order, not one PR.** Adding a field to a
  reservation response touches `contracts` first, then `api`, then `app`/`web` — three (or
  four, to remove an old shape later) separate reviews, separate CI runs, and separate merges,
  where a monorepo would let one PR touch all the files at once.
- **There is a window where `main` branches are inconsistent with each other.** Between
  `contracts` publishing a new major version and `api` adopting it, `api`'s `main` is pinned to
  the old contract version on purpose; between `api` shipping and `app`/`web` consuming, the
  dashboard and storefront are calling an API whose contract has already moved. This is a
  designed, temporary inconsistency, not a bug — but it is real, and anyone reasoning about
  "what does `main` do right now" has to know which repository's `main` they mean.

**Mitigations, in place because of the above:**

- The `contracts` package (ADR 0003) is the mechanism that lets the other four repositories
  agree on shape without a compiler spanning repositories.
- The fixed release order (`docs/runbooks/release.md`) makes the inconsistency window bounded
  and predictable instead of accidental.
- The both-shapes-valid migration window (`CONTRIBUTING.md` §6, `docs/runbooks/release.md`) is
  the same expand/contract discipline TRD §9 requires for database migrations, applied to the
  API contract: a breaking change ships in three steps — publish supporting both shapes,
  migrate every consumer, then remove the old shape in a later release — so no repository is
  ever forced to update in lockstep with another.

## Alternatives considered

**Single monorepo** (`apps/web`, `apps/api`, `apps/worker`, `packages/contracts`,
`packages/domain`, `packages/db` — the layout TRD §2 names as a *suggested future* layout, not
the current one). Rejected for V1 because the owner wants separate deploy pipelines and
separate ownership boundaries now, not a shared build graph that would need its own tooling
investment (Turborepo/Nx or similar) to keep CI fast as the repo grows. Revisiting this
tradeoff is reasonable once the team and codebase are large enough that the coordination cost
of five repositories exceeds the isolation benefit; that threshold has not been reached.
