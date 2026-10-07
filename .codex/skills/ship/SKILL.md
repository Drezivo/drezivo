---
name: ship
description: Take finished work from the working tree through branch selection, commit, validation, and a reviewed GitHub pull request. Use when the user signals work should be shipped, committed, pushed, or opened as a PR. Do not use for reading history, resolving conflicts, or reviewing code only.
metadata:
  short-description: Ship finished work through a reviewed pull request
---

# Ship

Take finished work and get it onto GitHub as a reviewable pull request:
**branch → commit → local checks → checkpoint → push → remote checks → PR.**

Derive the branch name, commit message, checks, and PR body from the actual diff rather than from memory. Preserve the user's authorization boundaries: committing is local, while pushing and opening a pull request are outward-facing operations that require a final approval checkpoint.

## Step 1 — Read the state before touching anything

Run these together and read the output:

```bash
git status --short --branch
git diff --stat HEAD
git log --oneline -15
git branch --show-current
```

Then read the substantive diff with `git diff HEAD`, or file by file if it is large.

Establish:

- the base branch, using `git symbolic-ref refs/remotes/origin/HEAD` when available, otherwise the repository's `main` or `master` branch;
- the repository's commit and PR conventions from recent history and existing pull requests;
- whether any changed path contains secrets, credentials, `.env` files, `node_modules`, editor droppings, or other files that must not be committed.

If a sensitive or suspicious file is present, stop and report it rather than quietly staging or excluding it.

If the worktree is clean and nothing is staged, there is nothing to ship.

## Step 2 — Pick the branch

Never commit directly to the base branch. If the current branch is the base branch, create a focused branch before committing. Reuse a feature branch when it matches the work; otherwise create a new branch named `<type>/<kebab-slug>`, such as `feat/product-filters` or `fix/cart-total-rounding`.

Uncommitted changes carry across a new branch. Do not discard or stash unrelated user work merely to change branches.

## Step 3 — Commit

Stage only paths belonging to this change. If there are genuinely unrelated changes, keep them out of the commit and mention that separation.

Use a conventional commit whose type and scope match the change. The subject should be imperative, specific, and concise. For substantial changes, include a body explaining what changed, why it matters, and any non-obvious decision. Do not add attribution to Claude, Claude Code, or another AI tool. If a hook adds such a trailer, remove it before continuing.

On Windows, write multi-line commit messages to a temporary file and use `git commit -F <path>` to avoid shell-quoting errors. Verify the committed message with `git log -1 --format=%B`.

## Step 4 — Run the local preflight

For changes that match the backend workflow paths (`api/**`, `contracts/**`, `.github/scripts/**`, root package manifests, or `.github/workflows/ci.yml`), run this command from the repository root:

```bash
npm run validate:backend:local
```

It builds, lints, and tests contracts, then type-checks, lints, unit-tests, and builds the API. It does not run PostgreSQL integration tests or build the container image. Its success is only a local preflight, not full CI verification. For other changes, run the equivalent checks for the affected workspaces.

- If checks pass, record them and continue.
- If a check fails, fix it before shipping unless the failure clearly predates the change; report such a blocker explicitly.
- If a check cannot run because of missing dependencies, credentials, a database, or excessive runtime, report exactly what was skipped and why.

Never imply that a check passed when it was not run.

## Step 5 — Checkpoint before pushing

Before any push or pull-request creation, show the user:

- the branch and whether it is new or reused;
- the full committed message;
- checks that passed, failed, or were skipped;
- the proposed PR title and body;
- any uncertainty or human review needed.

Ask for approval. This is the only required stop before external publication. Treat approval as applying only to the reviewed commit and diff; if the diff materially changes afterward, return to this checkpoint.

## Step 6 — Push, verify remote checks, and open the PR

After approval, push the branch without force-pushing:

```bash
git push -u origin <branch>
```

For a new backend PR, record the pushed commit SHA and look for an existing manual run for that exact branch and commit:

```bash
git rev-parse HEAD
gh run list --workflow ci.yml --branch <branch> --event workflow_dispatch --commit <sha> --limit 1 --json databaseId,status,conclusion,url
```

If a matching run is already in progress, wait for it. If it passed, continue. If it failed or was cancelled, stop and report it; do not silently retry the same commit. If no run exists, dispatch the existing workflow:

```bash
gh workflow run ci.yml --ref <branch>
```

Find the new run for the exact branch and commit, then wait for it to finish:

```bash
gh run list --workflow ci.yml --branch <branch> --event workflow_dispatch --commit <sha> --limit 1 --json databaseId,status,conclusion,url
gh run watch <run-id> --exit-status --compact
```

Open a new PR only after that run succeeds; it includes the PostgreSQL-backed API checks and the separate container build. If dispatch fails, the run fails or is cancelled, or its result cannot be verified, stop before creating the PR and report the run or blocker. The pull-request workflow still runs again and remains authoritative.

After the backend workflow passes, open the PR:

```bash
gh pr create --base <base> --head <branch> --title "<title>" --body-file <path>
```

If a PR already exists for the branch, do not dispatch a duplicate run or create another PR. Push the update and wait for the existing PR checks:

```bash
gh pr checks <number> --watch --fail-fast
```

For changes outside the backend workflow paths, use the normal PR checks for the affected workspaces and create the PR after the approval checkpoint. Use the commit subject as the PR title when there is one. Match the repository's PR template and always format the PR body with these five sections:

### ## Summary

- Bullet-point explanation of what changed and why it matters. Each bullet describes a concrete area of the change.

### ## Codebase areas modified

- Group changes by directory/workspace (e.g., `api/`, `contracts/`, `app/`, `docs/`, `contracts/`).
- Use `[x]` for completed areas and `[ ]` for planned, blocked, or intentionally excluded areas.
- Each item names the directory and the types of files changed (repository, service, controller, middleware, routes, schemas, migrations, tests, documentation, etc.).
- Explicitly mark areas that are intentionally excluded or not modified.

### ## Commits

- List each commit message on its own line, as a bullet point or numbered list.
- Use the actual commit subjects from `git log`.

### ## Verification

- List the exact commands run and their results (e.g., `npm run typecheck`, `npm run build`, `npm run test`, `git diff --check`). If a check was skipped, note why.

### ## Known limitations

- What is deferred, blocked, or known to be incomplete (e.g., missing database credentials, deferred features, pre-existing lint failures).
- Include any intentional exclusions (e.g., frontend changes left local).

Do not include secrets, private URLs, unrelated chatter, or AI attribution.

If GitHub authentication, permissions, remotes, or tooling block publication, preserve the local commit and report the exact completed state and blocker.

## Step 7 — Report

Return the PR URL, branch, commit summary, checks, and any known limitations. Do not claim anything passed or was published unless it was observed.

## Partially completed work

- If the branch is already pushed and has no PR, skip directly to PR creation after the approval checkpoint.
- If a PR is already open for the branch, update it rather than creating a second one.
- If work is already committed and nothing is staged, verify the commit and continue from the appropriate step; do not create a redundant commit.
- If merge conflicts exist, stop and report them. Conflict resolution is a separate task.
