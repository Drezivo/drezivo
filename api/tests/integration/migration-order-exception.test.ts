import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inspectMigrationHistory } from '../../scripts/migration-history.js';
import { applyMigrationTransaction } from '../../scripts/migration-transaction.js';
import { migrateTestDatabase, requireTestDatabaseUrl } from './helpers/test-db.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/db/migrations',
);
const IMAGE_VARIANTS_MIGRATION = '0080_file_image_variants_backfill.sql';
const SHARED_RENTER_STEPS_MIGRATION = '0080_shared_payment_renter_steps.sql';
const API_ROOT = path.resolve(MIGRATIONS_DIR, '../../..');
const TSX_CLI = path.resolve(API_ROOT, '../node_modules/tsx/dist/cli.mjs');

describe('0080 image-variants migration history recovery', () => {
  let databaseName: string | null = null;
  let adminClient: Client | null = null;
  let queuedJobCount: string | null = null;
  let pendingAfterRecovery: string[] = [];
  let targetedStatusOutput: string | null = null;
  let targetedApplyOutput: string | null = null;
  let ordinaryStatusOutput: string | null = null;

  beforeAll(async () => {
    const rootDatabaseUrl = requireTestDatabaseUrl();
    await migrateTestDatabase(rootDatabaseUrl);
    const databaseUrl = new URL(rootDatabaseUrl);
    databaseName = `drezivo_migration_order_test_${randomUUID().replaceAll('-', '')}`;

    adminClient = new Client({ connectionString: rootDatabaseUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${databaseName}"`);

    databaseUrl.pathname = `/${databaseName}`;
    const isolatedClient = new Client({ connectionString: databaseUrl.toString() });
    await isolatedClient.connect();

    try {
      await isolatedClient.query(`
        CREATE TABLE public.schema_migrations (
          filename text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      const migrationFiles = (await readdir(MIGRATIONS_DIR))
        .filter((filename) => /^\d{4}_.*\.sql$/.test(filename))
        .sort();
      const earlierMigrations = migrationFiles.filter(
        (filename) => filename < IMAGE_VARIANTS_MIGRATION,
      );

      for (const filename of [...earlierMigrations, SHARED_RENTER_STEPS_MIGRATION]) {
        await applyMigration(isolatedClient, filename);
      }

      const connectionString = databaseUrl.toString();
      targetedStatusOutput = await runMigrationCommand(connectionString, [
        '--status',
        '--through',
        IMAGE_VARIANTS_MIGRATION,
      ]);
      targetedApplyOutput = await runMigrationCommand(connectionString, [
        '--through',
        IMAGE_VARIANTS_MIGRATION,
      ]);
      ordinaryStatusOutput = await runMigrationCommand(connectionString, ['--status']);

      const { rows: appliedRows } = await isolatedClient.query<{ filename: string }>(
        'SELECT filename FROM public.schema_migrations ORDER BY filename',
      );
      pendingAfterRecovery = inspectMigrationHistory(
        migrationFiles,
        appliedRows.map((row) => row.filename),
      ).pendingFiles;

      await isolatedClient.query(
        `INSERT INTO public.tenant (clerk_org_id, name, slug)
         VALUES ('org_migration_order_test', 'Migration Order Test', 'migration-order-test')`,
      );
      await isolatedClient.query(
        `INSERT INTO public.file_object (
           tenant_id, purpose, storage_key, mime_type, byte_size, lifecycle_status,
           upload_expires_at, frozen_at, version_id
         )
         SELECT id, 'catalogue_image', 'test/catalogue-image.webp', 'image/webp', 128,
                'accepted', now(), now(), 'migration-order-fixture'
           FROM public.tenant
          WHERE clerk_org_id = 'org_migration_order_test'`,
      );

      const backfillSql = await readFile(
        path.join(MIGRATIONS_DIR, IMAGE_VARIANTS_MIGRATION),
        'utf8',
      );
      await isolatedClient.query(backfillSql);
      await isolatedClient.query(backfillSql);

      const { rows } = await isolatedClient.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM public.outbox_event
          WHERE event_type = 'file.image_variants.generate_requested'
            AND dedupe_key = 'file-image-variants:' || (
              SELECT id::text FROM public.file_object
               WHERE storage_key = 'test/catalogue-image.webp'
            )`,
      );
      queuedJobCount = rows[0]?.count ?? null;
    } finally {
      await isolatedClient.end();
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

  it('queues one image-variant job after shared renter steps and ignores duplicate backfills', () => {
    expect(queuedJobCount).toBe('1');
    expect(pendingAfterRecovery[0]).toBe('0081_storefront_media_cache_invalidation.sql');
    expect(pendingAfterRecovery).not.toContain(IMAGE_VARIANTS_MIGRATION);
    expect(targetedStatusOutput).toMatch(
      /Pending migrations:\r?\n- 0080_file_image_variants_backfill\.sql/,
    );
    expect(targetedApplyOutput).toContain(`Applying ${IMAGE_VARIANTS_MIGRATION}`);
    expect(ordinaryStatusOutput).toMatch(
      /Pending migrations:\r?\n- 0081_storefront_media_cache_invalidation\.sql/,
    );
  });
});

async function applyMigration(client: Client, filename: string): Promise<void> {
  const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
  await applyMigrationTransaction(client, filename, sql);
}

function runMigrationCommand(connectionString: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [TSX_CLI, path.join(API_ROOT, 'scripts', 'migrate.ts'), ...args],
      {
        cwd: API_ROOT,
        env: {
          ...process.env,
          DATABASE_URL_DIRECT: connectionString,
          DREZIVO_ENV_FILE: '',
          NODE_ENV: 'development',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Migration CLI failed: ${stderr || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
