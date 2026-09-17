import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

/**
 * Integration-test database harness (TBF-010's promised evidence — and the seed of the shared
 * harness every later TBF task inherits).
 *
 * Safety model, in order:
 *   1. Tests ONLY ever touch a database named by TEST_DATABASE_URL — a separate variable from
 *      the app's DATABASE_URL on purpose, so pointing tests at a dev/production database
 *      requires actively setting that variable, and
 *   2. the URL must resolve to localhost — a remote TEST_DATABASE_URL is refused outright,
 *      because a remote test database is either someone's real data or a CI container that
 *      should be addressed explicitly, never silently.
 *
 * The admin URL (TEST_DATABASE_URL) is used only for migration/DDL/reset. The application
 * pool connects as the non-superuser `drezivo_app` role with a test-only password (see
 * `ensureAppRoleLogin`), so RLS policies from 0008 genuinely bind in every test — running as
 * the admin/superuser would silently bypass row-level security and prove nothing.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const APP_ROLE = 'drezivo_app';
const WORKER_ROLE = 'drezivo_worker';
/** Test-only password for the local app role; charset-restricted because ALTER ROLE cannot take a bind parameter. */
const APP_ROLE_TEST_PASSWORD = process.env.TEST_DATABASE_APP_PASSWORD ?? 'drezivo_app_local_test';
const WORKER_ROLE_TEST_PASSWORD =
  process.env.TEST_DATABASE_WORKER_PASSWORD ?? 'drezivo_worker_local_test';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/db/migrations',
);

export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests (a local, disposable database). ' +
        'Never point it at a development or production database — see tests/integration/helpers/test-db.ts.',
    );
  }
  const parsed = new URL(url);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `TEST_DATABASE_URL must target localhost (got "${parsed.hostname}"). Integration tests ` +
        'refuse remote databases so real data can never be truncated by a test run.',
    );
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `TEST_DATABASE_URL must point at a database whose name contains "test" (got "${databaseName}"). ` +
        'Tests truncate their database between cases; the local development database must never be a target.',
    );
  }
  return url;
}

/** Same database, but authenticated as the non-superuser app role so RLS applies. */
export function buildAppRoleDatabaseUrl(adminUrl: string): string {
  const parsed = new URL(adminUrl);
  parsed.username = APP_ROLE;
  parsed.password = APP_ROLE_TEST_PASSWORD;
  return parsed.toString();
}

/** Same database, authenticated as the dedicated worker role for inbox read/status tests. */
export function buildWorkerRoleDatabaseUrl(adminUrl: string): string {
  const parsed = new URL(adminUrl);
  parsed.username = WORKER_ROLE;
  parsed.password = WORKER_ROLE_TEST_PASSWORD;
  return parsed.toString();
}

/** Applies every numbered migration in ledger order — the same discipline as `npm run db:migrate`. */
export async function migrateTestDatabase(adminUrl: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries.filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();

  const client = new Client({ connectionString: adminUrl });
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
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

/**
 * Gives the local `drezivo_app` role a login password so the application pool can connect as
 * it. 0008 deliberately creates the role without a password (a real deployment supplies it out
 * of band); this runs ONLY against the localhost-guarded test database.
 */
export async function ensureAppRoleLogin(adminUrl: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(APP_ROLE_TEST_PASSWORD)) {
    throw new Error('TEST_DATABASE_APP_PASSWORD must be 8-128 chars of [A-Za-z0-9_-]');
  }
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${APP_ROLE_TEST_PASSWORD}'`);
  } finally {
    await client.end();
  }
}

export async function ensureWorkerRoleLogin(adminUrl: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(WORKER_ROLE_TEST_PASSWORD)) {
    throw new Error('TEST_DATABASE_WORKER_PASSWORD must be 8-128 chars of [A-Za-z0-9_-]');
  }
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`ALTER ROLE ${WORKER_ROLE} WITH LOGIN PASSWORD '${WORKER_ROLE_TEST_PASSWORD}'`);
  } finally {
    await client.end();
  }
}

/**
 * Wipes tenant-tenancy state between tests. Runs as the admin URL because TRUNCATE is an
 * owner-level privilege the app role deliberately lacks. `schema_migrations` is never
 * truncated — the ledger survives across tests and test runs.
 */
export async function resetTestDatabase(adminUrl: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE TABLE webhook_inbox, global_audit_event, bootstrap_idempotency_record, onboarding_payment_verification, organization_onboarding, account, membership, branch_membership, branch, tenant RESTART IDENTITY CASCADE',
    );
  } finally {
    await client.end();
  }
}
