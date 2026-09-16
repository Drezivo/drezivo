# Contributing to `app`

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

## 8. Repo specifics — app

`app` is the business dashboard, served at **app.drezivo.com**. It is staff-facing only —
tenant owners and front desk users signed in through Clerk with an active organization. The
public storefront and marketing site live in `web`, not here.

### What this repo is not

This repo never contains business logic that belongs in the API. Next.js route handlers
under `src/app/api/**` are readiness/health checks only (TRD §1) — a reservation
confirmation, a payment verification, a refund, an inventory write, all of it goes through
the Express API via `lib/api-client.ts`. If you find yourself writing a database query, a
price calculation, or a state-transition check in this repo, stop: that belongs in `api`,
behind a contract this repo consumes.

### The two non-negotiables specific to this repo

- **Every mutating control uses `useSubmitGuard`** (`src/lib/use-submit-guard.ts`). Not a
  hand-rolled `onClick` with a `useState` pending flag — the shared hook, every time. See
  `.claude/rules/lessons.md` for why a per-screen guard is the wrong shape.
- **`@drezivo/contracts` is upgraded deliberately, never with a floating range.** It is
  pinned to an exact version in `package.json` (currently `0.1.0`). Bumping it is its own
  PR: read the contract's changelog, update every call site the type-checker flags, and
  note the contract PR it corresponds to. Never widen the dependency to `^0.1.0` or `*` to
  make a local error disappear.

### Required environment variables

Names only — no values, no `.env` file of any kind is ever committed (see `.gitignore` and
`.claude/rules/no-tracked-env.md`). Document meanings in `docs/runbooks/environments.md` in
the same PR that introduces a new one.

- `NEXT_PUBLIC_API_BASE_URL` — base URL of the Express API this app calls through
  `lib/api-client.ts`.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk publishable key for this environment.
- `CLERK_SECRET_KEY` — Clerk secret key, server-side only (middleware, any server action).
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` — Clerk hosted or
  in-app auth route overrides, if not using the defaults in `src/app/(auth)`.

### Local commands

```bash
npm run dev         # start the dashboard against NEXT_PUBLIC_API_BASE_URL
npm run typecheck
npm run lint
npm test            # Vitest unit tests
npm run test:e2e     # Playwright, builds and boots the app first
```


