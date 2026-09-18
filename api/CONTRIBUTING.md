# Contributing to `api`

Contract releases use `@drezivo/contracts`; publication is a manually approved workflow dispatch
after the exact version tag, with reviewers configured on the release environment.

Drezivo is one monorepo with five workspaces that ship one product. The rules below are identical in every
one of them so that a person or an agent moving between workspaces never has to re-learn the
workflow. Repo-specific detail sits in the marked sections at the bottom.

Workspaces: `contracts` (API shapes) · `api` (Express + worker) · `app` (business
dashboard) · `web` (public site + storefront) · `docs` (specs, runbooks).

---

## 1. Branching model

Trunk-based. `main` is always deployable. Branches are short-lived — open one, ship it,
delete it. A branch older than five days is a merge conflict waiting to happen.

```
main ──●──────●──────────●──────────●───▶  always deployable, protected
        \    /            \        /
         ●──●              ●──●──●          feat/…  fix/…  (1–5 days, squash-merged)
```

### Branch names

`<type>/<short-kebab-slug>` — the type must match the Conventional Commit type below.

```
feat/reservation-exclusive-holds
fix/availability-overlap-off-by-one
chore/bump-node-22
docs/monorepo-alignment
refactor/finance-posting-service
```

Rules:
- Never commit directly to `main`. Branch protection enforces this; do not request an exemption.
- Never force-push a branch someone else has reviewed or that CI has run against. Push a new
  commit instead — the review history is evidence.
- Never force-push `main`, ever, under any circumstance.
- Rebase your own branch onto `main` to stay current; do not merge `main` into your branch
  repeatedly, it makes the diff unreadable.
- Delete the branch after merge. GitHub is configured to do this automatically.

---

## 2. Commit messages — Conventional Commits 1.0.0

Enforced by `commitlint` in a `commit-msg` hook and again in CI. A commit that does not parse
is rejected before it reaches review.

```
<type>(<scope>): <subject>

<body — WHY, wrapped at 72 columns>

<footer — BREAKING CHANGE / Refs>
```

### Types

| Type | Use for | Triggers a release? |
|---|---|---|
| `feat` | A new capability a user or caller can observe | minor |
| `fix` | A defect repaired | patch |
| `perf` | Faster or cheaper, same behaviour | patch |
| `refactor` | Internal change, no behaviour change | no |
| `docs` | Documentation only | no |
| `test` | Tests only | no |
| `build` | Build system, dependencies, Dockerfile | no |
| `ci` | Workflow and pipeline changes | no |
| `chore` | Housekeeping that fits nothing above | no |
| `revert` | Reverts a previous commit; footer names the SHA | patch |

### Scopes

Use the module the change belongs to, from TRD §2. Keep the vocabulary stable across workspaces:

`tenancy` · `catalogue` · `availability` · `reservations` · `finance` · `storefront` ·
`files` · `billing` · `jobs` · `audit` · `auth` · `db` · `config` · `ui` · `deps`

Omit the scope only when the change is genuinely repo-wide.

### Subject line

- Imperative mood: "add", not "added" or "adds".
- No capital letter at the start, no full stop at the end.
- 72 characters maximum.
- Describe the effect, not the file you touched. `fix(availability): reject overlapping hold
  on same asset` beats `fix: update service file`.

### Body

Explain **why**. The diff already shows what. A reviewer reading this in eight months needs
the reason, the alternative you rejected, and anything non-obvious about the approach.

### Breaking changes

A `!` after the scope **and** a `BREAKING CHANGE:` footer. Both. In `contracts` this drives
the major version bump, and `api`, `app` and `web` cannot upgrade until they adapt.

```
feat(reservations)!: return total_amount as decimal string

Number-typed money silently loses precision above 2^53 minor units.
TRD §4 requires minor units serialized as decimal strings.

BREAKING CHANGE: reservation.total changes from number to string.
Consumers must parse with a decimal library, not parseFloat.
```

### Examples

```
feat(availability): add gist exclusion constraint on asset_allocation

Two staff confirming the same garment for overlapping dates could both
win, because the check-then-insert race has no database-level guard.
An EXCLUDE USING gist constraint makes the second write fail, so the
loser is rejected by Postgres rather than by application timing.

Refs: TRD §5, Data-Model §10
```

```
fix(finance): prevent double refund on concurrent approval

Two owners approving the same refund both passed the residual-amount
read before either wrote. The posting is now a conditional UPDATE on
the residual, so only the winning transaction produces the reversal.

Refs: Data-Model §7
```

---

## 3. Before you push

Run the full local gate. CI runs the same commands, so a failure here is a failure there.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Plus, for any change that touches a mutating endpoint or a mutating UI control, the
non-negotiable checklist in `.claude/rules/idempotency-concurrency.md`:

- [ ] The control is disabled while the request is in flight, with a pending state and a
      handler early-return guard.
- [ ] The idempotency key is generated once per user intent, not per attempt.
- [ ] The endpoint is duplicate-safe — idempotency store, conditional state-transition
      UPDATE, or unique constraint with out-of-transaction recovery.
- [ ] A double-fire test exists: sequential **and** concurrent.
- [ ] Unknown enum, state or route values are rejected, never passed through.

---

## 4. Pull requests

One PR does one thing. If the description needs the word "and" twice, split it.

- Open against `main`. Fill in the template completely — "see title" is not a description.
- Link the issue or the spec section the change implements (`Refs: TRD §5`).
- Keep it under roughly 400 changed lines where you reasonably can. Large mechanical
  changes (a rename, a generated file) are fine but say so in the description.
- Do not mix a refactor with a behaviour change. The reviewer cannot see the behaviour
  change inside the noise, and neither can `git bisect` later.
- Draft PRs are encouraged for early feedback. Mark ready for review only when CI is green.

### Merge rules

- **Squash merge only.** The branch's messy history collapses into one Conventional Commit
  on `main`, which is what the changelog is generated from.
- The squash commit message is the PR title — so the PR title must itself be a valid
  Conventional Commit line. CI checks this.
- At least one approving review. `CODEOWNERS` decides whose.
- All required checks green. Never merge with a failing check "because it's unrelated" —
  fix it or open a separate PR that fixes it first.
- The author merges, not the reviewer. The author knows whether anything is still pending.

### Review expectations

Reviewers look for, in this order: correctness, then the non-negotiables above, then
readability, then efficiency (query count, payload size, what happens at 100×). Formatting
is the formatter's job — do not spend review on it.

AI-generated code gets **more** scrutiny than hand-written code, not less: verify that every
API, field and option it used actually exists rather than being a plausible guess. See
`.claude/rules/engineering-standards.md`.

---

## 5. Secrets

**No file whose name starts with `.env` is ever committed. That includes `.env.example`.**

Variable names belong in `docs/runbooks/` or this file's Environment section, written in
prose, where nobody is tempted to paste a working value next to the name.

If a secret does reach a commit: rotate it first, immediately. Rewriting history afterwards
reduces future exposure but un-publishes nothing — clones, forks and provider caches keep it.
The credential is burned the moment it is pushed.

---

## 6. Releases

`main` is the release branch. Tags are `v<major>.<minor>.<patch>`, generated from Conventional
Commits since the previous tag. `CHANGELOG.md` is generated, never hand-edited.

Workspace release order remains fixed, because the contract is upstream of everything:

```
contracts  ──▶  api  ──▶  app / web
   (1)          (2)         (3)
```

A breaking contract change ships in three steps, never one: publish the new contract version
supporting **both** shapes, migrate every consumer, then remove the old shape in a later
release. During the window both shapes are valid — the same expand/contract discipline the
TRD requires for database migrations.

---

## 7. Environment variables

Documented in prose, per repo, in `docs/runbooks/environments.md`. Add the name and its
meaning there in the same PR that introduces it. A missing required variable must fail at
startup with a clear message, never at the first request that needs it.

---

## 8. Repo specifics — api

**Running Postgres locally.** This service targets Postgres 16+ with `btree_gist` available
(the pinned production target is Neon Postgres). Run a local instance with Docker —
`docker run -d --name drezivo-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=drezivo -p 5432:5432 postgres:16`
— or point `DATABASE_URL` at any Postgres 16 instance you control. `btree_gist` and row-level
security are exercised by the migrations in `src/db/migrations/`; a stripped-down or managed
Postgres flavor that disallows extensions or `FORCE ROW LEVEL SECURITY` will not pass the
integration suite.

**Running migrations.** After the database is reachable, run `npm run db:migrate`. Migrations
are plain numbered `.sql` files under `src/db/migrations/` applied in order — see that
directory's `README.md` for the expand/backfill/validate/switch/contract rule. Never hand-edit
a migration file that has already been merged; write a new one.

**Integration tests need a real, disposable test database.** `npm run test:integration` runs the
tests in `tests/integration/` against an actual Postgres connection because the behavior under
test — GiST exclusion constraints, row-level security under the real runtime roles, conditional
state-transition updates — cannot be faithfully emulated by SQLite or an in-memory mock. The
suite connects ONLY through `TEST_DATABASE_URL`, never `DATABASE_URL`, and the harness
(`tests/integration/helpers/test-db.ts`) refuses to run unless that URL is localhost AND the
database name contains "test" — tests truncate their database between cases, so the local
development database must never be a target. The application pool connects as the
non-superuser `drezivo_app` role (password set by the harness, localhost only) so RLS genuinely
binds. A disposable container works well:

```
docker run -d --name drezivo-test-db -e POSTGRES_USER=drezivo -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=drezivo_test -p 127.0.0.1:55432:5432 postgres:17.11-alpine3.24
TEST_DATABASE_URL="postgres://drezivo:test@localhost:55432/drezivo_test" npm run test:integration
```

`npm test` (unit/service tests under `src/**/__tests__/`) does not require a database.

**Deploy artifacts.** One image, two entrypoints. `Dockerfile` builds a single production
image; the HTTP API runs it as `node dist/server.js` (`npm start`) and the durable worker runs
the **same image** as `node dist/worker.js` (`npm run start:worker`). Both processes share the
compiled domain/service layer and read the same validated config — only the entrypoint differs.
Deploy them as two separate services/containers from that one image, not as separate builds.

**Required environment variables (names only — see `docs/runbooks/environments.md` for
meanings; never commit values).** `NODE_ENV`, `PORT`, `DATABASE_URL`, `DATABASE_POOL_MAX`,
`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`,
`INVITATION_EMAIL_ENCRYPTION_KEY`, `INVITATION_EMAIL_DIGEST_KEY`, `AWS_REGION`,
`S3_BUCKET_PRIVATE`, `S3_BUCKET_PUBLIC`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`LOG_LEVEL`, `WORKER_POLL_INTERVAL_MS`, `WORKER_LEASE_SECONDS`, `IDEMPOTENCY_RETENTION_DAYS`.
`src/config/index.ts` is the single source of truth: it validates every one of these with Zod
at process startup and exits with a readable error if any is missing or malformed — it does
not lazily validate on first use.


