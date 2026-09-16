# Continuous integration baseline

**Status:** deferred until the application scaffold has a green local gate.

The repository does not currently enable an automatic verification workflow. The previous
workflow called `npm ci` against stale workspace tarball metadata and then reached known scaffold
type-check failures. Leaving that workflow active would report noise instead of protecting the
main branch, so it was removed until the gate is truthful.

## Enablement gate

Before adding `.github/workflows/ci.yml` again, run these commands from the root and fix every
failure:

```bash
npm ci
npm run check:docs
npm run typecheck
npm run lint
npm run test
```

The workflow should then use Node 22, the root `package-lock.json`, and the same commands. Add
workspace filtering only after the complete gate is green. Required checks and branch protection
should be configured in GitHub in the same change that enables the workflow.

## Current local evidence

- Root dependency installation passes `npm ci --ignore-scripts --dry-run`.
- Documentation lint and local-link checks pass.
- Contracts, API, and app tests pass locally.
- The app type-check and the web test setup still contain scaffold failures. The web lint passes,
  but its test command requires the missing `@tailwindcss/postcss` dependency to be resolved.

Until those items are fixed, release reviews use the local evidence above and must call out the
remaining failures in the pull request.
