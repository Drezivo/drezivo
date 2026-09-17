import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * TBF-010 — minimal global account persistence. The evidence the checklist demands:
 * "Concurrent account/trial and owned-tenant tests produce one winner", plus the isolation
 * property the account model promises (many Front Desk memberships, one current owned tenant).
 *
 * Env-first, mirroring src/__tests__/app.test.ts: load .env/.env.test, then pin the
 * application pool to the LOCAL test database authenticated as the non-superuser `drezivo_app`
 * role — BEFORE dynamically importing anything that constructs config or the pool. RLS from
 * migration 0008 therefore binds for real in every query below.
 */
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

describe('TBF-010 account persistence', async () => {
  const { closePool, withGlobalTransaction, withTenantTransaction } = await import(
    '../../src/db/client.js'
  );
  const {
    claimOwnedTenant,
    consumeTrial,
    ensureAccount,
    getAccountByClerkUserId,
    releaseOwnedTenant,
  } = await import('../../src/modules/accounts/account.repository.js');
  const { createTestMembership, createTestTenant } = await import('./helpers/factories.js');

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

  it('ensureAccount is idempotent per Clerk user', async () => {
    const first = await ensureAccount('user_idem');
    const second = await ensureAccount('user_idem');
    await ensureAccount('user_other');

    expect(second.id).toBe(first.id);
    const fetched = await getAccountByClerkUserId('user_idem');
    expect(fetched?.id).toBe(first.id);
    expect(fetched?.trialConsumedAt).toBeNull();
    expect(fetched?.currentOwnedTenantId).toBeNull();
    const other = await getAccountByClerkUserId('user_other');
    expect(other?.id).not.toBe(first.id);
  });

  it('concurrent account creation returns one account record', async () => {
    const accounts = await Promise.all([
      ensureAccount('user_account_create_race'),
      ensureAccount('user_account_create_race'),
    ]);

    expect(accounts[0].id).toBe(accounts[1].id);
  });

  it('isolates account records and account mutations to the transaction principal', async () => {
    const owner = await ensureAccount('user_account_owner');
    await ensureAccount('user_account_other');
    const tenant = await createTestTenant();

    const visibleToOther = await withGlobalTransaction('user_account_other', async (client) => {
      const result = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM account WHERE id = $1',
        [owner.id],
      );
      return result.rows[0]?.count ?? -1;
    });
    expect(visibleToOther).toBe(0);

    expect(await consumeTrial(owner.id, 'user_account_other')).toBe('not_found_or_forbidden');
    expect(await claimOwnedTenant(owner.id, tenant.id, 'user_account_other')).toBe(
      'not_found_or_forbidden',
    );
    expect(await releaseOwnedTenant(owner.id, tenant.id, 'user_account_other')).toBe(false);

    const ownerAfterForeignAttempts = await getAccountByClerkUserId('user_account_owner');
    expect(ownerAfterForeignAttempts?.trialConsumedAt).toBeNull();
    expect(ownerAfterForeignAttempts?.currentOwnedTenantId).toBeNull();
  });

  it('concurrent trial consumption produces exactly one winner', async () => {
    const account = await ensureAccount('user_trial_race');

    const results = await Promise.all([
      consumeTrial(account.id, 'user_trial_race'),
      consumeTrial(account.id, 'user_trial_race'),
    ]);

    expect(results.filter((r) => r === 'consumed')).toHaveLength(1);
    expect(results.filter((r) => r === 'already_consumed')).toHaveLength(1);

    const after = await getAccountByClerkUserId('user_trial_race');
    expect(after?.trialConsumedAt).not.toBeNull();

    // A later, sequential attempt can never re-consume the lifetime trial.
    const third = await consumeTrial(account.id, 'user_trial_race');
    expect(third).toBe('already_consumed');
  });

  it('the owned-tenant slot admits exactly one claim per account', async () => {
    const account = await ensureAccount('user_slot_race');
    const firstTenant = await createTestTenant();
    const secondTenant = await createTestTenant();

    expect(await claimOwnedTenant(account.id, firstTenant.id, 'user_slot_race')).toBe('claimed');
    expect(await claimOwnedTenant(account.id, secondTenant.id, 'user_slot_race')).toBe(
      'slot_occupied',
    );

    // Re-claiming the tenant this account already owns is an idempotent replay, not a conflict.
    expect(await claimOwnedTenant(account.id, firstTenant.id, 'user_slot_race')).toBe('claimed');
  });

  it('concurrent slot claims by the same account produce one winner', async () => {
    const account = await ensureAccount('user_slot_concurrent');
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();

    const results = await Promise.all([
      claimOwnedTenant(account.id, tenantA.id, 'user_slot_concurrent'),
      claimOwnedTenant(account.id, tenantB.id, 'user_slot_concurrent'),
    ]);

    expect(results.filter((r) => r === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r === 'slot_occupied')).toHaveLength(1);
  });

  it('a second account cannot claim a tenant the first account owns', async () => {
    const owner = await ensureAccount('user_owner_a');
    const rival = await ensureAccount('user_owner_b');
    const tenant = await createTestTenant();

    expect(await claimOwnedTenant(owner.id, tenant.id, 'user_owner_a')).toBe('claimed');
    expect(await claimOwnedTenant(rival.id, tenant.id, 'user_owner_b')).toBe(
      'tenant_already_owned',
    );
  });

  it('releaseOwnedTenant releases only the matching claim and is idempotent', async () => {
    const account = await ensureAccount('user_release');
    const owned = await createTestTenant();
    const foreign = await createTestTenant();
    await claimOwnedTenant(account.id, owned.id, 'user_release');

    // Releasing a tenant this account does not own must not clear its actual claim.
    expect(await releaseOwnedTenant(account.id, foreign.id, 'user_release')).toBe(false);
    const stillOwned = await getAccountByClerkUserId('user_release');
    expect(stillOwned?.currentOwnedTenantId).toBe(owned.id);

    expect(await releaseOwnedTenant(account.id, owned.id, 'user_release')).toBe(true);
    expect(await releaseOwnedTenant(account.id, owned.id, 'user_release')).toBe(false);
    const released = await getAccountByClerkUserId('user_release');
    expect(released?.currentOwnedTenantId).toBeNull();
  });

  it('many Front Desk memberships never touch the one-owned-tenant state', async () => {
    const account = await ensureAccount('user_multi_membership');
    const staffTenantA = await createTestTenant();
    const staffTenantB = await createTestTenant();
    const ownedTenant = await createTestTenant();

    await createTestMembership(staffTenantA.id, 'user_multi_membership', 'frontdesk');
    await createTestMembership(staffTenantB.id, 'user_multi_membership', 'frontdesk');
    expect(await claimOwnedTenant(account.id, ownedTenant.id, 'user_multi_membership')).toBe(
      'claimed',
    );

    const after = await getAccountByClerkUserId('user_multi_membership');
    expect(after?.currentOwnedTenantId).toBe(ownedTenant.id);
  });

  it('the pre-tenant context cannot read tenant-owned rows (fail closed)', async () => {
    const tenant = await createTestTenant();
    await createTestMembership(tenant.id, 'user_fail_closed', 'frontdesk');

    const globalCount = await withGlobalTransaction('user_fail_closed', async (client) => {
      const result = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM membership',
      );
      return result.rows[0]?.count ?? -1;
    });
    expect(globalCount).toBe(0);

    // The same rows are visible through the tenant-scoped path — proving the zero above is
    // RLS fail-closed behavior, not "no data existed".
    const tenantCount = await withTenantTransaction(tenant.id, 'user_fail_closed', async (client) => {
      const result = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM membership',
      );
      return result.rows[0]?.count ?? -1;
    });
    expect(tenantCount).toBe(1);
  });
});
