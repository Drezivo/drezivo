import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrateTestDatabase, requireTestDatabaseUrl } from './helpers/test-db.js';

/**
 * Supabase installs pgcrypto in the `extensions` schema; local and CI Postgres install it in
 * `public`. A function that pins its search_path and calls digest() therefore passes every local
 * test and fails in production with 42883 (migration 0087). This test recreates the hosted layout
 * inside a transaction that is rolled back, then resolves digest() under each such function's own
 * search_path.
 */
describe('pgcrypto on a pinned search_path', () => {
  const adminUrl = requireTestDatabaseUrl();
  const client = new Client({ connectionString: adminUrl });

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  it('resolves digest() in every function that calls it when pgcrypto lives in `extensions`', async () => {
    await client.query('BEGIN');
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS extensions');
      await client.query('ALTER EXTENSION pgcrypto SET SCHEMA extensions');
      const functions = await client.query<{ fn: string; search_path: string | null }>(
        `SELECT p.oid::regprocedure::text AS fn,
                (SELECT substr(c, length('search_path=') + 1)
                   FROM unnest(coalesce(p.proconfig, '{}')) c
                  WHERE c LIKE 'search_path=%') AS search_path
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prosrc ~ '\\mdigest\\s*\\('
          ORDER BY 1`,
      );
      expect(functions.rows.map((row) => row.fn)).toEqual(
        expect.arrayContaining([
          'operator_clothing_delete_preview(uuid,uuid)',
          'operator_console_command(text,text,text,text,jsonb)',
          'operator_workspace(text,text,uuid,uuid,text,text,jsonb)',
        ]),
      );

      const unresolved: string[] = [];
      for (const { fn, search_path: searchPath } of functions.rows) {
        // A function without a pinned path uses the caller's; the API's sessions do not add
        // `extensions`, so treat that the same as a path without it.
        await client.query('SAVEPOINT probe');
        try {
          await client.query("SELECT set_config('search_path', $1, true)", [searchPath ?? 'public']);
          await client.query("SELECT digest('probe', 'sha256')");
        } catch {
          unresolved.push(fn);
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT probe');
        }
      }
      expect(unresolved).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
