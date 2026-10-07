#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

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
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--through')) {
    throw new Error('Usage: npm run db:migrate -- [--through <migration-filename.sql>]');
  }
  const through = args[1] ?? null;

  const databaseUrl = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL_DIRECT or DATABASE_URL is required to run migrations.');
    process.exit(1);
  }

  const entries = await readdir(MIGRATIONS_DIR);
  const allFiles = entries.filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  if (through !== null && !allFiles.includes(through)) {
    throw new Error(`Unknown migration filename: ${through}`);
  }
  const files = through === null ? allFiles : allFiles.filter((name) => name <= through);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows: applied } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const appliedSet = new Set(applied.map((row) => row.filename));

    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

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

    console.log('Migrations up to date.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
