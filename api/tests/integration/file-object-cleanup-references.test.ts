import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  buildWorkerRoleDatabaseUrl,
  ensureAppRoleLogin,
  ensureWorkerRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();
const appUrl = buildAppRoleDatabaseUrl(adminUrl);
const workerUrl = buildWorkerRoleDatabaseUrl(adminUrl);
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = appUrl;

describe('file object cleanup reference barrier', async () => {
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { prepareFileObjectCleanup } =
    await import('../../src/modules/files/file-object-cleanup.repository.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await ensureWorkerRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('defers shared, cross-tenant, policy-history, and measurement-guide references until all are removed', async () => {
    const owner = await createStorefrontWorkspace('cleanup-reference-owner');
    const otherTenant = await createStorefrontWorkspace('cleanup-reference-other');
    const fileId = await withTenantTransaction(
      owner.tenantId,
      owner.owner.principalId,
      async (client) => {
        const inserted = await client.query<{ id: string; storage_key: string }>(
          `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'measurement_guide', $2, 'cleanup-reference-source-v1', 'image/png', 512,
                 'accepted', true, now(), now())
         RETURNING id, storage_key`,
          [owner.tenantId, `tenant-files/${owner.tenantId}/cleanup-reference/source`],
        );
        const file = inserted.rows[0];
        if (!file) throw new Error('expected cleanup reference file');
        await client.query(
          `INSERT INTO measurement_guide (tenant_id, file_id, name, status, is_default)
         VALUES ($1, $2, 'Cleanup reference guide', 'active', true)`,
          [owner.tenantId, file.id],
        );
        await client.query(
          `UPDATE storefront
            SET branding = jsonb_set(jsonb_set(branding, '{logo_file_id}', to_jsonb($3::text), true),
                                     '{cover_file_id}', to_jsonb($3::text), true)
          WHERE tenant_id = $1 AND id = $2`,
          [owner.tenantId, owner.storefrontId, file.id],
        );
        return file.id;
      },
    );

    await withTenantTransaction(
      otherTenant.tenantId,
      otherTenant.owner.principalId,
      async (client) => {
        await client.query(
          `UPDATE storefront
            SET content = jsonb_set(content, '{hero,image_file_id}', to_jsonb($3::text), true)
          WHERE tenant_id = $1 AND id = $2`,
          [otherTenant.tenantId, otherTenant.storefrontId, fileId],
        );
        await client.query(
          `UPDATE policy_snapshot
            SET rental_rules = jsonb_set(COALESCE(rental_rules, '{}'::jsonb), '{image_file_ids}', $3::jsonb, true)
          WHERE tenant_id = $1 AND storefront_id = $2 AND version = 1`,
          [otherTenant.tenantId, otherTenant.storefrontId, JSON.stringify([fileId])],
        );
      },
    );

    const privileges = new Client({ connectionString: adminUrl });
    await privileges.connect();
    try {
      const result = await privileges.query<{
        app_can_execute: boolean;
        worker_can_execute: boolean;
      }>(
        `SELECT has_function_privilege('drezivo_app', 'public.file_object_has_references(uuid, uuid)', 'EXECUTE') AS app_can_execute,
                has_function_privilege('drezivo_worker', 'public.file_object_has_references(uuid, uuid)', 'EXECUTE') AS worker_can_execute`,
      );
      expect(result.rows[0]).toEqual({ app_can_execute: false, worker_can_execute: true });
    } finally {
      await privileges.end();
    }

    await expect(
      withWorkerTransaction(owner.tenantId, (client) =>
        prepareFileObjectCleanup(client, owner.tenantId, fileId),
      ),
    ).rejects.toMatchObject({ name: 'DeferredOutboxError' });

    await withTenantTransaction(owner.tenantId, owner.owner.principalId, async (client) => {
      await client.query(
        `UPDATE storefront
            SET branding = jsonb_set(jsonb_set(branding, '{logo_file_id}', 'null'::jsonb, true),
                                     '{cover_file_id}', 'null'::jsonb, true)
          WHERE tenant_id = $1 AND id = $2`,
        [owner.tenantId, owner.storefrontId],
      );
    });
    await expect(
      withWorkerTransaction(owner.tenantId, (client) =>
        prepareFileObjectCleanup(client, owner.tenantId, fileId),
      ),
    ).rejects.toMatchObject({ name: 'DeferredOutboxError' });

    await withTenantTransaction(
      otherTenant.tenantId,
      otherTenant.owner.principalId,
      async (client) => {
        await client.query(
          `UPDATE storefront
            SET content = jsonb_set(content, '{hero,image_file_id}', 'null'::jsonb, true)
          WHERE tenant_id = $1 AND id = $2`,
          [otherTenant.tenantId, otherTenant.storefrontId],
        );
        await client.query(
          `UPDATE policy_snapshot
            SET rental_rules = jsonb_set(COALESCE(rental_rules, '{}'::jsonb), '{image_file_ids}', '[]'::jsonb, true)
          WHERE tenant_id = $1 AND storefront_id = $2 AND version = 1`,
          [otherTenant.tenantId, otherTenant.storefrontId],
        );
      },
    );
    await expect(
      withWorkerTransaction(owner.tenantId, (client) =>
        prepareFileObjectCleanup(client, owner.tenantId, fileId),
      ),
    ).rejects.toMatchObject({ name: 'DeferredOutboxError' });

    await withTenantTransaction(owner.tenantId, owner.owner.principalId, async (client) => {
      await client.query('DELETE FROM measurement_guide WHERE tenant_id = $1 AND file_id = $2', [
        owner.tenantId,
        fileId,
      ]);
    });
    await expect(
      withWorkerTransaction(owner.tenantId, (client) =>
        prepareFileObjectCleanup(client, owner.tenantId, fileId),
      ),
    ).resolves.toEqual({
      kind: 'delete',
      storageKey: `tenant-files/${owner.tenantId}/cleanup-reference/source`,
    });
  });

  it('lets an attachment transaction win safely when it holds the file share lock before cleanup', async () => {
    const workspace = await createStorefrontWorkspace('cleanup-attachment-race');
    const fileId = await withTenantTransaction(
      workspace.tenantId,
      workspace.owner.principalId,
      async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO file_object
           (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
            is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'catalogue_image', $2, 'cleanup-race-source-v1', 'image/png', 512,
                 'accepted', true, now(), now())
         RETURNING id`,
          [workspace.tenantId, `tenant-files/${workspace.tenantId}/cleanup-race/source`],
        );
        const id = result.rows[0]?.id;
        if (!id) throw new Error('expected accepted race-test file');
        return id;
      },
    );

    const attachment = new Client({ connectionString: appUrl });
    const worker = new Client({ connectionString: workerUrl });
    const observer = new Client({ connectionString: adminUrl });
    await Promise.all([attachment.connect(), worker.connect(), observer.connect()]);
    try {
      await attachment.query('BEGIN');
      await attachment.query("SELECT set_config('app.tenant_id', $1, true)", [workspace.tenantId]);
      await attachment.query("SELECT set_config('app.principal_id', $1, true)", [
        workspace.owner.principalId,
      ]);
      await attachment.query(
        `SELECT id FROM file_object
          WHERE tenant_id = $1 AND id = $2 AND lifecycle_status = 'accepted'
          FOR SHARE`,
        [workspace.tenantId, fileId],
      );
      await attachment.query(
        `INSERT INTO product_image (tenant_id, product_id, file_id, display_order)
         VALUES ($1, $2, $3, 4)`,
        [workspace.tenantId, workspace.productId, fileId],
      );

      await worker.query('BEGIN');
      await worker.query("SELECT set_config('app.tenant_id', $1, true)", [workspace.tenantId]);
      await worker.query("SELECT set_config('app.principal_id', 'file-object-cleanup', true)");
      await worker.query("SELECT set_config('app.actor_kind', 'system', true)");
      const backend = await worker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const workerPid = backend.rows[0]?.pid;
      if (workerPid === undefined) throw new Error('expected worker backend pid');
      const cleanup = prepareFileObjectCleanup(
        worker as unknown as import('pg').PoolClient,
        workspace.tenantId,
        fileId,
      );

      let waitingForLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await observer.query<{ wait_event_type: string | null }>(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
          [workerPid],
        );
        if (activity.rows[0]?.wait_event_type === 'Lock') {
          waitingForLock = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingForLock).toBe(true);

      await attachment.query('COMMIT');
      await expect(cleanup).rejects.toMatchObject({ name: 'DeferredOutboxError' });
      await worker.query('ROLLBACK');
    } finally {
      await attachment.query('ROLLBACK').catch(() => undefined);
      await worker.query('ROLLBACK').catch(() => undefined);
      await Promise.all([attachment.end(), worker.end(), observer.end()]);
    }

    const file = await withTenantTransaction(
      workspace.tenantId,
      workspace.owner.principalId,
      async (client) =>
        client.query<{ lifecycle_status: string }>(
          'SELECT lifecycle_status FROM file_object WHERE tenant_id = $1 AND id = $2',
          [workspace.tenantId, fileId],
        ),
    );
    expect(file.rows[0]?.lifecycle_status).toBe('accepted');
  });

  async function withWorkerTransaction<T>(
    tenantId: string,
    operation: (client: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = new Client({ connectionString: workerUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await client.query("SELECT set_config('app.principal_id', 'file-object-cleanup', true)");
      await client.query("SELECT set_config('app.actor_kind', 'system', true)");
      const result = await operation(client as unknown as import('pg').PoolClient);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.end();
    }
  }
});
