# GitHub `main` ruleset

**Repository:** `Drezivo/drezivo`  
**Branch:** `main`  
**Status:** configuration guidance only; settings have not been verified in GitHub

## Repository visibility

The owner confirmed that `Drezivo/drezivo` is public on 6 October 2026. Earlier notes describing it
as private and recommending a plan upgrade were stale and are removed. GitHub documents environment
secrets, deployment branch restrictions, and required reviewers for public repositories; configure
and verify those settings directly in the repository. See the
[GitHub environments guide](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

The backend verification workflow is enabled. The full monorepo gate remains deferred while the
application scaffold is being brought to a green local gate. See [`ci-baseline.md`](ci-baseline.md).

## Recommended ruleset values

Create a ruleset named `main-protection` in **Settings → Rules → Rulesets**.

| Field                                    | Value                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Enforcement                              | `Evaluate` while testing, then `Active`                                                   |
| Target branches                          | Include `main`; exclude none                                                              |
| Bypass actors                            | Organization owners and one named release bot only; keep the list empty during evaluation |
| Restrict deletions                       | Enabled                                                                                   |
| Block force pushes                       | Enabled                                                                                   |
| Require pull request                     | Enabled                                                                                   |
| Required approvals                       | 1 minimum                                                                                 |
| Dismiss stale approvals                  | Enabled                                                                                   |
| Require code-owner review                | Enabled after `.github/CODEOWNERS` placeholders are replaced                              |
| Require approval of the most recent push | Enabled for the release workflow                                                          |
| Resolve conversations                    | Required                                                                                  |
| Linear history                           | Required when the team uses squash merges                                                 |
| Required status checks                   | Add `verify` only after the CI gate is green and enabled                                  |
| Signed commits                           | Enable when every contributor and automation identity has signing configured              |

Do not add a required status check that does not exist. A missing check blocks every pull request.
Do not give a personal account a permanent bypass. Use a team or a narrowly scoped automation
identity and review that exception quarterly.

## Safe enablement sequence

1. Repair the failures listed in [`ci-baseline.md`](ci-baseline.md).
2. Re-enable the root workflow and confirm a pull request produces the expected `verify` check.
3. Replace every `INSERT-*` value in [`.github/CODEOWNERS`](../../.github/CODEOWNERS) with real
   teams. Open a test pull request that changes `SECURITY-FOUNDATION.template.md` and a legal draft.
4. Create the ruleset in `Evaluate`, test pull requests, then switch to `Active`.
5. Require the ruleset in the repository merge settings and keep direct pushes to `main` disabled.
6. Record the ruleset owner, bypass identities, review date, and a screenshot or exported settings
   record in the private operations vault.

## Verification

An administrator can verify the configuration after the plan is upgraded:

```bash
gh api repos/Drezivo/drezivo/rulesets
gh api repos/Drezivo/drezivo/rulesets/<RULESET_ID>
```

The GitHub API reference is [repository rulesets](https://docs.github.com/en/rest/repos/rules).
The root [license policy](../../LICENSE-POLICY.md) and [CODEOWNERS](../../.github/CODEOWNERS) remain
the source of truth for ownership and review intent.
