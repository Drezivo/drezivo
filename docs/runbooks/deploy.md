# Deploy

The target topology, per TRD §1's deployment recommendation. Nothing in this document has been
provisioned yet — TRD's own header states "no infrastructure has been provisioned and no
application performance or recovery claim has been tested." This runbook describes the intended
procedure so it exists before the first real deploy, and gets corrected in place once reality
disagrees with it.

## Target topology

| Surface | Host type | Artifacts |
| --- | --- | --- |
| `app` (staff dashboard) | Managed Next.js host (Vercel is a named candidate) | One Next.js build |
| `web` (marketing + storefront) | Managed Next.js host (same candidate) | One Next.js build |
| `api` server | Managed container host | One container image, HTTP server entrypoint |
| worker | Same managed container host | Same container image, worker entrypoint (`docs/decisions/0004-worker-in-api-repository.md`) |
| Database | Supabase PostgreSQL, Data API disabled | N/A — managed |
| Files | Cloudflare R2 (private source/evidence bucket; public derivatives are a later stage) | N/A — managed |

DECISION NEEDED: confirm the specific managed container host and finalize the Next.js host
selection (TRD §1 names Vercel as "a candidate," not a decision). Confirm region compatibility
and pricing before selecting paid plans — TRD §1: "Prefer API, worker, database, and private
storage in a nearby compatible region such as Singapore if all chosen services support the
required configuration. Measure latency from Philippine mobile networks; geographical proximity
is not a benchmark." Do not assume Singapore is confirmed without that measurement. R2's provider
selection is recorded in [ADR 0010](../decisions/0010-cloudflare-r2-object-storage.md), but no
production bucket, credential, object migration, or cutover is declared complete by this runbook.

The API and worker deploy as ordinary PostgreSQL clients. They do not use Supabase Auth, Storage,
Realtime, REST, GraphQL, or service-role keys. Before the first application deploy, apply migrations
through `DATABASE_URL_DIRECT`, assign deployment-managed passwords to `drezivo_app` and
`drezivo_worker`, and verify each process connects with only its own restricted role.

## Before every deploy

- The monorepo release sequence was followed (`docs/runbooks/release.md`) — do not deploy
  `api` against a `@drezivo/contracts` version that has not actually published, and do not
  deploy `app`/`web` against an `api` version that has not actually gone live.
- **A deploy never runs a destructive migration.** If the release includes a schema change,
  confirm it followed `docs/runbooks/migrations.md`'s expand/backfill/validate/switch/contract
  procedure and that the migration step deploying now is additive/backward-compatible with the
  currently-running application version. A deploy that pairs a code release with a
  simultaneously-destructive migration removes your ability to roll the code back without also
  reversing the migration — which TRD §9 explicitly says not to assume is safe ("do not assume
  an application rollback reverses a data migration safely").
- Confirm which environment you are deploying to and that its secrets are the environment's own
  (`docs/runbooks/environments.md`) — never a value copied from another environment "to save
  time."

## `api` server and worker deploy

1. Build the container image once from the release commit; it contains both entrypoints.
2. Deploy the **worker** first if the release changes shared domain logic that the worker
   depends on and the API does not yet need updated — in general, prefer deploying worker and
   server close together since they share one image and one release, but do not assume a fixed
   sub-order matters more than the readiness checks below actually passing.
3. **Readiness checks**: the new server instance must pass its readiness check (confirms
   database connectivity, confirms required environment variables are present and the process
   would otherwise fail closed at startup per `CONTRIBUTING.md` §7) before it receives traffic.
   Do not route traffic to an instance that has only passed a liveness check — liveness means
   "the process is running," readiness means "the process can actually serve a request
   correctly right now."
4. **Two API instances where required to meet the availability target** (TRD §1) — deploy as a
   rolling update: bring up new instances, wait for readiness, shift traffic, then drain and
   terminate old instances. Never terminate the last old instance until at least one new
   instance is confirmed ready.
5. **Graceful shutdown and connection draining**: on receiving a shutdown signal, the server
   stops accepting new connections, finishes in-flight requests up to a bounded timeout, closes
   its database pool cleanly, and only then exits. An abrupt kill mid-request risks leaving a
   transaction open past its intended boundary. DECISION NEEDED: confirm the exact shutdown
   grace period once the container host is selected — it has to be longer than the platform's
   own default kill timeout, or draining does not actually finish before the process is force-
   killed.
6. **Worker shutdown**: the worker's in-flight lease-claimed jobs are safe to interrupt — TRD §8
   says a crashed worker's lease expires and is reclaimed — but a graceful worker shutdown
   should still stop claiming new work and let in-flight work either finish or fail its lease
   naturally, rather than being killed mid-write.
7. Confirm the deployed version is serving the expected contract version (see
   `docs/runbooks/release.md`) before considering the deploy complete.

## `app` / `web` deploy

1. Managed Next.js host handles build and atomic cutover; confirm the platform's own readiness
   gate (build succeeded, no runtime error on the health/index route) before treating the deploy
   as live.
2. Confirm `API_BASE_URL` and Clerk keys (`app` only) point at the correct environment
   (`docs/runbooks/environments.md`) — a staging `app` build accidentally pointed at production
   `API_BASE_URL` is a tenant-isolation and data-safety incident, not a cosmetic bug.
3. No database connection exists from these surfaces (TRD §1: "The browser never receives a
   database connection string ... Next.js server rendering calls the API through scoped
   service/request adapters") — there is no connection-draining concern here beyond ordinary
   in-flight HTTP requests, which the managed host's own rolling deploy handles.

## After every deploy

- Watch the signals in `docs/runbooks/oncall-checklist.md` for an elevated window (latency,
  error rate, pool wait) before considering the deploy fully settled.
- If anything looks wrong, see `docs/runbooks/rollback.md` — do not attempt an ad hoc fix live
  in production as the first response.
