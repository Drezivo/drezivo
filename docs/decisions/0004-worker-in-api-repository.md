# 0004. The durable worker lives in the `api` repository, not its own repository

**Status:** Accepted, dated 15 September 2026

## Context

TRD §1 specifies "one Express business API, divided internally by domain, with a separately
running durable worker using the same domain services." TRD §8 describes what the worker does:
claims due outbox rows using a row lock/`SKIP LOCKED`, persists a lease token and deadline,
processes reminders and notification delivery, and reclaims work from a crashed worker's
expired lease. TRD §2 states domain modules "call domain services, not another module's private
database helpers," and lists `Notifications/jobs` as a domain module in its own right, owning
"Outbox, leases, reminders and delivery outcomes."

The worker is not a generic task runner — it re-executes the same domain logic the API uses for
things like rechecking a reservation's version before sending a stale reminder (TRD §8: "
Reminders recheck the reservation version before sending so a reschedule does not send obsolete
pickup details").

## Decision

The durable worker is a **second process entrypoint inside the `api` repository**, not a
separate repository or service. Both entrypoints — the HTTP API server and the worker — import
and depend on the same domain service layer, the same Drizzle schema and migrations, and the
same `@drezivo/contracts`-validated types where relevant.

`api` produces **two deploy artifacts from one image**: the HTTP server process and the worker
process, per TRD §1's deployment recommendation ("a managed container host for Express and the
worker"). They are deployed, scaled, and restarted independently, but they are built from the
same codebase and the same release.

## Consequences

**Good:**

- The worker cannot drift from the domain rules the API enforces, because it is not
  reimplementing them — it calls the same domain services. A rule change (e.g., a new
  reservation state transition guard) lands once and both entrypoints pick it up.
- One dependency graph, one migration history, one test suite covers both entrypoints. There is
  no second repository to keep in version lockstep with `api`'s domain layer the way
  `app`/`web` must stay in lockstep with `@drezivo/contracts`.
- TRD §8's requirement that a crashed worker's lease expires and is safely reclaimed, and TRD
  §11's adversarial test 3 ("worker stops for an hour; holds are still safely reclaimed by
  transactions"), are easier to reason about when the worker shares the same transaction and
  locking code paths as the API rather than a parallel reimplementation.

**Bad:**

- **`api` produces two deploy artifacts from one image**, which means a release of `api`
  potentially changes both the request-serving process and the background-job process at the
  same time, even when only one of them actually changed behavior. The release runbook
  (`docs/runbooks/release.md`) and the deploy runbook (`docs/runbooks/deploy.md`) both have to
  account for restarting/redeploying two processes per `api` release, not one.
- A bug introduced into a shared domain service affects both the API and the worker
  simultaneously — there is no isolation boundary between them the way a separate repository
  and separate dependency version would provide. A regression in, say, the finance posting
  layer is live in both request handling and background reconciliation at once.
- `api`'s CI and build pipeline is more complex than a single-artifact repository: it has to
  build, test, and produce two distinct runnable outputs (server entrypoint, worker
  entrypoint) from one `npm run build`, and the deploy pipeline has to know how to roll out
  each independently (see `docs/runbooks/deploy.md`).

## Alternatives considered

**Worker as its own repository (`apps/worker`)** — TRD §2 names this as a *suggested future*
layout (`apps/web`, `apps/api`, `apps/worker`, ...), explicitly marked "a recommendation; no
application scaffolding is created in this task." Rejected for the current decision because
TRD §1 requires the worker to "use the same domain services" as the API — splitting it into its
own repository would recreate the exact problem ADR 0003 solves for `api`/`app`/`web`, but for
internal domain logic instead of an HTTP contract, without a comparable versioned-package
mechanism to keep the two in sync. If the domain layer is ever extracted into its own published
internal package with the same discipline as `@drezivo/contracts`, revisiting this decision
becomes reasonable — not before.

**Worker as a separate always-on service calling `api` over HTTP** — rejected: this would force
domain operations (that need a transaction spanning availability + finance + outbox writes) to
go through a network hop and a second authorization/validation layer, contradicting TRD §2's
requirement that "all mutations capable of changing capacity or money use a shared transaction
context." A transaction context cannot span two processes over HTTP.
