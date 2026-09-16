# GitHub security automation

**Status:** deferred until the repository plan and credentials support the selected checks.

## Why the workflow was removed

The previous pull-request workflow failed for repository configuration reasons on every run:

- Gitleaks Action v3 requires a `GITLEAKS_LICENSE` secret for organization repositories.
- Dependency Review requires the dependency graph and GitHub Advanced Security, which are not
  enabled for this private repository.

These failures do not indicate a detected secret or a vulnerable pull request. Keeping the jobs
active would make a red check mean configuration failure instead of a security result.

## Re-enable gate

1. Confirm the organization plan supports private-repository rulesets, dependency review, and the
   selected secret-scanning approach.
2. Enable the dependency graph and GitHub Advanced Security where required.
3. Purchase or otherwise obtain the Gitleaks license, then store it as the repository or
   organization secret `GITLEAKS_LICENSE`. Never commit the license value.
4. Test the workflow on a branch containing a known safe fixture and a separate controlled test
   secret. Confirm both outcomes before requiring the checks in `main` protection.
5. Add only checks that pass on a clean pull request. Record the workflow name and required check
   context in [`github-ruleset.md`](github-ruleset.md).

Until this gate is complete, use local dependency review and secret scanning during development,
keep credentials out of Git, and treat the security foundation as a design baseline rather than a
scan result.
