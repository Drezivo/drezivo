# Drezivo team development handbook

**Audience:** the small development team working in this repository  
**Purpose:** make everyday collaboration predictable, reviewable, and safe

This handbook describes how to work together in the Drezivo monorepo. It contains team roles and
working agreements, not personal information. The root `AGENTS.md`, `ROOT-REPOSITORY-ARCHITECTURE.md`,
workspace `AGENTS.md` files, and the technical requirements document remain the source of truth for
technical decisions.

## 1. The team agreement

- `main` is the shared release branch. Work on a short-lived branch and open a pull request.
- Every meaningful change has an issue, a pull request, a reviewer, and recorded validation.
- The author owns the change. The reviewer owns an independent challenge of the change.
- A review is a technical conversation. Questions are welcome; blocking findings must be clear.
- Do not merge with a known failing check. If a check is unavailable or pre-existing, record that
  fact in the pull request and decide explicitly whether the change is safe to merge.
- Never commit secrets, customer data, private security documents, or local environment files.
- Keep the root workspace dependency lockfile authoritative. Do not add a workspace lockfile.
- Update the relevant documentation in the same pull request as the code or product decision.

GitHub describes protected branches as a way to require reviews, status checks, linear history, and
conversation resolution before merging. Until Drezivo can enforce those settings, this handbook is
the team agreement and must be followed manually.

## 2. Repository map

| Workspace | Responsibility | Typical changes |
| --- | --- | --- |
| `contracts` | Shared request, response, error, and OpenAPI shapes | Zod schemas, generated OpenAPI, contract tests |
| `api` | Express API, database access, migrations, and worker | Routes, services, repositories, SQL migrations, API tests |
| `app` | Authenticated staff dashboard | Staff pages, forms, typed API calls, UI tests |
| `web` | Marketing site and public storefront | Public pages, storefront flows, SEO, browser tests |
| `docs` | Product, architecture, legal, decisions, and runbooks | PRD, TRD, ADRs, onboarding, release evidence |

Dependency direction is `contracts -> api -> app/web`. A change that crosses that boundary belongs
in one coordinated pull request when possible.

## 3. Starting work

### Find or create the issue

Before coding, find an existing issue or create one with:

- a short problem statement;
- the expected behavior;
- acceptance criteria written as checkboxes;
- the affected workspace;
- known risks and dependencies.

An issue that only lists files to read is an onboarding checklist, not an implementation task. Turn
each useful item into a checkbox or a separate issue, then link the resulting pull request with
`Closes #<number>` or `Refs #<number>`.

### Create a branch from current `main`

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <type>/<short-kebab-slug>
```

Use the branch type that matches the intended commit:

```text
feat/reservation-exclusive-holds
fix/availability-overlap
docs/tenant-onboarding
chore/dependency-review
refactor/reservation-service
```

Keep the branch focused. If the work grows into a second problem, open another issue and branch.

### Read the local rules

At minimum, read:

1. `README.md`
2. `AI-AGENT-ONBOARDING.md`
3. `ROOT-REPOSITORY-ARCHITECTURE.md`
4. the target workspace `AGENTS.md`, `CLAUDE.md`, and `.codex/rules/`
5. the relevant PRD, TRD section, data model, and accepted decision records

Obtain the private local `SECURITY-FOUNDATION.md` through the approved team channel before
authentication, authorization, tenant, storage, deployment, or incident-response work.

## 4. Commit and push rules

Use Conventional Commits:

```text
<type>(<scope>): <short imperative summary>
```

Examples:

```text
feat(reservations): add exclusive hold command
fix(auth): reject inactive organization membership
docs(runbooks): clarify local development setup
chore(deps): review production dependency update
```

The subject is imperative, lower-case, and concise. Explain the reason in the body when the diff
does not make it obvious. Do not use a commit message to hide unrelated work.

Push normally:

```bash
git push -u origin <branch-name>
```

Before review, rebasing onto the latest `origin/main` is acceptable. After someone has reviewed the
branch, do not force-push it. Merge `origin/main` into the branch when that is the safest way to
preserve the review record.

## 5. Pull request workflow

### Open the pull request

Open against `main`. Use the repository template and include:

- the user or operator problem;
- the resulting behavior;
- linked issue or specification section;
- affected workspaces;
- migration, security, privacy, and operational impact;
- exact commands run and their results;
- known pre-existing failures;
- rollback or follow-up work.

Use a draft pull request while the approach is still being tested. Mark it ready when the scope,
validation, and review context are complete.

### Review protocol

The reviewer should:

1. Read the issue and pull request summary before opening the diff.
2. Review one file at a time and mark files as viewed.
3. Check correctness first, then security and tenant boundaries, then tests, readability, and cost.
4. Leave line-level comments for concrete findings.
5. Classify feedback clearly:
   - **Blocker:** must be fixed before merge.
   - **Question:** clarification needed before approval.
   - **Suggestion:** improvement that can be accepted or declined with context.
   - **Nit:** optional wording or style change.
6. Submit one review decision: comment, approve, or request changes.

The author answers every question, fixes blockers, and resolves conversations. The reviewer checks
the final diff after new commits. A new commit that changes behavior requires another review pass.

### Merge protocol

Merge only when:

- the issue acceptance criteria are met;
- the reviewer has approved the current commit;
- all review conversations are resolved;
- validation is green or any exception is explicitly documented and accepted;
- the pull request is still focused;
- migrations, contracts, and runbooks are included when the change needs them.

Use squash merge for normal work. The pull request title must be a valid Conventional Commit. The
author merges after approval and deletes the branch. Do not merge your own pull request without the
other developer's review, except for a documented emergency fix that is reviewed immediately after.

GitHub's review guidance supports comments, suggestions, approval, and change requests. Use those
states instead of approving informally in chat.

## 6. Validation by change type

Run the smallest complete gate that proves the change, then record the commands in the pull request.

### Documentation-only

```bash
npm run check:docs
```

### Contracts or API

```bash
npm run typecheck --workspace @drezivo/contracts
npm run lint --workspace @drezivo/contracts
npm test --workspace @drezivo/contracts -- --run
npm run typecheck --workspace @drezivo/api
npm run lint --workspace @drezivo/api
npm test --workspace @drezivo/api -- --run
```

### Frontend

Run the affected workspace type-check, lint, and tests. If a command is currently blocked by a
known scaffold defect, report the exact failure and do not describe it as passing.

### Database or tenant changes

Also review the SQL migration, rollback or recovery path, tenant scope, indexes, row-level security,
concurrency behavior, and a double-fire test for every mutation.

### Before opening any pull request

```bash
npm ci
npm run check:docs
git diff --check
git status --short --branch
```

The full root gate is documented in `docs/runbooks/ci-baseline.md`. Automatic verification is
deferred until the scaffold failures are repaired.

## 7. Dependabot policy

Dependabot pull requests are useful, but they are proposed changes. They are not safe to merge only
because a bot opened them. GitHub recommends reviewing the release notes and confirming tests pass
before merging version updates.

### Decision table

| Update | Default action |
| --- | --- |
| Security fix with a safe patch or minor update | Review the advisory, run the affected tests, and merge promptly when green |
| Production major update | Use a dedicated review branch or separate pull request; read migration notes and test every affected workspace |
| Development-only patch or minor update | Merge during the normal dependency review cycle after validation |
| Framework, authentication, database, logger, or schema major update | Treat as planned engineering work, not a routine bot merge |
| Grouped pull request containing several major updates | Do not merge blindly. Split or close it and review compatible upgrade groups separately |

The current open production update pull request changes nine packages across the monorepo. It
includes major upgrades to validation, Clerk integrations, Next.js, logging, and React, along with
a database package update. It is **not ready for blind merge** because the repository does not yet
have a green automated gate and the batch contains several behavior and migration risks.

For that pull request:

1. Read each package's release notes.
2. Check framework and authentication migration guides.
3. Test contracts, API, app, and web separately.
4. Run the root install from a clean checkout and inspect the lockfile diff.
5. Review the production dependency audit after the update.
6. Merge only after a human review. If failures are unrelated, split the update rather than
   disabling the check or merging the whole group.

The development dependency update that already merged should still be verified by the next local
install and test run. Keep the root `package-lock.json` as the only lockfile.

Dependabot can be kept enabled. Its version-update pull requests should remain subject to the same
human review as any other pull request. Security updates receive priority, but urgency does not
remove the need to inspect the diff and test the affected path.

## 8. Handoffs and daily teamwork

When handing work to the other developer, update the issue or pull request with:

- what changed;
- what was tested;
- what is still uncertain;
- the next concrete action;
- any command, fixture, migration, or environment requirement.

Use the issue for durable decisions and the pull request for change-specific discussion. Use chat
for quick coordination, then copy the decision back to the issue or pull request.

If blocked for more than a short working session, write a blocker comment with the attempted steps
and the smallest decision needed. Do not silently change architecture to get around a blocked task.

## 9. Current repository notes

- The repository currently has one open production Dependabot pull request and several merged
  feature and documentation pull requests.
- The open documentation issue that lists required files should be converted into checkable reading
  tasks and linked pull requests.
- The previous security workflow was removed because the repository plan did not support its checks.
  Historical red checks should not be treated as current scan results.
- Branch protection and required status checks are not yet enforceable on the current private-repo
  plan. Follow the manual rules in this handbook until the GitHub settings are enabled.

## 10. Useful references

- [GitHub pull request review quickstart](https://docs.github.com/en/pull-requests/get-started/reviewing-pull-requests-quickstart)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub status checks](https://docs.github.com/en/pull-requests/reference/status-checks)
- [Dependabot version updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates)
- [Managing Dependabot pull requests](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/manage-dependabot-prs)
