# Continuous integration baseline

**Status:** backend-only verification and container delivery are enabled; the full monorepo gate
remains deferred until the application scaffold has a green local gate.

The root `.github/workflows/ci.yml` currently scopes automatic checks to `contracts` and `api`,
because the backend is the requested delivery boundary. It installs from the root lockfile,
builds the shared contracts package, runs API type-checking, linting, unit tests, real-PostgreSQL
integration tests, and the API build. It also builds the backend container on pull requests and
`main` pushes. Version tags publish that image to GitHub Container Registry with the server and
worker entrypoints in one image.

The secrets job also runs Gitleaks. Repositories owned by a GitHub organization must provide the
`GITLEAKS_LICENSE` repository secret required by that action.

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

- The root dependency installation dry-run passes. A full local reinstall was blocked by an
  in-use native `lightningcss` file in the existing `node_modules` tree.
- Before that failed reinstall, contracts tests passed locally: 52 tests, API type-checking passed,
  and API unit tests passed: 56 tests.
- Before that reinstall, API linting reported 18 pre-existing errors and one warning.
- Before that reinstall, contracts type-checking reported existing Node type and Zod/OpenAPI
  typing failures, and contracts build hit an existing local `tsup`/TypeScript runtime mismatch.
- A clean Linux Node 22 container install now completes after the lockfile gains the required
  Linux optional binaries. The contracts declaration build still fails in `tsup` with the
  existing TypeScript 7 dependency, so container publication remains blocked until that
  dependency compatibility issue is reviewed.
- The failed reinstall left the ignored local `node_modules` incomplete, so follow-up local checks
  cannot currently resolve `tsc`, ESLint, or Vitest.
- API integration tests require a disposable PostgreSQL instance; Docker Compose is not available
  in the current local Docker installation.

Until the remaining failures are fixed, release reviews use the local evidence above and must call
out the failures in the pull request.
