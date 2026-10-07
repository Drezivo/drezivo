# Migrations

Plain numbered `.sql` files, applied in filename order by `npm run db:migrate`
(`scripts/migrate.ts`). The full filename is the migration identity; repeated numeric prefixes are
valid and do not replace filename ordering.
This directory — not the Drizzle schema in `src/db/schema/` — is the authoritative source of
truth for the database, because several invariants this product depends on (GiST exclusion
constraints, row-level security, cross-table CHECK-equivalents via constraint triggers) are not
expressible through Drizzle's schema DSL. `drizzle-kit generate` (`npm run db:generate`) is a
starting point for a new migration's _table/column_ shape, reviewed and hand-finished before it
ships — never applied directly to a real database. See TRD §9 and Data-Model §10 for the
invariants this rule exists to protect.

## The expand → backfill → validate → switch → contract rule (TRD §9)

A schema change that could break a currently-deployed application version ships as multiple
migrations across multiple deploys, never as one migration that both adds and enforces a
change atomically:

1. **Expand** — add the new nullable column / new table / new index, compatible with both the
   old and new application code.
2. **Backfill** — populate the new column in bounded batches (not one giant `UPDATE`), with
   progress tracked, so a long-running backfill never holds a lock that blocks production
   traffic.
3. **Validate** — confirm the invariant actually holds across existing data (e.g. a `NOT VALID`
   constraint added and then `VALIDATE CONSTRAINT`'d separately, so validation does not block
   writes while it runs).
4. **Switch** — deploy the application version that starts relying on the new shape.
5. **Contract** — once the old application version is fully retired, drop the now-unused
   old column/constraint in its own migration.

Skipping straight to a `NOT NULL`/`UNIQUE` constraint on a live table without this sequence
risks locking out concurrent writers or breaking the currently-running application version
mid-deploy — both are outage-causing, not just theoretically risky.

## Migrations are never hand-edited after merge

Once a migration file has been merged and applied anywhere (including a shared staging
database), it is immutable. A mistake found later is fixed by a NEW migration file that
corrects the earlier one — never by editing history. Editing a merged migration desyncs any
environment that already applied the original version from one that applies the edited one,
and there is no way to detect that divergence until it causes a production incident.

## Local / CI application

`public.schema_migrations` is the Drezivo runner's authoritative history. Supabase CLI migration
history is separate and must not be used to decide which Drezivo files are pending.

Use `npm run db:migrate:status` for a read-only report of pending files. It refuses to report a
status when the Drezivo ledger is missing, contains filenames absent from this checkout, or has a
gap where a later migration is recorded as applied after an earlier one is pending. The apply
command performs the same history validation before running anything. It commits each migration
and its ledger row in one transaction; earlier successful files remain recorded if a later file
fails.

Local development and tests may bootstrap a missing ledger so a disposable fresh database can be
initialized. Staging and production never create a missing ledger and require
`DATABASE_URL_DIRECT`; they do not fall back to a runtime `DATABASE_URL`. The CI workflow supplies
only that direct migration URL. Run migrations deliberately, never as automatic schema sync on API
startup (TRD §9). `src/server.ts` and `src/worker.ts` assume the schema already matches the applied
migrations; they do not attempt to reconcile it.

For an isolated additive hotfix that must not advance later pending migrations, run
`npm run db:migrate -- --through <exact-filename.sql>` from `api/`. This applies every
unapplied migration whose filename sorts up to and including the named file, and rejects
unknown filenames. Staging and production require `DATABASE_URL_DIRECT` and reject known
Supabase pooler hosts. Inspect the target's `schema_migrations` ledger first. A migration added
earlier than files already applied in a different environment must be independent of them;
the `0070_webhook_invitation_resolution.sql` migration is additive and independent of the 0071+
changes. For that migration only, an exact `--through 0070_webhook_invitation_resolution.sql`
target may close a single ledger gap when every earlier migration is recorded and no other gap
would remain. Ordinary full runs and status checks still reject gaps. The runner also refuses to
apply it if its resolver function already exists; inspect the function, its grants, and the ledger
before any manual reconciliation. Never insert a ledger row without successfully applying its SQL.

## Supabase grants and RLS

All Drezivo tables in the exposed `public` schema must have both protection layers: runtime
database roles need only the table/column grants required by the API or worker, and every table
must enable and force RLS with explicit policies. Do not grant Drezivo application objects to
Supabase's `anon`, `authenticated`, or `service_role`; the product uses its own API and runtime
roles. New tables, sequences, and functions must be private by default and grant only the needed
runtime operations in the same migration. Apply app migrations as the existing Drezivo object
owner (`postgres` on Supabase), not `supabase_admin`, whose default ACLs are managed separately
by Supabase. If Supabase's automatic-RLS event trigger is installed, keep its helper private:
the trigger remains enabled, but only its owner may execute the `SECURITY DEFINER` function.
