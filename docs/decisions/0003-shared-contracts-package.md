# 0003. `@drezivo/contracts` as the single source of truth for request/response shapes

**Status:** Accepted, dated 15 September 2026
> **Monorepo update 16 September 2026.** This decision remains active for the `contracts`
> workspace, but its historical polyrepo rationale is superseded by ADR 0006. The workspace is
> still the single schema authority for API boundaries and external consumers.

## Context

Drezivo's API contract lives in TRD §4. Because `api`, `app`, and `web` are separate
repositories (ADR 0001), no compiler spans them — a TypeScript type change in `api` cannot fail
`app`'s build the way it would inside a single monorepo. TRD §1 records the boundary-validation
decision: "Zod + OpenAPI 3.1, published as `@drezivo/contracts`" is the mechanism that keeps
three repositories agreeing on shape, because "the contract is a versioned package rather than
a shared folder — it is the only mechanism that keeps three repositories agreeing." TRD §4 adds
that runtime input validation is mandatory regardless: "TypeScript alone cannot validate HTTP
input."

## Decision

`@drezivo/contracts` is the single source of truth for every request and response shape
crossing an HTTP boundary in the system:

- **Zod schemas** define the runtime-validated shape of every request body, query, and
  response payload. `api` validates inbound requests against these schemas at the boundary
  (fail closed on unknown fields and unrecognized enum values, per TRD §4 and the
  idempotency-concurrency rule). `app` and `web` validate what they receive from `api` and get
  generated TypeScript types from the same schemas for compile-time safety on the client side.
- **OpenAPI 3.1** is generated from (or kept in lockstep with) the same Zod schemas, so the
  contract is documented in a standard, tool-consumable format before frontend integration
  begins (TRD §4: "Define OpenAPI before frontend integration").
- The package is **published to GitHub Packages**, versioned with semantic versioning. A
  breaking change bumps the major version and is called out with `BREAKING CHANGE:` in the
  publishing commit (`CONTRIBUTING.md` §2).
- `api`, `app`, and `web` each depend on a pinned version of `@drezivo/contracts`. Upgrading is
  an explicit dependency bump reviewed like any other change, not an implicit "whatever is
  latest at build time."

## Consequences

**Good:**

- One definition of "what a reservation response looks like" exists in the system. `api` cannot
  silently drift from what `app`/`web` expect without a version bump making that drift visible
  as a dependency change.
- Runtime validation and compile-time types come from the same schema, so they cannot disagree
  with each other the way a hand-maintained OpenAPI doc and a hand-maintained TypeScript
  interface could.
- A contract change is reviewable on its own, before any consuming repository has to change —
  reviewers can assess a shape change in isolation from its implementation.

**Bad:**

- Every contract change is an extra publish-and-bump step before implementation can start,
  which is slower than editing a type in the same PR as the code that uses it (the monorepo
  alternative). This cost is accepted deliberately — see ADR 0001.
- `api`, `app`, and `web` can each be pinned to a different `@drezivo/contracts` version at any
  given time; "what does the contract say right now" depends on which repository and which
  deployed version you mean, not a single answer. The both-shapes-valid migration window
  (`docs/runbooks/release.md`) exists specifically to keep that window short and safe rather
  than pretending it does not exist.
- A change that looks purely internal to `api` (e.g., renaming an internal field that happens
  to also appear in a response) still has to go through the contracts package if that field
  crosses the HTTP boundary — it is easy to forget this the first few times.

## Alternatives considered

**Hand-written types per repository** — each of `api`, `app`, and `web` independently defines
its own TypeScript interfaces for request/response shapes, matched by convention and manual
review. Rejected: this is exactly the failure mode `@drezivo/contracts` exists to prevent.
Hand-written types drift silently — a field rename in `api`'s internal type does not fail
`app`'s build, because `app`'s type is a separate, unrelated declaration that happens to look
the same today. The drift is discovered in the browser, at runtime, by a user or a support
ticket, rather than in CI before merge. Given TRD §4's explicit requirement that money fields
serialize as decimal strings (see ADR 0005) and that unknown fields/enum values are rejected
at the boundary, a silent shape mismatch is not a cosmetic bug — it is a money-correctness or
availability-correctness bug waiting to happen.

**A shared internal npm workspace inside a monorepo** — would solve the same problem more
cheaply if the five-repository boundary did not exist. Not applicable under ADR 0001's current
decision; revisit only if that decision is revisited.
