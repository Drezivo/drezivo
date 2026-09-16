# Git and delivery workflow — AUTO-LOADED

Full detail for humans is in `CONTRIBUTING.md`. This file is the agent-facing contract.

## Before editing anything

Run `git status` and `git branch --show-current`. If the current branch is `main`, or is
unrelated to the task, create a new branch **before** the first edit:

```bash
git switch -c <type>/<short-kebab-slug>
```

`<type>` is one of: `feat` `fix` `perf` `refactor` `docs` `test` `build` `ci` `chore`.

## Never

- Push to `main`. Not with `--force`, not without. Branch protection will reject it anyway.
- Force-push any branch that has been reviewed or that CI has run against.
- Merge, rebase onto another person's branch, or delete a branch unless explicitly asked.
- Commit any file whose name starts with `.env`, including `.env.example`.
- Commit secrets, tokens, connection strings, or customer personal data — in code, in
  fixtures, in test snapshots, or in a commit message.

## Commit messages — Conventional Commits, enforced by commitlint

```
<type>(<scope>): <subject in imperative, lower case, no full stop, ≤72 chars>

Why this change exists. The diff shows what; the body must say why.
Wrapped at 72 columns.

Refs: TRD §_, Data-Model §_, or issue #
```

Valid scopes: `tenancy` `catalogue` `availability` `reservations` `finance` `storefront`
`files` `billing` `jobs` `audit` `auth` `db` `config` `ui` `deps`.

Breaking change: `!` after the scope **and** a `BREAKING CHANGE:` footer.

## Stop before committing

After making changes, show: a summary, the files changed, the commands run with their real
output, and the diff. **Then stop.** Do not stage, commit, push, or open a PR until the user
explicitly approves.

Only after approval:

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add <specific approved files>      # never `git add -A`
git commit                             # conventional message, per above
git push -u origin <branch>
gh pr create --fill                    # then complete the template
```

The PR title must itself be a valid Conventional Commit line — it becomes the squash commit
on `main`.

## Cross-repo changes

A change that alters the API contract lands in this order, as separate PRs:

1. `contracts` — new version, both old and new shapes valid
2. `api` — implement
3. `app` / `web` — consume
4. `contracts` — remove the old shape, in a later release

Never open step 2 before step 1 has merged and published. Say so in the PR description when
a change is part of a cross-repo sequence.

## Reporting

Report what actually happened. If tests fail, quote the failure. If a step was skipped, say
which and why. Passing output is the start of review, not proof of quality.
