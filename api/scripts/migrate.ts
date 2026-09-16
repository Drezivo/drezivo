#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

/**
 * Applies the numbered `.sql` files in `src/db/migrations/` in order, once, tracked by a
 * `schema_migrations` ledger table — this is intentionally NOT drizzle-kit's own migrator,
 * because that tool assumes Drizzle's generated SQL is authoritative, and per
 * migrations/README.md the hand-written files in this directory are the source of truth here
 * (GiST exclusion constraints and RLS policies are outside what drizzle-kit can generate).
 *
 * Uses a direct (non-pooled) connection, per TRD §9: "Use the direct connection for
 * migration/admin tools that require it" — Neon's pooled endpoint is unsuitable for the
 * DDL-heavy, single-shot nature of a migration run.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }

  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries.filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();

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
        console.error(`Migration ${file} failed; rolled back. Fix forward with a new migration file, never edit this one.`);
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
