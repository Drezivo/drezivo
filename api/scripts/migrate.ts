#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import {
  assertInvitationResolverIsNotAlreadyInstalled,
  inspectMigrationHistory,
  OUT_OF_ORDER_SAFE_MIGRATION,
  selectPendingMigrations,
} from './migration-history.js';
import { applyMigrationTransaction } from './migration-transaction.js';
import '../src/config/load-env.js';

/**
 * Applies the numbered `.sql` files in `src/db/migrations/` in order, once, tracked by a
 * `schema_migrations` ledger table — this is intentionally NOT drizzle-kit's own migrator,
 * because that tool assumes Drizzle's generated SQL is authoritative, and per
 * migrations/README.md the hand-written files in this directory are the source of truth here
 * (GiST exclusion constraints and RLS policies are outside what drizzle-kit can generate).
 *
 * Uses a direct (non-pooled) connection, per TRD §9. Supabase recommends its direct endpoint for
 * migrations and other single-session administrative work; runtime pooler settings must not
 * weaken the guarantees required by a DDL-heavy migration run.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const statusOnly = args.length === 1 && args[0] === '--status';
  const through = args.length === 2 && args[0] === '--through' && args[1] ? args[1] : null;
  if (args.length > 0 && !statusOnly && through === null) {
    throw new Error('Usage: npm run db:migrate -- [--status | --through <migration-filename.sql>]');
  }

  const isRemoteEnvironment =
    process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'production';
  const databaseUrl = isRemoteEnvironment
    ? process.env.DATABASE_URL_DIRECT
    : (process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error(
      isRemoteEnvironment
        ? 'DATABASE_URL_DIRECT is required for staging and production migrations.'
        : 'DATABASE_URL_DIRECT or DATABASE_URL is required to run migrations.',
    );
  }
  if (isRemoteEnvironment && new URL(databaseUrl).hostname.endsWith('.pooler.supabase.com')) {
    throw new Error(
      'DATABASE_URL_DIRECT points to a Supabase pooler; use the project direct endpoint.',
    );
  }

  const entries = await readdir(MIGRATIONS_DIR);
  const allFiles = entries.filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  if (through !== null && !allFiles.includes(through)) {
    throw new Error(`Unknown migration filename: ${through}`);
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows: ledgerRows } = await client.query<{ ledger_exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ledger_exists",
    );
    const ledgerExists = ledgerRows[0]?.ledger_exists === true;

    if (!ledgerExists && (statusOnly || isRemoteEnvironment)) {
      inspectMigrationHistory(allFiles, null);
    }

    if (!ledgerExists) {
      await client.query(`
        CREATE TABLE public.schema_migrations (
          filename text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    }

    const { rows: applied } = await client.query<{ filename: string }>(
      'SELECT filename FROM public.schema_migrations ORDER BY filename',
    );
    const status = inspectMigrationHistory(
      allFiles,
      applied.map((row) => row.filename),
      through,
    );

    if (statusOnly) {
      console.log(`Applied ${status.appliedFiles.length} of ${allFiles.length} migrations.`);
      if (status.pendingFiles.length === 0) {
        console.log('No pending migrations.');
      } else {
        console.log('Pending migrations:');
        for (const file of status.pendingFiles) {
          console.log(`- ${file}`);
        }
      }
      return;
    }

    const pendingFiles = selectPendingMigrations(status, allFiles, through);
    for (const file of pendingFiles) {
      if (file === OUT_OF_ORDER_SAFE_MIGRATION) {
        const { rows: preflightRows } = await client.query<{ function_exists: boolean }>(
          `SELECT to_regprocedure('public.resolve_membership_invitation_webhook(text,text)')
                    IS NOT NULL AS function_exists`,
        );
        assertInvitationResolverIsNotAlreadyInstalled(
          preflightRows[0]?.function_exists === true,
        );
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Applying ${file} ...`);

      try {
        await applyMigrationTransaction(client, file, sql);
      } catch (error) {
        console.error(
          `Migration ${file} failed; rolled back. Fix forward with a new migration file, never edit this one.`,
        );
        throw error;
      }
    }

    const { rows: refreshedApplied } = await client.query<{ filename: string }>(
      'SELECT filename FROM public.schema_migrations ORDER BY filename',
    );
    const refreshedStatus = inspectMigrationHistory(
      allFiles,
      refreshedApplied.map((row) => row.filename),
    );
    const remainingPending = selectPendingMigrations(refreshedStatus, allFiles, through);
    if (remainingPending.length > 0) {
      throw new Error(`Migration run finished with pending files: ${remainingPending.join(', ')}`);
    }
    console.log('Migrations up to date.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
