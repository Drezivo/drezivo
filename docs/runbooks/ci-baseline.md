# Continuous integration baseline

**Status:** backend-only verification, container delivery, and protected migration runs are
enabled; the full monorepo gate remains deferred until the application scaffold has a green local
gate.

The root `.github/workflows/ci.yml` currently scopes automatic checks to `contracts` and `api`,
because the backend is the requested delivery boundary. It installs from the root lockfile and
uses the shared backend validation command for contracts build/lint/tests plus API type-check,
lint, unit tests, PostgreSQL integration tests, and build. It also builds the backend container on
pull requests and `main`/`staging` pushes. Version tags publish that image to GitHub Container
Registry with the server and worker entrypoints in one image.

The secrets job also runs the standalone Gitleaks CLI in a read-only container mount, so it does
not require the commercial Gitleaks Action license or an additional repository secret.

## Backend pre-PR validation

Run the fast local backend preflight from the repository root before shipping backend changes:

```bash
npm run validate:backend:local
```

This builds, lints, and tests contracts, then type-checks, lints, unit-tests, and builds the API.
It does not run PostgreSQL integration tests or build the container image, so it is not a full CI
pass. The full backend validation sequence is `npm run validate:backend:ci`; it also runs the
integration suite and requires `TEST_DATABASE_URL` to point to a disposable localhost database
whose name contains `test`.

Before opening a new PR for paths that trigger the backend workflow (`api/**`, `contracts/**`,
`.github/scripts/**`, root package manifests, or `.github/workflows/ci.yml`), push the approved branch,
dispatch the existing workflow against that branch, and wait for its exact commit to pass:

```bash
gh workflow run ci.yml --ref <branch>
gh run list --workflow ci.yml --branch <branch> --event workflow_dispatch --commit <sha> --limit 1 --json databaseId,status,conclusion,url
gh run watch <run-id> --exit-status --compact
```

The dispatched workflow runs PostgreSQL integration tests and the separate container build. Do not
open the PR if the run fails, is cancelled, or cannot be verified. The normal pull-request workflow
still runs after creation and remains the authoritative check. For an existing PR, push the update
and wait for its normal checks rather than dispatching another run.

This workflow does not deploy to a runtime host. The container host is still a documented decision
point, and production deployment requires the environment-specific approval, migration plan,
readiness checks, rollback plan, and operator ownership described in the deployment runbook.

## Protected migration runs

Migration files are applied only after backend checks and the container build pass. A push to
`staging` runs the protected staging migration job, which uses the `staging` GitHub environment and
its `MIGRATION_DATABASE_URL` secret. A push to `main` runs the existing preview job,
then the approved production job. Staging and preview jobs share a non-cancelling concurrency group
because they may point at the same preview database.

Both jobs check the Drezivo `schema_migrations` ledger, reject gaps or unknown files, apply pending
files through `npm run db:migrate`, and verify that no files remain pending. The migration secret
may contain the direct URL or shared Session-pooler URL; the latter is the IPv4-compatible choice
for GitHub-hosted runners. Manual dispatch defaults to status-only; choose apply explicitly after
reviewing pending files. Pushes that change migrations keep the existing apply behavior. The
staging job refuses to continue if its commit is no longer the current `staging` branch head.
Configure the `staging` environment with the intended database URL and restrict it to the `staging`
branch. Pull requests never receive migration secrets.

## Full-gate enablement

Before enabling the full monorepo workflow, run these commands from the root and fix every failure:

```bash
npm ci
npm run check:docs
npm run typecheck
npm run lint
npm run test
```

That workflow should use Node 22 and the root `package-lock.json`. Required checks and branch
protection should be configured in GitHub in the same change that enables the full gate. The
backend workflow does not claim that frontend or documentation checks pass.

## Current local evidence

- The root dependency installation dry-run passes.
- Backend verification passes locally: contracts build, contracts lint, 52 contracts tests, API
  type-checking, API lint, API build, and 56 API unit tests.
- API integration tests pass: 10 files and 60 tests, using the same PostgreSQL 17.11 image and
  test environment variables configured by the GitHub workflow. Docker Compose is unavailable
  locally, so the disposable service was started with `docker run`.
- The complete Linux Node 22 backend container build passes, including clean `npm ci`, contracts
  JavaScript/declaration output, API output, production pruning, and runtime image assembly. The
  lockfile includes the Linux optional binaries required by Rollup and esbuild.
- The separate contracts type-check still reports existing Node type and Zod/OpenAPI typing
  failures in `openapi/generate.ts`; it is outside the backend workflow until that scaffold
  tooling is reconciled.
- A clean dependency install reports 9 audit findings (5 moderate, 4 high); production-pruned
  container dependencies report 3 (1 moderate, 2 high). Dependency remediation requires a
  separate review because available fixes include breaking upgrades.

The backend workflow is now locally green. The full monorepo gate remains deferred until the
application scaffold and contracts OpenAPI type-check are green.
