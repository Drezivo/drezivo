# Runbooks

Operational procedures for running Drezivo — written for an on-call engineer at 2am who did not
write the system. Concrete steps and real commands where they are knowable; a
`DECISION NEEDED:` line where a value has not actually been decided yet, rather than an invented
default.

## The rule

**A runbook is updated in a linked PR shipped with the change it describes.** If a PR changes a deploy
step, a migration procedure, an environment variable, an alert threshold, or a rollback path,
the corresponding runbook file changes in that same PR — not in a follow-up "update docs" PR
that may or may not happen. A runbook that is out of sync with the system it describes is worse
than no runbook, because it is trusted at exactly the moment (an incident) when trust matters
most.

Reviewers: treat a runbook-affecting change with no runbook update as an incomplete PR, the same
way a contract-affecting change with no `@drezivo/contracts` PR is incomplete
(`docs/decisions/0006-monorepo.md`).

## Contents

| File | Use when |
| --- | --- |
| `environments.md` | You need to know what an environment variable is for, or which environment (dev/staging/production) you're touching. |
| `release.md` | You're cutting a release of `contracts`, `api`, `app`, or `web`. |
| `deploy.md` | You're deploying, or a deploy just failed, or you need to know what "graceful shutdown" means for a given surface. |
| `migrations.md` | You're running or reviewing a database migration. |
| `rollback.md` | Something shipped broken and you need to undo it. |
| `incident.md` | Something is actively broken in production right now. |
| `oncall-checklist.md` | You're starting an on-call shift, or a dashboard signal fired and you don't know what it means. |
| `security-incident.md` | A credential leaked. |
| `ci-baseline.md` | You are deciding when the root verification workflow is safe to enable. |
| `github-ruleset.md` | You are configuring or reviewing protection for the root `main` branch. |
| `security-automation.md` | You are deciding when GitHub secret scanning or dependency review can be enabled. |

Start with `incident.md` if you are not sure which one applies and something is on fire.

## Source priority

Per `docs/AGENTS.md`, the TRD is the technical source of truth these runbooks implement. Where
a runbook and the TRD disagree, that is a bug in the runbook — file it, do not silently follow
the runbook. Where a runbook states a value the TRD leaves open, the runbook is a proposal until
someone with the authority to decide it says otherwise; such values are marked
`DECISION NEEDED:` until they are confirmed, at which point the marker is removed and the
decision is dated the way TRD §1's "Decided" line is dated.
