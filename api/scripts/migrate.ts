#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { inspectMigrationHistory } from './migration-history.js';
import '../src/config/load-env.js';

/**
 * Applies the numbered `.sql` files in `src/db/migrations/` in order, once, tracked by a
 * `schema_migrations` ledger table — this is intentionally NOT drizzle-kit's own migrator,
 * because that tool assumes Drizzle's generated SQL is authoritative, and per
 * migrations/README.md the hand-written files in this directory are the source of truth here
 * (GiST exclusion constraints and RLS policies are outside what drizzle-kit can generate).
 *
 * Remote staging and production runs require the direct connection variable and never fall back
 * to the runtime URL. Local development retains the DATABASE_URL fallback for compatibility.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function main(): Promise<void> {
  const statusOnly = process.argv.slice(2).length === 1 && process.argv[2] === '--status';
  if (process.argv.slice(2).length > 0 && !statusOnly) {
    throw new Error('The only supported argument is --status.');
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

  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries.filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows: ledgerRows } = await client.query<{ ledger_exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ledger_exists",
    );
    const ledgerExists = ledgerRows[0]?.ledger_exists === true;

    if (!ledgerExists && statusOnly) {
      inspectMigrationHistory(files, null);
    }

    if (!ledgerExists && isRemoteEnvironment) {
      inspectMigrationHistory(files, null);
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
      files,
      applied.map((row) => row.filename),
    );

    if (statusOnly) {
      console.log(`Applied ${status.appliedFiles.length} of ${files.length} migrations.`);
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

    for (const file of status.pendingFiles) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Applying ${file} ...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
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
      files,
      refreshedApplied.map((row) => row.filename),
    );
    if (refreshedStatus.pendingFiles.length > 0) {
      throw new Error(
        `Migration run finished with pending files: ${refreshedStatus.pendingFiles.join(', ')}`,
      );
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
