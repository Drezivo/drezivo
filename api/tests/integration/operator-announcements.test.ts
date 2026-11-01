import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

/**
 * Migration 0094 and the operator.announcement worker. The operator API calls the functions as the
 * runtime role in an operator context (app.actor_kind = 'operator', no tenant), as it does for
 * operator_console_command.
 */
const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
const KEY = 'announcement-maintenance-window';

describe('operator announcements', async () => {
  const { closePool } = await import('../../src/db/client.js');
  const { createTestTenant } = await import('./helpers/factories.js');
  const { createOperatorAnnouncementHandler } = await import('../../src/worker/handlers/operator-announcement.js');
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const app = new pg.Pool({ connectionString: buildAppRoleDatabaseUrl(adminUrl), max: 4 });

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => {
    await admin.query('DELETE FROM operator_announcement');
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await app.end();
    await admin.end();
    await closePool();
  });

  async function asOperator<T>(work: (client: pg.PoolClient) => Promise<T>, kind = 'operator'): Promise<T> {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_kind', $1, true), set_config('app.principal_id', 'operator:op_1', true)", [kind]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const send = (subject = 'Maintenance on Sunday', body = 'Drezivo is offline from 1 AM to 2 AM.', key = KEY) =>
    asOperator(async (client) => (await client.query<{ data: { id: string; recipient_count: number; replayed: boolean } }>(
      'SELECT operator_send_announcement($1, $2, $3, $4, $5) AS data', ['op_1', key, 'req-1', subject, body],
    )).rows.map((row) => row.data)[0]);

  it('queues one email per business once for a repeated or concurrent intent, and refuses a changed one', async () => {
    const withEmail = await createTestTenant({ clerkOrgId: 'org_ann_a' });
    const withoutEmail = await createTestTenant({ clerkOrgId: 'org_ann_b' });
    const cancelled = await createTestTenant({ clerkOrgId: 'org_ann_c' });
    await admin.query("UPDATE tenant SET status = 'cancelled' WHERE id = $1", [cancelled.id]);
    await admin.query("INSERT INTO tenant_settings (tenant_id, business_email) VALUES ($1, 'shop@ann.test') ON CONFLICT (tenant_id) DO UPDATE SET business_email = EXCLUDED.business_email", [withEmail.id]);

    const results = await Promise.all([send(), send(), send()]);
    expect(new Set(results.map((result) => result?.id)).size).toBe(1);
    expect(results[0]?.recipient_count).toBe(2);
    const jobs = await admin.query<{ tenant_id: string }>("SELECT tenant_id FROM outbox_event WHERE event_type = 'operator.announcement'");
    expect(jobs.rows.map((row) => row.tenant_id).sort()).toEqual([withEmail.id, withoutEmail.id].sort());
    await expect(send('Different subject')).rejects.toMatchObject({ code: '23505' });
    await expect(asOperator((client) => client.query("SELECT operator_send_announcement('op_1', 'outside-operator-context', 'r', 's', 'b')"), 'account'))
      .rejects.toMatchObject({ code: '42501' });

    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const handler = createOperatorAnnouncementHandler(sender);
    const outbox = await admin.query<{ id: string; tenant_id: string; dedupe_key: string; payload: Record<string, unknown> }>(
      "SELECT id, tenant_id, dedupe_key, payload FROM outbox_event WHERE event_type = 'operator.announcement'",
    );
    for (const row of outbox.rows) {
      await handler({ ...row, event_type: 'operator.announcement', attempts: 0, max_attempts: 8 });
    }
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0]?.[0]).toMatchObject({ to: 'shop@ann.test', subject: 'Maintenance on Sunday' });
    expect((sender.send.mock.calls[0]?.[0] as { text: string }).text).toContain('Drezivo is offline from 1 AM to 2 AM.');

    await admin.query("UPDATE outbox_event SET status = 'succeeded' WHERE event_type = 'operator.announcement'");
    const history = await asOperator(async (client) => (await client.query<{ data: Array<{ subject: string; recipient_count: number; delivered: number }> }>(
      'SELECT operator_announcements(10) AS data',
    )).rows.map((row) => row.data)[0]);
    expect(history).toEqual([expect.objectContaining({ subject: 'Maintenance on Sunday', recipient_count: 2, delivered: 2 })]);
  });
});
