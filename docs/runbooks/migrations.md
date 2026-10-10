# Migrations

The procedure for changing the Supabase PostgreSQL schema without breaking the application that is
currently running against it. This runbook implements TRD §9 ("Supabase PostgreSQL operations and
schema evolution") directly — read that section if you need the reasoning behind a step here, not
just the step.

For the additive account, onboarding, membership, and subscription rollout, also follow the
[Tenancy and onboarding migration plan](../architecture/Tenancy-Onboarding-Migration-Plan.md).

## The rule that governs everything below

**Apply version-controlled, reviewed migrations once, through CI/CD, using a migration role.**
(TRD §9.) Never run schema synchronization on API startup. A migration is a deliberate,
reviewed, single-application action — not a side effect of deploying application code.

**Old and new application code must both work against the schema during the deploy window.**
Because a rolling deploy runs old and new server instances simultaneously (`docs/runbooks/
deploy.md`), a migration that only the new code understands, applied while old code is still
receiving traffic, breaks the old instances mid-rollout.

## The five-step procedure: expand → backfill → validate → switch → contract

### 1. Expand

Add the new schema element in a way that is _purely additive_ — a new nullable column, a new
table, a new index built without locking out writes (`CREATE INDEX CONCURRENTLY`), a new
constraint that is not yet enforced. Old application code, which does not know this element
exists, continues to work unmodified. New application code can start writing to it once
deployed, but does not have to yet.

### 2. Backfill

Populate the new element for existing rows, **in bounded batches, with progress tracked** (TRD
§9). Never run an unbounded `UPDATE` across a large table in one transaction — it holds locks
and generates WAL/bloat proportional to the whole table, and a failure partway through leaves no
record of how far it got. A bounded batch job that commits progress after each batch can be
paused, resumed, and monitored.

### 3. Validate

Before enforcing anything new, verify the invariant actually holds across the real data: run
the check that a NOT NULL constraint or a new exclusion constraint would enforce, as a read-only
query, and confirm it passes. Fix any exceptions found — do not proceed to step 4 with known
violations, and do not "fix" a violation by weakening the constraint you are about to add.

### 4. Switch

Deploy the application code that actually depends on the new element (starts requiring the
formerly-nullable column, starts relying on the new constraint's guarantee). This is the point
where new code becomes load-bearing on the new schema — old code should no longer be receiving
traffic by the time this step's constraint is enforced (see step 5).

### 5. Contract

Once every instance is confirmed running the new code (`docs/runbooks/deploy.md`'s readiness
checks, not assumption), enforce the constraint that could not be safely enforced while old code
was still live: `ALTER TABLE ... SET NOT NULL`, add the exclusion constraint, drop a
now-unused old column. This is a **separate migration**, applied only after the switch step is
confirmed complete — never bundled into the same migration as the expand step, because bundling
them removes the safety margin the whole procedure exists to create.

## Lock budgets for large index and constraint changes

TRD §9: "Large indexes and constraint changes require lock budgets and appropriate migration
options." Concretely:

- Build new indexes with `CREATE INDEX CONCURRENTLY`, never a plain `CREATE INDEX` on a table
  receiving production writes — a plain `CREATE INDEX` holds a lock that blocks writes for the
  duration of the build.
- Adding a `NOT NULL` constraint to an existing large table: prefer `ADD CONSTRAINT ... CHECK
(col IS NOT NULL) NOT VALID` followed by `VALIDATE CONSTRAINT` (which takes a lighter lock and
  scans without blocking writes for the whole duration), then convert to a true `NOT NULL` once
  validated, over a single blocking `SET NOT NULL` on a large table.
- Adding the `EXCLUDE USING gist` constraint this system depends on for availability correctness
  (`docs/decisions/0002-drizzle-and-node-postgres.md`) is exactly the kind of change this budget
  applies to — test its lock behavior and duration against realistic data in the isolated Supabase
  staging project (TRD §9) before running it against production.
- DECISION NEEDED: set an explicit maximum acceptable lock duration (e.g., "no migration step
  may hold an exclusive lock for more than N seconds against the production database") once a
  representative production data volume exists to measure against. Until then, treat any
  migration whose lock duration has not been measured in a realistic staging project as unverified,
  not safe.

## Roll forward, not back

**Data fixes roll forward. An application code rollback does not reverse a data migration.**
(TRD §9.) If a migration already ran and altered data — backfilled a column, converted a
representation — rolling the _application code_ back to the previous version does not undo that
data change; the previous code version may not even know the new column exists, let alone how
to reverse its population. If a migration produces incorrect data, the fix is a new, forward
migration that corrects it — reviewed and applied the same way as any other migration — not a
`git revert` of the migration file, which at best does nothing to already-changed data and at
worst leaves the schema in a state neither the old nor the new application code expects.

See `docs/runbooks/rollback.md` for what rollback _can_ and cannot undo across the whole system,
not just migrations.

## Protected migration pipeline

The root `.github/workflows/ci.yml` applies Drezivo migration files to remote databases after the
backend checks and container build pass. It uses `npm run db:migrate`, not Supabase CLI migration
history. The Drezivo `public.schema_migrations` table is authoritative; Supabase's own CLI history
is a separate ledger.

For an automatic run, a migration-file change must reach `staging` or `main`. A push to `staging`
runs the protected staging migration job. A push to `main` runs the preview and production sequence.
A manual workflow dispatch from either branch also runs that branch's migration job. Pull requests
and other branches never receive migration secrets. Staging and preview jobs share a non-cancelling
concurrency group because they may target the same preview database. Each database job refuses to
continue if its commit is no longer the current branch head.

The sequence is:

1. Backend tests and the container build pass.
2. On `staging`, the `staging` environment reports the Drezivo migration status, applies pending
   files, then verifies that none remain. Staging must contain only synthetic or anonymized data.
3. On `main`, the `preview` environment performs the same status, apply, and verification sequence.
4. The `production` job starts only after preview succeeds. GitHub pauses it for the required
   repository-owner approval configured on the `production` environment.
5. After approval, the job checks that the live schema/ledger baseline was manually reconciled,
   reports status, applies pending files in filename order, and verifies the final status.

Configure three GitHub Actions environments, `staging`, `preview`, and `production`, with branch
restrictions matching their job: `staging` for `staging`, and `preview`/`production` for `main`.
Add a separate `MIGRATION_DATABASE_URL` environment secret to each, using the migration database
role. The GitHub-hosted runner may use a Supabase direct connection on port 5432 or the shared
Session pooler on port 5432. Use Session mode for the IPv4-only runner when the project does not
have the paid IPv4 add-on. Do not use transaction pooling on port 6543. Supabase recommends direct
connections for migrations; Session mode is the compatibility path being introduced for this
runner constraint. The staging secret may point to the same preview database used by the `preview`
job, but both jobs must retain the shared non-cancelling concurrency group. The production
environment also requires the repository owner as reviewer; leave **Prevent self-review** disabled
so the owner can approve their own run. Environment secrets are available only after the configured
protection rules pass. A named environment without its reviewer and branch rules is not an approval
gate.

Manual workflow dispatch defaults to status-only and reports pending migrations without applying
them. Select `apply` only after reviewing the pending list and confirming that every pending file is
intended for that database. Pushes that change migration files retain automatic status, apply, and
verification behavior after the backend checks pass.

Before enabling production migrations, rotate any previously exposed database password, confirm
the API and worker use restricted runtime roles, and manually compare the production schema with
the Drezivo ledger. Only after that comparison should the production environment variable
`MIGRATION_PRODUCTION_RECONCILED` be set to `true`. The workflow will fail closed if it is absent.
Never mark old migrations applied automatically to make the check pass. Investigate unknown ledger
entries or gaps and reconcile them through a reviewed, explicit procedure first.

The runner treats missing ledgers, unknown filenames, and gaps as errors before applying any file.
Check status locally with:

```bash
npm run db:migrate:status --workspace @drezivo/api
```

Each file and its `public.schema_migrations` row commit in one transaction. This protects migration
history consistency, not data from an incorrect migration; fixes still use forward migrations.

## Supabase-specific operational notes

- **Use a single-session connection for migrations.** Direct connections remain preferred.
  GitHub-hosted runners can use the shared Supavisor Session pooler on port 5432 as the IPv4
  fallback; it keeps one session for the migration client. Do not use transaction pooling on port
  6543. The API and worker use separate, restricted runtime URLs.
- **Rehearsal environments are not backups.** Use the separate Supabase staging project, seeded
  with synthetic or anonymized data, for migration rehearsal. Do not clone live personal data into
  an environment with broader preview access.
- **Backups are plan- and configuration-dependent.** Confirm purchased daily-backup or
  point-in-time recovery retention, then run a restore drill. Supabase backups may not preserve
  custom-role passwords; reapply the `drezivo_app` and `drezivo_worker` credentials out of band.
- **Keep the Data API disabled.** A migration that creates objects in `public` must not silently
  create a second browser-accessible API. Audit default grants to `anon`, `authenticated`, and
  `service_role` as part of migration review.
- **Keep the migration connection mode explicit.** Use the direct endpoint when the runner can
  reach it; otherwise use the shared Session pooler URL. Do not substitute a transaction-pooler or
  runtime URL.
- Pin the supported Postgres major version; schedule and rehearse upgrades rather than letting
  them happen implicitly (TRD §9).

## Before running any migration against production

- [ ] The migration is version-controlled and has been reviewed like any other change
      (`CONTRIBUTING.md`).
- [ ] It ran successfully against the Supabase staging project seeded with
      representative data first.
- [ ] The migration used the protected `MIGRATION_DATABASE_URL` secret, and runtime smoke tests
      used only the restricted `drezivo_app` / `drezivo_worker` roles.
- [ ] Data API exposure and default Supabase role grants were checked for every new object.
- [ ] Its lock behavior and duration were measured, not assumed, for any index/constraint change
      against a large table.
- [ ] It is additive/backward-compatible with the application version currently running in
      production, unless this is deliberately the "contract" step after a confirmed "switch."
- [ ] The runbook or environment doc describing anything this migration changes is updated in
      the same PR (`docs/runbooks/README.md`'s standing rule).
