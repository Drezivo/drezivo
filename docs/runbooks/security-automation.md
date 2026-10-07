# GitHub security automation

**Status:** backend secret hygiene and Gitleaks scanning run in the root CI workflow. Dependency
review configuration remains separate and must be verified before it is treated as a required
check.

## Repository visibility and current checks

The owner confirmed that `Drezivo/drezivo` is public on 6 October 2026. Earlier guidance that called
it private and attributed the workflow failure to private-repository licensing is stale.

The root `.github/workflows/ci.yml` runs a standalone Gitleaks CLI in a read-only container mount
and rejects tracked `.env` files. It does not use the commercial Gitleaks Action or require its
license. Dependency Review is not part of that workflow; verify the dependency graph and the
repository's current GitHub plan before enabling it.

GitHub documents deployment environments, environment secrets, and required reviewers for public
repositories in its [environment guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
The migration pipeline's environment setup is documented in [`migrations.md`](migrations.md).

## Dependency Review enablement gate

1. Confirm the current repository settings and plan support each additional check being considered.
2. Enable the dependency graph and GitHub Advanced Security where required.
3. Add Dependency Review only after its repository prerequisites are enabled; test it on a clean
   pull request and a controlled vulnerable dependency fixture.
4. Add only checks that pass on a clean pull request. Record the workflow name and required check
   context in [`github-ruleset.md`](github-ruleset.md).

Until this gate is complete, use local dependency review and secret scanning during development,
keep credentials out of Git, and treat the security foundation as a design baseline rather than a
scan result.
