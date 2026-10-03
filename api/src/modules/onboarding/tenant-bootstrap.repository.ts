import { createHash, randomUUID } from 'node:crypto';

import {
  STOREFRONT_SLUG_MAX_LENGTH,
  storefrontSlug,
  type PermissionCode,
} from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import type { BootstrapTransactionContext } from '../../db/client.js';
import { appendGlobalAuditEvent } from '../audit/global-audit.repository.js';
import { seedDefaultCatalogueCategories } from '../catalogue/catalogue.bootstrap.js';
import { TRIAL_DURATION_DAYS } from '../billing/billing.constants.js';

export interface BootstrapAccountRow {
  id: string;
  clerk_user_id: string;
  trial_consumed_at: Date | null;
  current_owned_tenant_id: string | null;
}

export interface BootstrapOnboardingRow {
  id: string;
  account_id: string;
  clerk_org_id: string;
  organization_name: string;
  requested_slug: string | null;
  status: string;
  selected_plan_code: string | null;
  provisioned_tenant_id: string | null;
}

interface PlanRow {
  id: string;
  code: 'starter' | 'professional' | 'business';
}

interface TenantRow {
  id: string;
  clerk_org_id: string;
  name: string;
  slug: string;
  status: 'active' | 'restricted' | 'cancelled';
  currency: string;
  timezone: string;
  created_at: Date;
  updated_at: Date;
}

interface BranchRow {
  id: string;
  name: string;
  code: string;
  is_default: boolean;
  timezone: string;
  status: 'active';
}

interface MembershipRow {
  id: string;
  role: 'owner';
  status: 'active';
  updated_at: Date;
}

interface SubscriptionRow {
  id: string;
  plan_code: 'starter' | 'professional' | 'business';
  status: 'trialing';
  trial_ends_at: Date;
  grace_ends_at: null;
}

export interface TenantBootstrapResponse {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: 'active' | 'restricted' | 'cancelled';
    currency: string;
    timezone: string;
    created_at: string;
    updated_at: string;
  };
  default_branch: {
    id: string;
    name: string;
    code: string;
    is_default: boolean;
    timezone: string;
    status: 'active';
  };
  membership: { id: string; role: 'owner'; status: 'active'; updated_at: string };
  branch_grants: Array<{ branch_id: string; permission_codes: PermissionCode[] }>;
  subscription: {
    id: string;
    plan_code: 'starter' | 'professional' | 'business';
    status: 'trialing';
    trial_ends_at: string;
    grace_ends_at: null;
  };
}

export interface BootstrapGraphInput {
  accountId: string;
  principalId: string;
  onboardingId: string;
  clerkOrgId: string;
  organizationName: string;
  planCode: 'starter' | 'professional' | 'business';
  requestId: string;
}

export type BootstrapGraphResult =
  | { kind: 'created'; response: TenantBootstrapResponse; tenantId: string }
  | { kind: 'slug_conflict' }
  | { kind: 'state_conflict' };

const ownerPermissionCodes: PermissionCode[] = [
  'assets.manage',
  'assets.archive',
  'reservations.manage',
  'reservations.custody',
  'payments.manage',
  'payments.view',
  'evidence.verify',
  'evidence.view',
  'documents.identity.view',
  'documents.receipt.view',
  'policies.manage',
  'users.manage',
  'exports.request',
  'exports.manage',
  'deletion.manage',
];

export async function lockBootstrapAccount(
  client: PoolClient,
  principalId: string,
): Promise<BootstrapAccountRow | null> {
  const result = await client.query<BootstrapAccountRow>(
    `SELECT id, clerk_user_id, trial_consumed_at, current_owned_tenant_id
     FROM account
     WHERE clerk_user_id = $1
     FOR UPDATE`,
    [principalId],
  );
  return result.rows[0] ?? null;
}

export async function lockBootstrapOnboarding(
  client: PoolClient,
  onboardingId: string,
  accountId: string,
): Promise<BootstrapOnboardingRow | null> {
  const result = await client.query<BootstrapOnboardingRow>(
    `SELECT id, account_id, clerk_org_id, organization_name, requested_slug,
            status, selected_plan_code, provisioned_tenant_id
     FROM organization_onboarding
     WHERE id = $1 AND account_id = $2
     FOR UPDATE`,
    [onboardingId, accountId],
  );
  return result.rows[0] ?? null;
}

/** Creates the tenant graph while the caller owns one transaction and one checked-out client. */
export async function createTenantBootstrapGraph(
  context: BootstrapTransactionContext,
  input: BootstrapGraphInput,
  plan: PlanRow,
): Promise<BootstrapGraphResult> {
  const { client } = context;
  const slug = await chooseBootstrapSlug(client, input.organizationName, input.onboardingId);
  if (!slug) return { kind: 'slug_conflict' };

  // Serialize the provider-organization uniqueness check across accounts as well as within one
  // account. This turns a concurrent UNIQUE violation into the typed state conflict below.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`clerk-org:${input.clerkOrgId}`],
  );
  // The Clerk organization is globally unique on tenant. Resolve the collision before the
  // insert so an unrelated existing tenant becomes a typed state conflict, not a raw 23505.
  const availableTenantOrganization = await client.query<{ available: boolean }>(
    'SELECT bootstrap_clerk_org_available($1) AS available',
    [input.clerkOrgId],
  );
  if (!availableTenantOrganization.rows[0]?.available) return { kind: 'state_conflict' };

  const nowResult = await client.query<{ now: Date }>('SELECT now() AS now');
  const now = nowResult.rows[0]?.now;
  if (!now) throw new Error('Bootstrap database clock returned no timestamp');
  const tenantId = randomUUID();
  const branchId = randomUUID();
  const membershipId = randomUUID();
  const subscriptionId = randomUUID();
  const storefrontId = randomUUID();
  const cashPaymentMethodId = randomUUID();
  const gcashPaymentMethodId = randomUUID();
  const subscriptionEventId = randomUUID();
  const outboxId = randomUUID();
  const auditId = randomUUID();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  const tenant = await client.query<TenantRow>(
    `INSERT INTO tenant (id, clerk_org_id, name, slug, status, currency, timezone)
     VALUES ($1, $2, $3, $4, 'active', 'PHP', 'Asia/Manila')
     RETURNING id, clerk_org_id, name, slug, status, currency, timezone, created_at, updated_at`,
    [tenantId, input.clerkOrgId, input.organizationName, slug],
  );
  const tenantRow = tenant.rows[0];
  if (!tenantRow) throw new Error('Tenant bootstrap insert returned no row');

  const accountUpdated = await client.query(
    `UPDATE account
     SET trial_consumed_at = $2, current_owned_tenant_id = $3, updated_at = $2
     WHERE id = $1 AND clerk_user_id = $4
       AND trial_consumed_at IS NULL AND current_owned_tenant_id IS NULL`,
    [input.accountId, now, tenantId, input.principalId],
  );
  if (accountUpdated.rowCount !== 1) {
    throw new Error('Bootstrap account transition lost its serialized precondition');
  }

  const onboardingUpdated = await client.query(
    `UPDATE organization_onboarding
     SET status = 'provisioned', provisioned_tenant_id = $2, updated_at = $3
     WHERE id = $1 AND account_id = $4 AND clerk_org_id = $5
       AND status = 'incomplete' AND selected_plan_code = $6
       AND provisioned_tenant_id IS NULL`,
    [input.onboardingId, tenantId, now, input.accountId, input.clerkOrgId, plan.code],
  );
  if (onboardingUpdated.rowCount !== 1) {
    throw new Error('Bootstrap onboarding transition lost its serialized precondition');
  }

  await context.setTenantContext(tenantId);
  try {
    await client.query(
      `INSERT INTO branch
         (id, tenant_id, name, code, is_default, timezone, address, operating_hours, status)
       VALUES (
         $1,
         $2,
         'Main Branch',
         'main',
         true,
         'Asia/Manila',
         '{}'::jsonb,
         '{"opens_local":"08:00","closes_local":"20:00","closed_weekdays":["sunday"]}'::jsonb,
         'active'
       )`,
      [branchId, tenantId],
    );
    // Fitting behavior remains branch-scoped, but Business Hours own the branch schedule.
    // Seed only the fitting-specific enabled/capacity/duration/fee configuration here.
    await client.query(
      `INSERT INTO fitting_settings
         (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency)
       VALUES ($1, $2, true, 1, 60, 0, $3)`,
      [tenantId, branchId, tenantRow.currency],
    );
    await client.query(
      `INSERT INTO membership (id, tenant_id, clerk_user_id, role, status, authz_version)
       VALUES ($1, $2, $3, 'owner', 'active', 1)`,
      [membershipId, tenantId, input.principalId],
    );
    await client.query(
      `INSERT INTO branch_membership
         (id, tenant_id, branch_id, membership_id, permission_codes)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [randomUUID(), tenantId, branchId, membershipId, JSON.stringify(ownerPermissionCodes)],
    );
    await seedDefaultCatalogueCategories(client, tenantId);
    await client.query(
      `INSERT INTO payment_method
         (id, tenant_id, name, rail, destination_snapshot, qr_file_id, active, storefront_enabled, version)
       VALUES
         ($1, $3, 'Cash', 'cash', '{}'::jsonb, NULL, true, false, 1),
         ($2, $3, 'GCash', 'manual_qr', '{}'::jsonb, NULL, true, false, 1)`,
      [cashPaymentMethodId, gcashPaymentMethodId, tenantId],
    );
    await client.query(
      `INSERT INTO storefront
         (id, tenant_id, branch_id, slug, status, branding, contact)
       VALUES ($1, $2, $3, $4, 'draft', '{}'::jsonb, '{}'::jsonb)`,
      [storefrontId, tenantId, branchId, slug],
    );
    // Reservations always retain the exact business rules that applied when they were created.
    // Seed an internal default snapshot during workspace bootstrap so staff bookings work before
    // the optional public storefront is configured or published.
    await client.query(
      `INSERT INTO policy_snapshot
         (tenant_id, storefront_id, version, rental_rules, deposit_rules, cancellation_rules,
          delivery_rules, privacy_notice, effective_at)
       VALUES ($1, $2, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '', $3)`,
      [tenantId, storefrontId, now],
    );
    await client.query(
      `INSERT INTO subscription
         (id, tenant_id, plan_id, status, trial_ends_at, current_period_start,
          current_period_end, grace_ends_at, cancel_at_period_end, provider_reference)
       VALUES ($1, $2, $3, 'trialing', $4, $5, $6, NULL, false, NULL)`,
      [subscriptionId, tenantId, plan.id, trialEndsAt, now, trialEndsAt],
    );
    await client.query(
      `INSERT INTO subscription_event
         (id, tenant_id, subscription_id, prior_plan_id, next_plan_id,
          event_type, effective_at, business_key)
       VALUES ($1, $2, $3, NULL, $4, 'trial_started', $5, $6)`,
      [subscriptionEventId, tenantId, subscriptionId, plan.id, now, `tenant-bootstrap:${input.onboardingId}`],
    );
    await client.query(
      `INSERT INTO outbox_event
         (id, tenant_id, dedupe_key, event_type, payload, status)
       VALUES ($1, $2, $3, 'tenant.bootstrapped', $4::jsonb, 'pending')`,
      [
        outboxId,
        tenantId,
        `tenant-bootstrap:${input.onboardingId}`,
        JSON.stringify({ tenant_id: tenantId, onboarding_id: input.onboardingId }),
      ],
    );
    await client.query(
      `INSERT INTO audit_event
         (id, tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
          redacted_summary, request_id, occurred_at, outcome)
       VALUES ($1, $2, 'staff', $3, 'tenant.bootstrap.completed', 'tenant', $4,
               $5::jsonb, $6, now(), 'succeeded')`,
      [auditId, tenantId, input.principalId, tenantId, JSON.stringify({ source: 'owner_onboarding' }), input.requestId],
    );

    const response = await readBootstrapProjection(client, tenantId, branchId, membershipId, subscriptionId);
    return { kind: 'created', response, tenantId };
  } finally {
    await context.clearTenantContext();
  }
}

export async function appendBootstrapGlobalAudit(
  client: PoolClient,
  input: {
    accountId: string;
    principalId: string;
    onboardingId: string;
    tenantId: string | null;
    outcome: 'succeeded' | 'rejected' | 'failed';
    reason?: string;
    requestId: string;
  },
): Promise<void> {
  await appendGlobalAuditEvent(client, {
    accountId: input.accountId,
    actorKind: 'account',
    actorKey: input.principalId,
    action: input.outcome === 'succeeded' ? 'tenant.bootstrap.completed' : 'tenant.bootstrap.rejected',
    entityType: 'organization_onboarding',
    entityId: input.onboardingId,
    outcome: input.outcome,
    redactedSummary: {
      ...(input.tenantId ? { tenant_id: input.tenantId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    requestId: input.requestId,
  });
}

async function readBootstrapProjection(
  client: PoolClient,
  tenantId: string,
  branchId: string,
  membershipId: string,
  subscriptionId: string,
): Promise<TenantBootstrapResponse> {
  // pg clients execute one statement at a time. Keep these projection reads sequential so a
  // single checked-out client never has concurrent queries racing on the same wire protocol.
  const tenantResult = await client.query<TenantRow>(
    `SELECT id, clerk_org_id, name, slug, status, currency, timezone, created_at, updated_at
     FROM tenant WHERE id = $1`,
    [tenantId],
  );
  const branchResult = await client.query<BranchRow>(
    `SELECT id, name, code, is_default, timezone, status
     FROM branch WHERE id = $1 AND tenant_id = $2`,
    [branchId, tenantId],
  );
  const membershipResult = await client.query<MembershipRow>(
    `SELECT id, role, status, updated_at
     FROM membership WHERE id = $1 AND tenant_id = $2`,
    [membershipId, tenantId],
  );
  const grantsResult = await client.query<{ branch_id: string; permission_codes: PermissionCode[] }>(
    `SELECT branch_id, permission_codes
     FROM branch_membership WHERE membership_id = $1 AND tenant_id = $2`,
    [membershipId, tenantId],
  );
  const subscriptionResult = await client.query<SubscriptionRow>(
    `SELECT s.id, p.code AS plan_code, s.status, s.trial_ends_at, s.grace_ends_at
     FROM subscription s
     JOIN plan p ON p.id = s.plan_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [subscriptionId, tenantId],
  );
  const tenant = tenantResult.rows[0];
  const branch = branchResult.rows[0];
  const membership = membershipResult.rows[0];
  const subscription = subscriptionResult.rows[0];
  if (!tenant || !branch || !membership || !subscription || grantsResult.rows.length === 0) {
    throw new Error('Tenant bootstrap projection is incomplete');
  }
  const projection = {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      currency: tenant.currency,
      timezone: tenant.timezone,
      created_at: tenant.created_at.toISOString(),
      updated_at: tenant.updated_at.toISOString(),
    },
    default_branch: {
      id: branch.id,
      name: branch.name,
      code: branch.code,
      is_default: branch.is_default,
      timezone: branch.timezone,
      status: branch.status,
    },
    membership: {
      id: membership.id,
      role: membership.role,
      status: membership.status,
      updated_at: membership.updated_at.toISOString(),
    },
    branch_grants: grantsResult.rows.map((grant) => ({
      branch_id: grant.branch_id,
      permission_codes: grant.permission_codes,
    })),
    subscription: {
      id: subscription.id,
      plan_code: subscription.plan_code,
      status: subscription.status,
      trial_ends_at: subscription.trial_ends_at.toISOString(),
      grace_ends_at: subscription.grace_ends_at,
    },
  };
  return projection;
}

async function chooseBootstrapSlug(
  client: PoolClient,
  organizationName: string,
  onboardingId: string,
): Promise<string | null> {
  const base = slugify(organizationName);
  const candidates = [
    base,
    withStableSuffix(base, hashSuffix(onboardingId, 12)),
    withStableSuffix(base, hashSuffix(onboardingId, 32)),
  ];

  for (const rawCandidate of candidates) {
    const parsed = storefrontSlug.safeParse(rawCandidate);
    if (!parsed.success) continue;
    const candidate = parsed.data;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [candidate]);
    const conflict = await client.query<{ available: boolean }>(
      'SELECT bootstrap_slug_available($1) AS available',
      [candidate],
    );
    if (conflict.rows[0]?.available) return candidate;
  }
  return null;
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, STOREFRONT_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return normalized || 'business';
}

function hashSuffix(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function withStableSuffix(base: string, suffix: string): string {
  const available = Math.max(1, STOREFRONT_SLUG_MAX_LENGTH - suffix.length - 1);
  return `${base.slice(0, available).replace(/-+$/g, '')}-${suffix}`;
}
