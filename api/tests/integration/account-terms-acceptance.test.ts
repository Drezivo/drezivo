import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { CURRENT_TERMS_VERSION } from '@drezivo/contracts';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);
process.env.DATABASE_POOL_MAX ??= '10';
process.env.CLERK_SECRET_KEY ??= 'test';
process.env.CLERK_PUBLISHABLE_KEY ??= 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET ??= 'test';
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('account Terms acceptance', async () => {
  const { closePool, withGlobalTransaction } = await import('../../src/db/client.js');
  const { ensureAccount } = await import('../../src/modules/accounts/account.repository.js');
  const { getLatestAccountTermsAcceptance } = await import(
    '../../src/modules/accounts/terms-acceptance.repository.js'
  );
  const { acceptCurrentAccountTerms } = await import(
    '../../src/modules/accounts/terms-acceptance.service.js'
  );

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });

  afterAll(async () => {
    await closePool();
  });

  it('records server-timestamped consent once and safely replays an idempotent request', async () => {
    const principalId = 'user_terms_acceptance_replay';
    const request = { terms_version: CURRENT_TERMS_VERSION };
    const input = {
      principalId,
      request,
      idempotencyKey: 'terms-acceptance-replay-001',
      requestId: 'req-terms-acceptance-first',
    };

    const first = await acceptCurrentAccountTerms(input);
    const replay = await acceptCurrentAccountTerms({
      ...input,
      requestId: 'req-terms-acceptance-replay',
    });

    expect(replay).toEqual(first);
    expect(first.data).toMatchObject({ terms_version: CURRENT_TERMS_VERSION });
    expect(Date.parse(first.data.accepted_at)).not.toBeNaN();

    const persisted = await withGlobalTransaction(principalId, async (client) => {
      const rows = await client.query<{ terms_version: string; accepted_at: Date; count: number }>(
        `SELECT terms_version, accepted_at,
                count(*) OVER ()::int AS count
         FROM account_terms_acceptance
         WHERE terms_version = $1`,
        [CURRENT_TERMS_VERSION],
      );
      const audits = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM global_audit_event
         WHERE action = 'account.terms.accepted'`,
      );
      return { row: rows.rows[0], auditCount: audits.rows[0]?.count ?? -1 };
    });
    expect(persisted.row?.count).toBe(1);
    expect(persisted.row?.accepted_at.toISOString()).toBe(first.data.accepted_at);
    expect(persisted.auditCount).toBe(1);
  });

  it('keeps consent isolated by account and prevents runtime updates or deletion', async () => {
    const owner = 'user_terms_acceptance_owner';
    const other = 'user_terms_acceptance_other';
    await acceptCurrentAccountTerms({
      principalId: owner,
      request: { terms_version: CURRENT_TERMS_VERSION },
      idempotencyKey: 'terms-owner-001',
      requestId: 'req-terms-owner',
    });
    await ensureAccount(other);

    await expect(getLatestAccountTermsAcceptance(other)).resolves.toBeNull();
    const permissions = await withGlobalTransaction(owner, async (client) => {
      const result = await client.query<{ can_update: boolean; can_delete: boolean }>(
        `SELECT has_table_privilege(current_user, 'account_terms_acceptance', 'UPDATE') AS can_update,
                has_table_privilege(current_user, 'account_terms_acceptance', 'DELETE') AS can_delete`,
      );
      return result.rows[0];
    });
    expect(permissions).toEqual({ can_update: false, can_delete: false });

    await expect(
      withGlobalTransaction(owner, async (client) => {
        await client.query('UPDATE account_terms_acceptance SET terms_version = $1', ['2026-10-03']);
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withGlobalTransaction(owner, async (client) => {
        await client.query('DELETE FROM account_terms_acceptance');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
