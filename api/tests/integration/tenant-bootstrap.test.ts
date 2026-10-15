import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

import { CURRENT_TERMS_VERSION, storefrontSlug } from '@drezivo/contracts';

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

describe('TBF-030 tenant bootstrap', async () => {
  const { closePool, withGlobalTransaction, withTenantTransaction } =
    await import('../../src/db/client.js');
  const { ensureAccount } = await import('../../src/modules/accounts/account.repository.js');
  const { chooseOnboardingPlan, createOrResumeOnboarding } =
    await import('../../src/modules/onboarding/onboarding.repository.js');
  const { runTenantBootstrap } =
    await import('../../src/modules/onboarding/tenant-bootstrap.persistence.js');
  const { changeTrialPlan } = await import('../../src/modules/billing/billing.service.js');
  const { canonicalRequestHash } = await import('../../src/shared/idempotency.js');

  async function acceptCurrentTermsForTest(principalId: string) {
    const account = await ensureAccount(principalId);
    await withGlobalTransaction(principalId, async (client) => {
      await client.query(
        `INSERT INTO account_terms_acceptance (account_id, terms_version)
         VALUES ($1, $2)
         ON CONFLICT (account_id, terms_version) DO NOTHING`,
        [account.id, CURRENT_TERMS_VERSION],
      );
    });
  }

  async function runAcceptedTenantBootstrap(input: Parameters<typeof runTenantBootstrap>[0]) {
    await acceptCurrentTermsForTest(input.principalId);
    return runTenantBootstrap(input);
  }

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

  it('creates one complete tenant graph and starts a fourteen-day trial', async () => {
    const principalId = 'user_tbf030_success';
    const account = await ensureAccount(principalId);
    const onboarding = await createOrResumeOnboarding(
      account.id,
      'org_tbf030_success',
      principalId,
      {
        organizationName: 'Luna Gowns',
      },
    );
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    const selected = await chooseOnboardingPlan(onboarding.onboarding.id, 'standard', principalId);
    if (selected.kind !== 'updated') throw new Error('expected plan selection');

    const result = await runAcceptedTenantBootstrap({
      principalId,
      clerkOrgId: 'org_tbf030_success',
      onboardingId: onboarding.onboarding.id,
      idempotencyKey: 'bootstrap-success-001',
      payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-success',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected bootstrap success');
    expect(result.body.data).toMatchObject({
      tenant: { name: 'Luna Gowns', slug: 'luna-gowns', currency: 'PHP', timezone: 'Asia/Manila' },
      default_branch: { name: 'Main Branch', code: 'main', is_default: true },
      membership: { role: 'owner', status: 'active' },
      subscription: { plan_code: 'standard', status: 'trialing' },
    });
    expect(result.body.data.branch_grants[0]?.permission_codes).toHaveLength(15);

    const state = await withGlobalTransaction(principalId, async (client) => {
      const accountRow = await client.query<{
        trial_consumed_at: Date | null;
        current_owned_tenant_id: string | null;
      }>('SELECT trial_consumed_at, current_owned_tenant_id FROM account');
      const onboardingRow = await client.query<{
        status: string;
        provisioned_tenant_id: string | null;
      }>('SELECT status, provisioned_tenant_id FROM organization_onboarding WHERE id = $1', [
        onboarding.onboarding.id,
      ]);
      return {
        account: accountRow.rows[0],
        onboarding: onboardingRow.rows[0],
      };
    });
    expect(state.account?.current_owned_tenant_id).toBe(result.body.data.tenant.id);
    expect(state.account?.trial_consumed_at).toBeInstanceOf(Date);
    expect(state.onboarding).toEqual({
      status: 'provisioned',
      provisioned_tenant_id: result.body.data.tenant.id,
    });
    const tenantState = await withTenantTransaction(
      result.body.data.tenant.id,
      principalId,
      async (client) => {
        const subscription = await client.query<{
          current_period_start: Date;
          current_period_end: Date;
          trial_ends_at: Date;
        }>('SELECT current_period_start, current_period_end, trial_ends_at FROM subscription');
        const outbox = await client.query<{ event_type: string }>(
          `SELECT event_type FROM outbox_event
            WHERE event_type = 'tenant.bootstrapped'`,
        );
        const categories = await client.query<{
          name: string;
          status: string;
          display_order: number;
        }>(
          `SELECT name, status, display_order
           FROM category
          ORDER BY display_order ASC, name ASC`,
        );
        const policy = await client.query<{
          version: number;
          rental_rules: Record<string, unknown>;
          deposit_rules: Record<string, unknown>;
          cancellation_rules: Record<string, unknown>;
          delivery_rules: Record<string, unknown>;
          privacy_notice: string;
        }>(
          `SELECT version, rental_rules, deposit_rules, cancellation_rules, delivery_rules, privacy_notice
           FROM policy_snapshot
          ORDER BY version ASC
          LIMIT 1`,
        );
        const fittingSettings = await client.query<{
          enabled: boolean;
          capacity: number;
          duration_minutes: number;
          fee_minor: string;
          currency: string;
          version: number;
        }>(
          `SELECT enabled, capacity, duration_minutes, fee_minor::text, currency, version::integer AS version
           FROM fitting_settings
          LIMIT 1`,
        );
        const businessHours = await client.query<{
          operating_hours: Record<string, unknown>;
          operating_hours_version: string;
        }>(
          `SELECT operating_hours, operating_hours_version::text
           FROM branch
          WHERE is_default
          LIMIT 1`,
        );
        return {
          subscription: subscription.rows[0],
          outbox: outbox.rows[0],
          categories: categories.rows,
          policy: policy.rows[0],
          fittingSettings: fittingSettings.rows[0],
          businessHours: businessHours.rows[0],
        };
      },
    );
    if (!tenantState.subscription) throw new Error('expected subscription');
    expect(
      tenantState.subscription.current_period_end.getTime() -
        tenantState.subscription.current_period_start.getTime(),
    ).toBe(14 * 24 * 60 * 60 * 1000);
    expect(tenantState.subscription.trial_ends_at.getTime()).toBe(
      tenantState.subscription.current_period_end.getTime(),
    );
    expect(tenantState.outbox).toEqual({ event_type: 'tenant.bootstrapped' });
    expect(tenantState.categories).toEqual([
      { name: 'Gowns', status: 'active', display_order: 10 },
      { name: 'Dresses', status: 'active', display_order: 20 },
      { name: 'Filipiniana', status: 'active', display_order: 30 },
      { name: 'Barong', status: 'active', display_order: 40 },
      { name: 'Costumes', status: 'active', display_order: 50 },
      { name: 'Formal Wear', status: 'active', display_order: 60 },
    ]);
    expect(tenantState.policy).toEqual({
      version: 1,
      rental_rules: {},
      deposit_rules: {},
      cancellation_rules: {},
      delivery_rules: {},
      privacy_notice: '',
    });
    expect(tenantState.fittingSettings).toEqual({
      enabled: true,
      capacity: 1,
      duration_minutes: 60,
      fee_minor: '0',
      currency: 'PHP',
      version: 1,
    });
    expect(tenantState.businessHours).toEqual({
      operating_hours: {
        opens_local: '08:00',
        closes_local: '20:00',
        closed_weekdays: [],
      },
      operating_hours_version: '1',
    });
  });

  it('starts the trial with Starter after the owner explicitly selects it', async () => {
    const principalId = 'user_tbf030_starter_bootstrap';
    const account = await ensureAccount(principalId);
    const onboarding = await createOrResumeOnboarding(
      account.id,
      'org_tbf030_starter_bootstrap',
      principalId,
      {
        organizationName: 'Starter Studio',
      },
    );
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    const selected = await chooseOnboardingPlan(onboarding.onboarding.id, 'starter', principalId);
    if (selected.kind !== 'updated') throw new Error('expected Starter plan selection');

    const result = await runAcceptedTenantBootstrap({
      principalId,
      clerkOrgId: 'org_tbf030_starter_bootstrap',
      onboardingId: onboarding.onboarding.id,
      idempotencyKey: 'bootstrap-starter-001',
      payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-starter-bootstrap',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected Starter bootstrap success');
    expect(result.body.data.subscription.plan_code).toBe('starter');
    const entitlements = await withTenantTransaction(
      result.body.data.tenant.id,
      principalId,
      async (client) =>
        client.query<{ capability: string; limit_value: number }>(
          `SELECT e.capability, e.limit_value
           FROM subscription s
           JOIN plan_entitlement e ON e.plan_id = s.plan_id
          WHERE s.tenant_id = $1
          ORDER BY e.capability`,
          [result.body.data.tenant.id],
        ),
    );
    expect(entitlements.rows).toEqual([
      { capability: 'fittings.enabled', limit_value: 1 },
      { capability: 'frontdesk_seats.max', limit_value: 0 },
      { capability: 'physical_assets.max', limit_value: 125 },
      { capability: 'storefront_payments.enabled', limit_value: 1 },
      { capability: 'storefront_reservations.enabled', limit_value: 1 },
      { capability: 'storefront_theme.blush', limit_value: 1 },
      { capability: 'storefront_theme.ivory', limit_value: 1 },
      { capability: 'storefront_theme.noir', limit_value: 1 },
      { capability: 'storefront_theme.sage', limit_value: 1 },
    ]);
  });

  it('rejects trial activation until the current Terms version has been accepted', async () => {
    const principalId = 'user_tbf030_terms_required';
    const account = await ensureAccount(principalId);
    const onboarding = await createOrResumeOnboarding(
      account.id,
      'org_tbf030_terms_required',
      principalId,
      { organizationName: 'Terms Studio' },
    );
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    await chooseOnboardingPlan(onboarding.onboarding.id, 'standard', principalId);

    const result = await runTenantBootstrap({
      principalId,
      clerkOrgId: 'org_tbf030_terms_required',
      onboardingId: onboarding.onboarding.id,
      idempotencyKey: 'bootstrap-terms-required-001',
      payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-terms-required',
    });

    expect(result).toMatchObject({
      kind: 'rejected',
      status: 409,
      body: {
        error: {
          code: 'STATE_CONFLICT',
          message: 'Accept the current Terms of Service before starting your trial.',
        },
      },
    });
    const effects = await withGlobalTransaction(principalId, async (client) => {
      const tenants = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM tenant');
      const accountState = await client.query<{ trial_consumed_at: Date | null }>(
        'SELECT trial_consumed_at FROM account',
      );
      return { tenants: tenants.rows[0]?.count ?? -1, trialConsumedAt: accountState.rows[0]?.trial_consumed_at };
    });
    expect(effects).toEqual({ tenants: 0, trialConsumedAt: null });
  });

  it('creates perpetual Free for an owner whose lifetime trial was already used', async () => {
    const principalId = 'user_tbf030_free_after_trial';
    const account = await ensureAccount(principalId);
    const trialUsedAt = new Date('2026-10-01T12:00:00.000Z');
    await withGlobalTransaction(principalId, async (client) => {
      await client.query(
        'UPDATE account SET trial_consumed_at = $2, updated_at = $2 WHERE id = $1',
        [account.id, trialUsedAt],
      );
    });
    const onboarding = await createOrResumeOnboarding(
      account.id,
      'org_tbf030_free_after_trial',
      principalId,
      { organizationName: 'Luna Gowns Free' },
    );
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    const selected = await chooseOnboardingPlan(onboarding.onboarding.id, 'free', principalId);
    if (selected.kind !== 'updated') throw new Error('expected Free plan selection');
    expect(selected.onboarding.status).toBe('incomplete');

    const result = await runAcceptedTenantBootstrap({
      principalId,
      clerkOrgId: 'org_tbf030_free_after_trial',
      onboardingId: onboarding.onboarding.id,
      idempotencyKey: 'bootstrap-free-after-trial-001',
      payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-free-after-trial',
    });

    expect(result.kind, JSON.stringify(result)).toBe('success');
    if (result.kind !== 'success') throw new Error('expected Free bootstrap success');
    expect(result.body.data.subscription).toMatchObject({ plan_code: 'free', status: 'active', trial_ends_at: null });
    const accountState = await withGlobalTransaction(principalId, async (client) => {
      const state = await client.query<{ trial_consumed_at: Date | null; current_owned_tenant_id: string | null }>(
        'SELECT trial_consumed_at, current_owned_tenant_id FROM account WHERE id = $1',
        [account.id],
      );
      return state.rows[0];
    });
    expect(accountState?.trial_consumed_at?.toISOString()).toBe(trialUsedAt.toISOString());
    expect(accountState?.current_owned_tenant_id).toBe(result.body.data.tenant.id);

    const freeSubscription = await withTenantTransaction(result.body.data.tenant.id, principalId, async (client) => {
      const subscription = await client.query<{ trial_ends_at: Date | null; current_period_end: Date | null; event_type: string }>(
        `SELECT s.trial_ends_at, s.current_period_end, e.event_type
           FROM subscription s
           JOIN subscription_event e ON e.tenant_id = s.tenant_id AND e.subscription_id = s.id
          WHERE s.tenant_id = $1`,
        [result.body.data.tenant.id],
      );
      return subscription.rows[0];
    });
    expect(freeSubscription).toEqual({ trial_ends_at: null, current_period_end: null, event_type: 'free_started' });
    const freeEntitlements = await withTenantTransaction(result.body.data.tenant.id, principalId, async (client) => {
      const state = await client.query<{ capability: string; limit_value: number }>(
        `SELECT e.capability, e.limit_value
           FROM subscription s
           JOIN plan_entitlement e ON e.plan_id = s.plan_id
          WHERE s.tenant_id = $1
          ORDER BY e.capability`,
        [result.body.data.tenant.id],
      );
      return state.rows;
    });
    expect(freeEntitlements).toEqual([
      { capability: 'fittings.enabled', limit_value: 0 },
      { capability: 'frontdesk_seats.max', limit_value: 0 },
      { capability: 'physical_assets.max', limit_value: 20 },
      { capability: 'storefront_payments.enabled', limit_value: 0 },
      { capability: 'storefront_reservations.enabled', limit_value: 0 },
      { capability: 'storefront_theme.blush', limit_value: 0 },
      { capability: 'storefront_theme.ivory', limit_value: 1 },
      { capability: 'storefront_theme.noir', limit_value: 0 },
      { capability: 'storefront_theme.sage', limit_value: 1 },
    ]);
  });

  it('preserves the original bootstrap SQL error and rolls back the partial tenant graph', async () => {
    const principalId = 'user_tbf030_free_bootstrap_failure';
    const account = await ensureAccount(principalId);
    const onboarding = await createOrResumeOnboarding(
      account.id,
      'org_tbf030_free_bootstrap_failure',
      principalId,
      { organizationName: 'Free Failure Studio' },
    );
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    const selected = await chooseOnboardingPlan(onboarding.onboarding.id, 'free', principalId);
    if (selected.kind !== 'updated') throw new Error('expected Free plan selection');

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`
        CREATE OR REPLACE FUNCTION public.test_fail_free_bootstrap_event()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.event_type = 'free_started' THEN
            RAISE EXCEPTION 'forced free bootstrap event failure' USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END;
        $$;
      `);
      await admin.query(`
        CREATE TRIGGER test_fail_free_bootstrap_event
        BEFORE INSERT ON subscription_event
        FOR EACH ROW EXECUTE FUNCTION public.test_fail_free_bootstrap_event();
      `);

      await expect(
        runAcceptedTenantBootstrap({
          principalId,
          clerkOrgId: 'org_tbf030_free_bootstrap_failure',
          onboardingId: onboarding.onboarding.id,
          idempotencyKey: 'bootstrap-free-failure-001',
          payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
          requestId: 'req-tbf030-free-bootstrap-failure',
        }),
      ).rejects.toMatchObject({
        code: 'P0001',
        message: 'forced free bootstrap event failure',
      });
    } finally {
      await admin.query('DROP TRIGGER IF EXISTS test_fail_free_bootstrap_event ON subscription_event');
      await admin.query('DROP FUNCTION IF EXISTS public.test_fail_free_bootstrap_event()');
      await admin.end();
    }

    const effects = await withGlobalTransaction(principalId, async (client) => {
      const tenants = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM tenant WHERE clerk_org_id = $1',
        ['org_tbf030_free_bootstrap_failure'],
      );
      const accountState = await client.query<{ current_owned_tenant_id: string | null }>(
        'SELECT current_owned_tenant_id FROM account WHERE id = $1',
        [account.id],
      );
      const onboardingState = await client.query<{ status: string }>(
        'SELECT status FROM organization_onboarding WHERE id = $1',
        [onboarding.onboarding.id],
      );
      return {
        tenantCount: tenants.rows[0]?.count ?? -1,
        currentOwnedTenantId: accountState.rows[0]?.current_owned_tenant_id ?? null,
        onboardingStatus: onboardingState.rows[0]?.status,
      };
    });
    expect(effects).toEqual({
      tenantCount: 0,
      currentOwnedTenantId: null,
      onboardingStatus: 'incomplete',
    });
  });

  it('starts the paid trial from Free once and consumes eligibility in the same tenant-safe transaction', async () => {
    const principalId = 'user_tbf030_free_upgrade_trial';
    const account = await ensureAccount(principalId);
    const onboarding = await createOrResumeOnboarding(account.id, 'org_tbf030_free_upgrade_trial', principalId, {
      organizationName: 'Luna Gowns Upgrade',
    });
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    const selected = await chooseOnboardingPlan(onboarding.onboarding.id, 'free', principalId);
    if (selected.kind !== 'updated') throw new Error('expected Free plan selection');
    const bootstrapped = await runAcceptedTenantBootstrap({
      principalId,
      clerkOrgId: 'org_tbf030_free_upgrade_trial',
      onboardingId: onboarding.onboarding.id,
      idempotencyKey: 'bootstrap-free-upgrade-001',
      payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-free-upgrade',
    });
    if (bootstrapped.kind !== 'success') throw new Error('expected Free bootstrap success');

    const input = {
      tenantId: bootstrapped.body.data.tenant.id,
      membershipId: bootstrapped.body.data.membership.id,
      principalId,
      requestId: 'req-tbf030-free-upgrade-trial',
      idempotencyKey: 'free-upgrade-trial-once',
      request: { plan_code: 'starter' as const },
    };
    const first = await changeTrialPlan(input);
    const replay = await changeTrialPlan(input);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(replay).toEqual(first);

    const accountState = await withGlobalTransaction(principalId, async (client) => {
      const state = await client.query<{ trial_consumed_at: Date | null }>(
        'SELECT trial_consumed_at FROM account WHERE id = $1',
        [account.id],
      );
      return state.rows[0];
    });
    expect(accountState?.trial_consumed_at).toBeInstanceOf(Date);
    const paidSubscription = await withTenantTransaction(input.tenantId, principalId, async (client) => {
      const state = await client.query<{
        plan_code: string;
        status: string;
        trial_ends_at: Date | null;
        current_period_start: Date;
        current_period_end: Date | null;
        change_count: number;
      }>(
        `SELECT p.code AS plan_code, s.status, s.trial_ends_at, s.current_period_start,
                s.current_period_end,
                (SELECT count(*)::int FROM subscription_event e
                  WHERE e.tenant_id = s.tenant_id AND e.event_type = 'plan_changed') AS change_count
           FROM subscription s
           JOIN plan p ON p.id = s.plan_id
          WHERE s.tenant_id = $1`,
        [input.tenantId],
      );
      return state.rows[0];
    });
    expect(paidSubscription?.plan_code).toBe('starter');
    expect(paidSubscription?.status).toBe('trialing');
    expect(paidSubscription?.change_count).toBe(1);
    if (!paidSubscription?.trial_ends_at || !paidSubscription.current_period_end) {
      throw new Error('Expected the paid upgrade to create a bounded trial period.');
    }
    expect(paidSubscription.trial_ends_at.getTime()).toBe(paidSubscription.current_period_end.getTime());
    expect(paidSubscription.current_period_end.getTime() - paidSubscription.current_period_start.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
  });

  it('replays one committed graph for concurrent same-key requests', async () => {
    const principalId = 'user_tbf030_concurrent';
    const account = await ensureAccount(principalId);
    const onboarding = await createOrResumeOnboarding(
      account.id,
      'org_tbf030_concurrent',
      principalId,
      {
        organizationName: 'Concurrent Studio',
      },
    );
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    await chooseOnboardingPlan(onboarding.onboarding.id, 'standard', principalId);
    const input = {
      principalId,
      clerkOrgId: 'org_tbf030_concurrent',
      onboardingId: onboarding.onboarding.id,
      idempotencyKey: 'bootstrap-concurrent-001',
      payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-concurrent',
    };

    const results = await Promise.all([
      runAcceptedTenantBootstrap(input),
      runAcceptedTenantBootstrap(input),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(['replayed', 'success']);
    const tenantId = results.find((result) => result.kind === 'success')?.body.data.tenant.id;
    if (!tenantId) throw new Error('expected successful bootstrap');
    const counts = await withTenantTransaction(tenantId, principalId, async (client) => {
      const tenant = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM tenant',
      );
      const memberships = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM membership',
      );
      const subscriptions = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM subscription',
      );
      const categories = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM category',
      );
      const paymentMethods = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM payment_method',
      );
      return {
        tenants: tenant.rows[0]?.count ?? -1,
        memberships: memberships.rows[0]?.count ?? -1,
        subscriptions: subscriptions.rows[0]?.count ?? -1,
        categories: categories.rows[0]?.count ?? -1,
        paymentMethods: paymentMethods.rows[0]?.count ?? -1,
      };
    });
    expect(counts).toEqual({
      tenants: 1,
      memberships: 1,
      subscriptions: 1,
      categories: 6,
      paymentMethods: 2,
    });
  });

  it('rejects a mismatched organization without creating tenant effects', async () => {
    const principalId = 'user_tbf030_mismatch';
    const account = await ensureAccount(principalId);
    const onboarding = await createOrResumeOnboarding(
      account.id,
      'org_tbf030_expected',
      principalId,
    );
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    await chooseOnboardingPlan(onboarding.onboarding.id, 'standard', principalId);

    const result = await runAcceptedTenantBootstrap({
      principalId,
      clerkOrgId: 'org_tbf030_other',
      onboardingId: onboarding.onboarding.id,
      idempotencyKey: 'bootstrap-mismatch-001',
      payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-mismatch',
    });
    expect(result).toMatchObject({ kind: 'rejected', status: 404 });
    const count = await withGlobalTransaction(principalId, async (client) => {
      const tenants = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM tenant',
      );
      return tenants.rows[0]?.count ?? -1;
    });
    expect(count).toBe(0);
  });

  it('generates storefront-contract-valid slugs for reserved, short, and long business names', async () => {
    const cases = [
      { key: 'reserved', organizationName: 'Drezivo', expectedPrefix: 'drezivo-' },
      { key: 'short', organizationName: 'X', expectedPrefix: 'x-' },
      { key: 'long', organizationName: 'A'.repeat(80), expectedPrefix: null },
    ] as const;

    for (const testCase of cases) {
      const principalId = `user_tbf030_${testCase.key}`;
      const account = await ensureAccount(principalId);
      const onboarding = await createOrResumeOnboarding(
        account.id,
        `org_tbf030_${testCase.key}`,
        principalId,
        { organizationName: testCase.organizationName },
      );
      if (onboarding.kind !== 'created')
        throw new Error(`expected ${testCase.key} onboarding creation`);
      await chooseOnboardingPlan(onboarding.onboarding.id, 'standard', principalId);

      const result = await runAcceptedTenantBootstrap({
        principalId,
        clerkOrgId: `org_tbf030_${testCase.key}`,
        onboardingId: onboarding.onboarding.id,
        idempotencyKey: `bootstrap-${testCase.key}-001`,
        payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
        requestId: `req-tbf030-${testCase.key}`,
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(`expected ${testCase.key} bootstrap success`);
      const slug = result.body.data.tenant.slug;
      expect(storefrontSlug.safeParse(slug).success).toBe(true);
      if (testCase.expectedPrefix) expect(slug).toMatch(new RegExp(`^${testCase.expectedPrefix}`));
      if (testCase.key === 'long') expect(slug.length).toBeLessThanOrEqual(50);
    }
  });

  it('generates a storefront slug and deterministically suffixes a same-name collision', async () => {
    const firstPrincipal = 'user_tbf030_slug_first';
    const firstAccount = await ensureAccount(firstPrincipal);
    const firstOnboarding = await createOrResumeOnboarding(
      firstAccount.id,
      'org_tbf030_slug_first',
      firstPrincipal,
      { organizationName: 'Shared Studio' },
    );
    if (firstOnboarding.kind !== 'created') throw new Error('expected first onboarding creation');
    await chooseOnboardingPlan(firstOnboarding.onboarding.id, 'standard', firstPrincipal);
    const first = await runAcceptedTenantBootstrap({
      principalId: firstPrincipal,
      clerkOrgId: 'org_tbf030_slug_first',
      onboardingId: firstOnboarding.onboarding.id,
      idempotencyKey: 'bootstrap-slug-first-001',
      payloadHash: canonicalRequestHash({ onboarding_id: firstOnboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-slug-first',
    });
    expect(first.kind).toBe('success');
    if (first.kind !== 'success') throw new Error('expected first bootstrap success');
    expect(first.body.data.tenant.slug).toBe('shared-studio');

    const secondPrincipal = 'user_tbf030_slug_second';
    const secondAccount = await ensureAccount(secondPrincipal);
    const secondOnboarding = await createOrResumeOnboarding(
      secondAccount.id,
      'org_tbf030_slug_second',
      secondPrincipal,
      { organizationName: 'Shared Studio' },
    );
    if (secondOnboarding.kind !== 'created') throw new Error('expected second onboarding creation');
    await chooseOnboardingPlan(secondOnboarding.onboarding.id, 'standard', secondPrincipal);
    const second = await runAcceptedTenantBootstrap({
      principalId: secondPrincipal,
      clerkOrgId: 'org_tbf030_slug_second',
      onboardingId: secondOnboarding.onboarding.id,
      idempotencyKey: 'bootstrap-slug-second-001',
      payloadHash: canonicalRequestHash({
        onboarding_id: secondOnboarding.onboarding.id,
        body: {},
      }),
      requestId: 'req-tbf030-slug-second',
    });
    expect(second.kind).toBe('success');
    if (second.kind !== 'success') throw new Error('expected second bootstrap success');
    const suffix = createHash('sha256')
      .update(secondOnboarding.onboarding.id)
      .digest('hex')
      .slice(0, 12);
    expect(second.body.data.tenant.slug).toBe(`shared-studio-${suffix}`);
  });
});
