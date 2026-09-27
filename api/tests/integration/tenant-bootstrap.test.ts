import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

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
  const { closePool, withGlobalTransaction, withTenantTransaction } = await import('../../src/db/client.js');
  const { ensureAccount } = await import('../../src/modules/accounts/account.repository.js');
  const { chooseOnboardingPlan, createOrResumeOnboarding } = await import(
    '../../src/modules/onboarding/onboarding.repository.js'
  );
  const { runTenantBootstrap } = await import('../../src/modules/onboarding/tenant-bootstrap.persistence.js');
  const { canonicalRequestHash } = await import('../../src/shared/idempotency.js');

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
    const onboarding = await createOrResumeOnboarding(account.id, 'org_tbf030_success', principalId, {
      organizationName: 'Luna Gowns',
    });
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    const selected = await chooseOnboardingPlan(onboarding.onboarding.id, 'professional', principalId);
    if (selected.kind !== 'updated') throw new Error('expected plan selection');

    const result = await runTenantBootstrap({
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
      subscription: { plan_code: 'professional', status: 'trialing' },
    });
    expect(result.body.data.branch_grants[0]?.permission_codes).toHaveLength(15);

    const state = await withGlobalTransaction(principalId, async (client) => {
      const accountRow = await client.query<{ trial_consumed_at: Date | null; current_owned_tenant_id: string | null }>(
        'SELECT trial_consumed_at, current_owned_tenant_id FROM account',
      );
      const onboardingRow = await client.query<{ status: string; provisioned_tenant_id: string | null }>(
        'SELECT status, provisioned_tenant_id FROM organization_onboarding WHERE id = $1',
        [onboarding.onboarding.id],
      );
      return {
        account: accountRow.rows[0],
        onboarding: onboardingRow.rows[0],
      };
    });
    expect(state.account?.current_owned_tenant_id).toBe(result.body.data.tenant.id);
    expect(state.account?.trial_consumed_at).toBeInstanceOf(Date);
    expect(state.onboarding).toEqual({ status: 'provisioned', provisioned_tenant_id: result.body.data.tenant.id });
    const tenantState = await withTenantTransaction(result.body.data.tenant.id, principalId, async (client) => {
      const subscription = await client.query<{ current_period_start: Date; current_period_end: Date; trial_ends_at: Date }>(
        'SELECT current_period_start, current_period_end, trial_ends_at FROM subscription',
      );
      const outbox = await client.query<{ event_type: string }>('SELECT event_type FROM outbox_event');
      const categories = await client.query<{ name: string; status: string; display_order: number }>(
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
      const fittingHours = await client.query<{
        weekday: number;
        starts_local: string;
        ends_local: string;
      }>(
        `SELECT weekday, to_char(starts_local, 'HH24:MI') AS starts_local,
                to_char(ends_local, 'HH24:MI') AS ends_local
           FROM fitting_hours
          ORDER BY weekday ASC, starts_local ASC`,
      );
      return {
        subscription: subscription.rows[0],
        outbox: outbox.rows[0],
        categories: categories.rows,
        policy: policy.rows[0],
        fittingSettings: fittingSettings.rows[0],
        fittingHours: fittingHours.rows,
      };
    });
    if (!tenantState.subscription) throw new Error('expected subscription');
    expect(tenantState.subscription.current_period_end.getTime() - tenantState.subscription.current_period_start.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
    expect(tenantState.subscription.trial_ends_at.getTime()).toBe(tenantState.subscription.current_period_end.getTime());
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
    expect(tenantState.fittingHours).toEqual([
      { weekday: 1, starts_local: '08:00', ends_local: '20:00' },
      { weekday: 2, starts_local: '08:00', ends_local: '20:00' },
      { weekday: 3, starts_local: '08:00', ends_local: '20:00' },
      { weekday: 4, starts_local: '08:00', ends_local: '20:00' },
      { weekday: 5, starts_local: '08:00', ends_local: '20:00' },
      { weekday: 6, starts_local: '08:00', ends_local: '20:00' },
    ]);
  });

  it('replays one committed graph for concurrent same-key requests', async () => {
    const principalId = 'user_tbf030_concurrent';
    const account = await ensureAccount(principalId);
    const onboarding = await createOrResumeOnboarding(account.id, 'org_tbf030_concurrent', principalId, {
      organizationName: 'Concurrent Studio',
    });
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    await chooseOnboardingPlan(onboarding.onboarding.id, 'starter', principalId);
    const input = {
      principalId,
      clerkOrgId: 'org_tbf030_concurrent',
      onboardingId: onboarding.onboarding.id,
      idempotencyKey: 'bootstrap-concurrent-001',
      payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-concurrent',
    };

    const results = await Promise.all([runTenantBootstrap(input), runTenantBootstrap(input)]);
    expect(results.map((result) => result.kind).sort()).toEqual(['replayed', 'success']);
    const tenantId = results.find((result) => result.kind === 'success')?.body.data.tenant.id;
    if (!tenantId) throw new Error('expected successful bootstrap');
    const counts = await withTenantTransaction(tenantId, principalId, async (client) => {
      const tenant = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM tenant');
      const memberships = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM membership');
      const subscriptions = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM subscription');
      const categories = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM category');
      const paymentMethods = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM payment_method');
      return {
        tenants: tenant.rows[0]?.count ?? -1,
        memberships: memberships.rows[0]?.count ?? -1,
        subscriptions: subscriptions.rows[0]?.count ?? -1,
        categories: categories.rows[0]?.count ?? -1,
        paymentMethods: paymentMethods.rows[0]?.count ?? -1,
      };
    });
    expect(counts).toEqual({ tenants: 1, memberships: 1, subscriptions: 1, categories: 6, paymentMethods: 2 });
  });

  it('rejects a mismatched organization without creating tenant effects', async () => {
    const principalId = 'user_tbf030_mismatch';
    const account = await ensureAccount(principalId);
    const onboarding = await createOrResumeOnboarding(account.id, 'org_tbf030_expected', principalId);
    if (onboarding.kind !== 'created') throw new Error('expected onboarding creation');
    await chooseOnboardingPlan(onboarding.onboarding.id, 'starter', principalId);

    const result = await runTenantBootstrap({
      principalId,
      clerkOrgId: 'org_tbf030_other',
      onboardingId: onboarding.onboarding.id,
      idempotencyKey: 'bootstrap-mismatch-001',
      payloadHash: canonicalRequestHash({ onboarding_id: onboarding.onboarding.id, body: {} }),
      requestId: 'req-tbf030-mismatch',
    });
    expect(result).toMatchObject({ kind: 'rejected', status: 404 });
    const count = await withGlobalTransaction(principalId, async (client) => {
      const tenants = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM tenant');
      return tenants.rows[0]?.count ?? -1;
    });
    expect(count).toBe(0);
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
    await chooseOnboardingPlan(firstOnboarding.onboarding.id, 'starter', firstPrincipal);
    const first = await runTenantBootstrap({
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
    await chooseOnboardingPlan(secondOnboarding.onboarding.id, 'starter', secondPrincipal);
    const second = await runTenantBootstrap({
      principalId: secondPrincipal,
      clerkOrgId: 'org_tbf030_slug_second',
      onboardingId: secondOnboarding.onboarding.id,
      idempotencyKey: 'bootstrap-slug-second-001',
      payloadHash: canonicalRequestHash({ onboarding_id: secondOnboarding.onboarding.id, body: {} }),
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
