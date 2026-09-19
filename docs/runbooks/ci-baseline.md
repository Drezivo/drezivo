# Continuous integration baseline

**Status:** backend-only verification and container delivery are enabled; the full monorepo gate
remains deferred until the application scaffold has a green local gate.

The root `.github/workflows/ci.yml` currently scopes automatic checks to `contracts` and `api`,
because the backend is the requested delivery boundary. It installs from the root lockfile,
builds the shared contracts package, runs API type-checking, linting, unit tests, real-PostgreSQL
integration tests, and the API build. It also builds the backend container on pull requests and
`main` pushes. Version tags publish that image to GitHub Container Registry with the server and
worker entrypoints in one image.

The secrets job also runs the standalone Gitleaks CLI in a read-only container mount, so it does
not require the commercial Gitleaks Action license or an additional repository secret.

This workflow does not deploy to a runtime host. The container host is still a documented decision
point, and production deployment requires the environment-specific approval, migration plan,
readiness checks, rollback plan, and operator ownership described in the deployment runbook.

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
