import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrationTransaction } from '../../scripts/migration-transaction.js';
import { requireTestDatabaseUrl } from './helpers/test-db.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/db/migrations',
);
const REPAIR_MIGRATION = '0084_session_audit_uniqueness_repair.sql';
const PROJECTION_MIGRATION = '0085_operator_console_projection.sql';

describe('operator-session audit uniqueness migration', () => {
  let adminClient: Client | null = null;
  let databaseName: string | null = null;
  let databaseUrl: string | null = null;
  let legacySessionId: string | null = null;

  beforeAll(async () => {
    const rootDatabaseUrl = requireTestDatabaseUrl();
    const isolatedUrl = new URL(rootDatabaseUrl);
    databaseName = `drezivo_operator_session_test_${randomUUID().replaceAll('-', '')}`;

    adminClient = new Client({ connectionString: rootDatabaseUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${databaseName}"`);

    isolatedUrl.pathname = `/${databaseName}`;
    databaseUrl = isolatedUrl.toString();
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query(`
        CREATE TABLE public.schema_migrations (
          filename text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      const migrationFiles = (await readdir(MIGRATIONS_DIR))
        .filter((filename) => /^\d{4}_.*\.sql$/.test(filename))
        .sort();
      for (const filename of migrationFiles.filter((filename) => filename < REPAIR_MIGRATION)) {
        await applyMigration(client, filename);
      }

      legacySessionId = randomUUID();
      await client.query(
        `INSERT INTO global_audit_event
           (actor_kind, actor_key, action, entity_type, entity_id, outcome, redacted_summary, request_id)
         VALUES
           ('operator', 'operator:test-subject', 'operator.session.started', 'operator_session', $1, 'succeeded', '{}', 'legacy-request-1'),
           ('operator', 'operator:test-subject', 'operator.session.started', 'operator_session', $1, 'succeeded', '{}', 'legacy-request-2')`,
        [legacySessionId],
      );

      await applyMigration(client, REPAIR_MIGRATION);
      await applyMigration(client, PROJECTION_MIGRATION);

      // The preview database took 0085 first. Reapplying the repair SQL models that ordering and
      // proves both environments converge on the same index without deleting legacy evidence.
      await client.query(await readFile(path.join(MIGRATIONS_DIR, REPAIR_MIGRATION), 'utf8'));
    } finally {
      await client.end();
    }
  }, 180_000);

  afterAll(async () => {
    if (adminClient === null) return;
    try {
      if (databaseName !== null) {
        await adminClient.query(
          `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [databaseName],
        );
        await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      }
    } finally {
      await adminClient.end();
    }
  }, 60_000);

  it('preserves duplicate legacy events and selects exactly one canonical row', async () => {
    if (databaseUrl === null || legacySessionId === null) throw new Error('Test database missing.');
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ operator_session_unique_guard: boolean }>(
        `SELECT operator_session_unique_guard
           FROM global_audit_event
          WHERE actor_key = 'operator:test-subject'
            AND entity_id = $1
            AND action = 'operator.session.started'
          ORDER BY operator_session_unique_guard`,
        [legacySessionId],
      );
      expect(rows.map((row) => row.operator_session_unique_guard)).toEqual([false, true]);

      const { rows: indexRows } = await client.query<{ definition: string }>(
        `SELECT pg_get_indexdef('global_operator_session_once'::regclass) AS definition`,
      );
      expect(indexRows[0]?.definition).toContain('operator_session_unique_guard IS TRUE');

      const { rows: privilegeRows } = await client.query<{
        can_set_guard: boolean;
        can_insert_action: boolean;
      }>(
        `SELECT
           has_column_privilege(
             'drezivo_app',
             'global_audit_event',
             'operator_session_unique_guard',
             'INSERT'
           ) AS can_set_guard,
           has_column_privilege(
             'drezivo_app',
             'global_audit_event',
             'action',
             'INSERT'
           ) AS can_insert_action`,
      );
      expect(privilegeRows[0]).toEqual({ can_set_guard: false, can_insert_action: true });
    } finally {
      await client.end();
    }
  });

  it('collapses concurrent duplicate session starts into one new audit event', async () => {
    if (databaseUrl === null) throw new Error('Test database missing.');
    const sessionId = randomUUID();
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    await Promise.all([first.connect(), second.connect()]);

    const insert = (client: Client, requestId: string) =>
      client.query(
        `INSERT INTO global_audit_event
           (actor_kind, actor_key, action, entity_type, entity_id, outcome, redacted_summary, request_id)
         VALUES ('operator', 'operator:test-subject', 'operator.session.started', 'operator_session', $1, 'succeeded', '{}', $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [sessionId, requestId],
      );

    try {
      const results = await Promise.all([
        insert(first, 'concurrent-request-1'),
        insert(second, 'concurrent-request-2'),
      ]);
      expect(results.map((result) => result.rowCount).sort()).toEqual([0, 1]);

      const { rows } = await first.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM global_audit_event
          WHERE actor_key = 'operator:test-subject'
            AND entity_id = $1
            AND action = 'operator.session.started'`,
        [sessionId],
      );
      expect(rows[0]?.count).toBe('1');
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });
});

async function applyMigration(client: Client, filename: string): Promise<void> {
  const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
  await applyMigrationTransaction(client, filename, sql);
}
