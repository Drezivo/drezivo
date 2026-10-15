# Database backups and recovery

**Status:** v1 implementation and operator setup guide. A passing workflow is not a restore drill
or a recovery-time guarantee.

## What the workflow protects

The GitHub Actions workflow runs daily at 00:17 Asia/Manila (16:17 UTC), and can be dispatched
manually from `main`. It creates a PostgreSQL custom-format dump of the Drezivo `public` schema,
encrypts it with age before upload, reads the uploaded object back to verify its SHA-256 checksum,
then retains the seven newest verified snapshots in R2. Manual snapshots count toward those seven,
so repeated manual runs can shorten the calendar coverage. GitHub may delay or miss scheduled runs.

This is a logical database backup, not a full system image. It excludes Supabase-managed `auth` and
`storage` schemas, PostgreSQL large objects, Cloudflare R2 file bytes, role passwords, provider
settings, and application configuration. Drezivo uses Clerk and R2 for identity and files, so those
systems need their own recovery arrangements. Database file metadata does not recreate deleted R2
objects.

## One-time provider setup

1. Create a dedicated private R2 bucket for production database backups. Do not reuse the bucket
   holding application media. Create a separate Cloudflare R2 token scoped to this bucket with only
   the object read, write, list, and delete permissions required by the workflow.
2. Generate an age X25519 key pair in a trusted offline environment. Store the private identity in
   an offline password manager or encrypted recovery medium, with a second protected copy. Add only
   the public recipient (`age1...`) to GitHub. Do not put the private identity in GitHub, this
   repository, or the Obsidian vault.
3. In the Supabase SQL Editor, create the backup role as the project owner. Do not grant
   `pg_read_all_data`; that includes Supabase-managed schemas as well as application data.

   ```sql
   CREATE ROLE drezivo_backup_reader
     WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS NOREPLICATION;

   GRANT CONNECT ON DATABASE postgres TO drezivo_backup_reader;
   GRANT USAGE ON SCHEMA public TO drezivo_backup_reader;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO drezivo_backup_reader;
   GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO drezivo_backup_reader;

   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
     GRANT SELECT ON TABLES TO drezivo_backup_reader;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
     GRANT SELECT ON SEQUENCES TO drezivo_backup_reader;
   ALTER ROLE drezivo_backup_reader SET default_transaction_read_only = on;
   ```

   `BYPASSRLS` is needed so `pg_dump` can include rows protected by row-level security (RLS).
   The role still receives only `SELECT` on `public`; do not add it to predefined read or admin
   roles. The read-only default is an extra guard, not a substitute for the absence of write grants.
   Set its password through an interactive `psql` `\password drezivo_backup_reader` prompt, then
   store it only in the GitHub Environment secret. Confirm the role has no access to `auth`,
   `storage`, or other schemas. The workflow fails if it detects `pg_net`, broad data access, or
   unexpected schema grants; review those conditions before changing the guard.

4. Copy the exact Supabase connection string from the Connect panel. Use direct PostgreSQL on port
   5432 when the runner has a supported route, otherwise use the shared Session pooler on port 5432. For the pooler, the username must be `drezivo_backup_reader.<project-ref>`. Transaction
   pooling on port 6543 is rejected. Check the deployed PostgreSQL major before enabling the job:
   the tool image is pinned to PostgreSQL 17.11, and the workflow fails if the server is newer.
5. Create the GitHub Environment `database-backup-production`, restrict it to the `main` branch,
   and add these values. The workflow is unattended, so do not add a required reviewer gate that
   blocks scheduled runs.

   | GitHub Environment variable | GitHub Environment secret      |
   | --------------------------- | ------------------------------ |
   | `SUPABASE_PROJECT_REF`      | `SUPABASE_BACKUP_DATABASE_URL` |
   | `R2_ACCOUNT_ID`             | `R2_ACCESS_KEY_ID`             |
   | `R2_BACKUP_BUCKET`          | `R2_SECRET_ACCESS_KEY`         |
   | `AGE_RECIPIENT`             |                                |

The first invocation should be a manual `workflow_dispatch` from `main`. Confirm the target project
and R2 bucket in the environment configuration first. Review the Actions result and verify the
snapshot and manifest exist in the private bucket. This code change does not create provider
resources, add GitHub secrets, or run a live backup.

## Backup and retention behavior

The job requires the exact backup role, database `postgres`, the configured Supabase project
reference, TLS, `BYPASSRLS`, and read-only default transactions. It rejects a superuser, role with
database/role creation or replication rights, inherited `pg_read_all_data`, any readable table in
another schema, or an enabled `pg_net` extension. It dumps only `public` and skips large objects.

The encrypted `.dump.age` object is committed by a small JSON manifest uploaded only after a
read-back checksum succeeds. Retention starts only after both objects verify. An incomplete object
is cleaned up when possible; if cleanup fails or an unexpected object is found, the workflow stops
without pruning old snapshots. It deletes the archive before its manifest, so a failed delete leaves
the manifest available for the next operator review. The newest seven successful objects are kept.
If an R2 deletion fails after an earlier retention deletion succeeded, R2 has no multi-object
transaction to roll that deletion back; the run stops immediately, and the operator should inspect
the remaining objects before retrying.

The manifest contains the creation time, PostgreSQL and `pg_dump` versions, schema/format, byte
counts, and SHA-256 checksums. It contains no customer rows, connection strings, or credentials.
Read-back hashes detect transfer corruption, but are not a signature: a principal able to write to
the bucket could replace both the archive and manifest. Keep the R2 token narrowly scoped and
protect its GitHub Environment and `main` branch. Workflow logs contain no dump contents or
passwords.

## Manual restore drill

Restore into a new isolated Supabase project first. Never point these commands at production.

1. Download one `.dump.age` object and its `.manifest.json` from the private bucket using the
   bucket-scoped R2 credentials. Compare the downloaded encrypted file's SHA-256 with
   `encryptedSha256` in the manifest before decrypting.
2. Decrypt with the offline private age identity and validate the custom archive:

   ```sh
   age --decrypt --identity "$AGE_IDENTITY_FILE" \
     --output database.dump snapshot.dump.age
   pg_restore --list database.dump
   ```

3. In the isolated target project, create the custom roles before restoring because the archive
   includes their database grants and RLS policies refer to the runtime roles. Recreate `drezivo_app`
   and `drezivo_worker` without `BYPASSRLS`, and `drezivo_backup_reader` with `BYPASSRLS` and the
   same explicit `public` read grants. Set fresh passwords separately with interactive `psql`
   prompts; they are not present in the dump. Supabase's built-in `anon`, `authenticated`, and
   `service_role` roles are platform-owned and should already exist.
4. Restore only to the isolated project, using a project-owner connection and a compatible
   `pg_restore` client:

   ```sh
   pg_restore --exit-on-error --no-owner --schema=public \
     --dbname="$RESTORE_DATABASE_URL" database.dump
   ```

   If a platform object conflicts or a restore command errors, stop and investigate the isolated
   target. Do not add `--clean` as a shortcut. Recreate a clean isolated project if necessary.

5. Check the restored `public.schema_migrations` history against the API checkout. Review and apply
   only the intended pending migrations to the isolated project. Verify table counts and key
   business invariants without exposing customer rows in logs. Check RLS policies, grants, indexes,
   extensions, and runtime-role connectivity.
6. Before any separately approved production cutover, pause outbound workers/notifications,
   reconcile the deletion/hold register and pending payment/outbox work, and verify that R2 objects
   referenced by restored rows still exist. Keep production restore and cutover manual.

Do not claim a recovery-time objective until this drill has been completed and measured. Daily
snapshots permit up to about 24 hours of data loss when the schedule is healthy, and longer if runs
are missed. Seven snapshots are not a guarantee of seven calendar days during repeated manual runs
or scheduled failures.
