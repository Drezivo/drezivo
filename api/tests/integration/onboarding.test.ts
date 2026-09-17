import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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
process.env.AWS_REGION ??= 'test';
process.env.S3_BUCKET_PRIVATE ??= 'private';
process.env.S3_BUCKET_PUBLIC ??= 'public';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

describe('TBF-011 onboarding persistence', async () => {
  const { closePool, withGlobalTransaction, withOperatorGlobalTransaction, withTenantTransaction } =
    await import('../../src/db/client.js');
  const { consumeTrial, ensureAccount, getAccountByClerkUserId } = await import(
    '../../src/modules/accounts/account.repository.js'
  );
  const {
    abandonOnboarding,
    chooseOnboardingPlan,
    createOrResumeOnboarding,
    getCurrentOwnerOnboarding,
    getOwnerOnboarding,
    listOwnerPaymentStatuses,
    recordVerifiedOnboardingPayment,
  } = await import('../../src/modules/onboarding/onboarding.repository.js');
  const { createTestTenant } = await import('./helpers/factories.js');

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

  it('creates one row when the same onboarding is requested concurrently', async () => {
    const account = await ensureAccount('user_onboarding_same');
    const results = await Promise.all([
      createOrResumeOnboarding(account.id, 'org_same', 'user_onboarding_same'),
      createOrResumeOnboarding(account.id, 'org_same', 'user_onboarding_same'),
    ]);

    expect(results.filter((result) => result.kind === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'existing')).toHaveLength(1);
    const current = await getCurrentOwnerOnboarding('user_onboarding_same');
    expect(current?.status).toBe('incomplete');
  });

  it('allows only one active onboarding for an account and rejects a foreign organization conflict', async () => {
    const account = await ensureAccount('user_onboarding_compete');
    const [first, second] = await Promise.all([
      createOrResumeOnboarding(account.id, 'org_compete_a', 'user_onboarding_compete'),
      createOrResumeOnboarding(account.id, 'org_compete_b', 'user_onboarding_compete'),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['active_exists', 'created']);

    const other = await ensureAccount('user_onboarding_other');
    expect(await createOrResumeOnboarding(other.id, 'org_compete_a', 'user_onboarding_other')).toEqual({
      kind: 'organization_conflict',
    });
  });

  it('is owner-isolated and unavailable in tenant-scoped transactions', async () => {
    const owner = await ensureAccount('user_onboarding_owner');
    const created = await createOrResumeOnboarding(owner.id, 'org_isolated', 'user_onboarding_owner');
    if (created.kind !== 'created') throw new Error('expected onboarding creation');

    expect(await getCurrentOwnerOnboarding('user_onboarding_other')).toBeNull();
    const globalForeignRead = await withGlobalTransaction('user_onboarding_other', async (client) => {
      const result = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM organization_onboarding',
      );
      return result.rows[0]?.count ?? -1;
    });
    expect(globalForeignRead).toBe(0);

    const tenant = await createTestTenant();
    const tenantRead = await withTenantTransaction(tenant.id, 'user_onboarding_owner', async (client) => {
      const result = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM organization_onboarding',
      );
      return result.rows[0]?.count ?? -1;
    });
    expect(tenantRead).toBe(0);
  });

  it('abandons incomplete onboarding, preserves it, and permits a replacement', async () => {
    const account = await ensureAccount('user_onboarding_abandon');
    const first = await createOrResumeOnboarding(account.id, 'org_abandon_old', 'user_onboarding_abandon');
    if (first.kind !== 'created') throw new Error('expected onboarding creation');

    expect((await abandonOnboarding(first.onboarding.id, 'user_onboarding_abandon')).kind).toBe('abandoned');
    expect((await abandonOnboarding(first.onboarding.id, 'user_onboarding_abandon')).kind).toBe(
      'already_abandoned',
    );
    const replacement = await createOrResumeOnboarding(
      account.id,
      'org_abandon_new',
      'user_onboarding_abandon',
    );
    expect(replacement.kind).toBe('created');
    expect((await getOwnerOnboarding(first.onboarding.id, 'user_onboarding_abandon'))?.status).toBe(
      'abandoned',
    );
  });

  it('keeps trial-eligible plan selection incomplete and consumed trials payment-pending', async () => {
    const eligible = await ensureAccount('user_onboarding_trial_eligible');
    const eligibleOnboarding = await createOrResumeOnboarding(
      eligible.id,
      'org_trial_eligible',
      'user_onboarding_trial_eligible',
    );
    if (eligibleOnboarding.kind !== 'created') throw new Error('expected onboarding creation');
    const eligibleChoice = await chooseOnboardingPlan(
      eligibleOnboarding.onboarding.id,
      'professional',
      'user_onboarding_trial_eligible',
    );
    expect(eligibleChoice.kind).toBe('updated');
    expect(eligibleChoice.kind === 'updated' && eligibleChoice.onboarding.status).toBe('incomplete');

    const consumed = await ensureAccount('user_onboarding_trial_consumed');
    expect(await consumeTrial(consumed.id, 'user_onboarding_trial_consumed')).toBe('consumed');
    const pending = await createOrResumeOnboarding(
      consumed.id,
      'org_trial_consumed',
      'user_onboarding_trial_consumed',
    );
    if (pending.kind !== 'created') throw new Error('expected onboarding creation');
    const pendingChoice = await chooseOnboardingPlan(
      pending.onboarding.id,
      'starter',
      'user_onboarding_trial_consumed',
    );
    expect(pendingChoice.kind).toBe('updated');
    expect(pendingChoice.kind === 'updated' && pendingChoice.onboarding.status).toBe('payment_pending');
    expect(pendingChoice.kind === 'updated' && pendingChoice.onboarding.isTrialEligible).toBe(false);
  });

  it('serializes concurrent plan changes and allows pending abandonment', async () => {
    const account = await ensureAccount('user_onboarding_plan_race');
    await consumeTrial(account.id, 'user_onboarding_plan_race');
    const created = await createOrResumeOnboarding(account.id, 'org_plan_race', 'user_onboarding_plan_race');
    if (created.kind !== 'created') throw new Error('expected onboarding creation');

    const results = await Promise.all([
      chooseOnboardingPlan(created.onboarding.id, 'starter', 'user_onboarding_plan_race'),
      chooseOnboardingPlan(created.onboarding.id, 'business', 'user_onboarding_plan_race'),
    ]);
    expect(results.every((result) => result.kind === 'updated')).toBe(true);
    const abandoned = await abandonOnboarding(created.onboarding.id, 'user_onboarding_plan_race');
    expect(abandoned.kind).toBe('abandoned');
    expect((await getCurrentOwnerOnboarding('user_onboarding_plan_race'))).toBeNull();
  });

  it('records verified payment immutably and makes business-key retries safe', async () => {
    const account = await ensureAccount('user_onboarding_payment');
    await consumeTrial(account.id, 'user_onboarding_payment');
    const created = await createOrResumeOnboarding(account.id, 'org_payment', 'user_onboarding_payment');
    if (created.kind !== 'created') throw new Error('expected onboarding creation');
    const selected = await chooseOnboardingPlan(created.onboarding.id, 'starter', 'user_onboarding_payment');
    if (selected.kind !== 'updated') throw new Error('expected plan selection');

    const evidence = {
      amountMinor: '49900',
      currency: 'PHP' as const,
      paymentReference: 'GCASH-123',
      businessKey: 'payment-event-123',
    };
    const recorded = await recordVerifiedOnboardingPayment(
      created.onboarding.id,
      'operator_one',
      evidence,
    );
    expect(recorded.kind).toBe('recorded');
    const replay = await recordVerifiedOnboardingPayment(
      created.onboarding.id,
      'operator_one',
      evidence,
    );
    expect(replay.kind).toBe('replayed');
    expect(
      await recordVerifiedOnboardingPayment(created.onboarding.id, 'operator_one', {
        ...evidence,
        paymentReference: 'DIFFERENT',
      }),
    ).toEqual({ kind: 'business_key_conflict' });

    const ownerView = await listOwnerPaymentStatuses(created.onboarding.id, 'user_onboarding_payment');
    expect(ownerView).toHaveLength(1);
    expect(Object.keys(ownerView[0] ?? {}).sort()).toEqual(['createdAt', 'id', 'status']);
    expect(ownerView[0]?.status).toBe('verified');

    await expect(
      withOperatorGlobalTransaction('operator_one', async (client) => {
        await client.query('UPDATE onboarding_payment_verification SET payment_reference = $1', ['nope']);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('allows payment-pending abandonment without creating a tenant or subscription side effect', async () => {
    const account = await ensureAccount('user_onboarding_no_side_effect');
    await consumeTrial(account.id, 'user_onboarding_no_side_effect');
    const trialConsumedAt = (await getAccountByClerkUserId('user_onboarding_no_side_effect'))
      ?.trialConsumedAt;
    const created = await createOrResumeOnboarding(
      account.id,
      'org_no_side_effect',
      'user_onboarding_no_side_effect',
    );
    if (created.kind !== 'created') throw new Error('expected onboarding creation');
    const selected = await chooseOnboardingPlan(
      created.onboarding.id,
      'business',
      'user_onboarding_no_side_effect',
    );
    if (selected.kind !== 'updated') throw new Error('expected plan selection');
    expect((await abandonOnboarding(created.onboarding.id, 'user_onboarding_no_side_effect')).kind).toBe(
      'abandoned',
    );

    const state = await withGlobalTransaction('user_onboarding_no_side_effect', async (client) => {
      const accountResult = await client.query<{
        current_owned_tenant_id: string | null;
        trial_consumed_at: Date | null;
      }>(
        'SELECT current_owned_tenant_id, trial_consumed_at FROM account',
      );
      const onboardingResult = await client.query<{ provisioned_tenant_id: string | null; status: string }>(
        'SELECT provisioned_tenant_id, status FROM organization_onboarding WHERE id = $1',
        [created.onboarding.id],
      );
      const subscriptionResult = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM subscription',
      );
      const tenantResult = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM tenant',
      );
      const branchResult = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM branch',
      );
      return {
        ownedTenant: accountResult.rows[0]?.current_owned_tenant_id,
        trialConsumedAt: accountResult.rows[0]?.trial_consumed_at,
        onboarding: onboardingResult.rows[0],
        subscriptions: subscriptionResult.rows[0]?.count ?? -1,
        tenants: tenantResult.rows[0]?.count ?? -1,
        branches: branchResult.rows[0]?.count ?? -1,
      };
    });
    expect(state.ownedTenant).toBeNull();
    expect(state.trialConsumedAt).toEqual(trialConsumedAt);
    expect(state.onboarding).toEqual({ provisioned_tenant_id: null, status: 'abandoned' });
    expect(state.subscriptions).toBe(0);
    expect(state.tenants).toBe(0);
    expect(state.branches).toBe(0);
  });
});
