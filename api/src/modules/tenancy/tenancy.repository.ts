import {
  branchId,
  membershipId,
  permissionCode,
  subscriptionId,
  tenantId,
  type ActorContext,
  type PermissionCode,
  type TenantStatus,
  type WorkspaceSummary,
} from '@drezivo/contracts';
import {
  withActorTenantResolutionTransaction,
  withGlobalTransaction,
  type ActorTenantResolutionContext,
} from '../../db/client.js';
import { StateConflictError, ValidationError } from '../../shared/errors.js';
import { resolveTenantEntitlements } from '../entitlements/entitlements.service.js';

interface WorkspaceRow {
  tenant_id: string;
  clerk_org_id: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: TenantStatus;
  tenant_currency: string;
  tenant_timezone: string;
  tenant_created_at: Date;
  tenant_updated_at: Date;
  membership_role: 'owner' | 'frontdesk';
  membership_updated_at: Date;
}

export interface WorkspacePage {
  items: WorkspaceSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface Cursor {
  createdAt: string;
  tenantId: string;
}

export async function listActorWorkspaces(
  principalId: string,
  cursor: string | undefined,
  limit: number,
): Promise<WorkspacePage> {
  const decoded = decodeCursor(cursor);
  const rows = await withGlobalTransaction(principalId, async (client) => {
    const result = await client.query<WorkspaceRow>(
      `SELECT tenant_id, clerk_org_id, tenant_name, tenant_slug, tenant_status,
              tenant_currency, tenant_timezone, tenant_created_at, tenant_updated_at,
              membership_role, membership_updated_at
       FROM resolve_actor_workspaces($1::timestamptz, $2::uuid, $3::integer)`,
      [decoded?.createdAt ?? null, decoded?.tenantId ?? null, limit + 1],
    );
    return result.rows;
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toWorkspaceSummary),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            createdAt: last.tenant_created_at.toISOString(),
            tenantId: last.tenant_id,
          })
        : null,
    hasMore,
  };
}

export interface ResolvedActorContext extends ActorContext {
  /** Internal value used by middleware policy checks; it is intentionally not sent separately. */
  effectiveTenantStatus: TenantStatus;
  activePermissionCodes: PermissionCode[];
}

interface TenantRow {
  id: string;
  clerk_org_id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  currency: string;
  timezone: string;
  created_at: Date;
  updated_at: Date;
}

interface MembershipRow {
  id: string;
  role: 'owner' | 'frontdesk';
  status: 'active' | 'suspended' | 'removed';
  updated_at: Date;
}

interface BranchRow {
  id: string;
  name: string;
  code: string;
  is_default: boolean;
  timezone: string;
  status: 'active' | 'archived';
}

interface GrantRow {
  branch_id: string;
  permission_codes: unknown;
}

interface SubscriptionRow {
  id: string;
  plan_id: string;
  plan_code: string;
  status: 'trialing' | 'active' | 'past_due' | 'restricted' | 'cancelled';
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
}

export type ResolveActorResult =
  | { kind: 'resolved'; context: ResolvedActorContext }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'state_conflict' };

export async function resolveActorContext(input: {
  principalId: string;
  clerkOrgId: string;
  branchId?: string;
}): Promise<ResolveActorResult> {
  return withActorTenantResolutionTransaction(input.principalId, async (context) => {
    const tenantResult = await context.client.query<TenantRow>(
      `SELECT id, clerk_org_id, name, slug, status, currency, timezone, created_at, updated_at
       FROM tenant WHERE clerk_org_id = $1 LIMIT 1`,
      [input.clerkOrgId],
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) return { kind: 'not_found' };

    await context.setTenantContext(tenant.id);
    try {
      return await resolveInsideTenant(context, tenant, input);
    } finally {
      await context.clearTenantContext();
    }
  });
}

async function resolveInsideTenant(
  context: ActorTenantResolutionContext,
  tenant: TenantRow,
  input: { principalId: string; clerkOrgId: string; branchId?: string },
): Promise<ResolveActorResult> {
  const membershipResult = await context.client.query<MembershipRow>(
    `SELECT id, role, status, updated_at
     FROM membership
     WHERE tenant_id = $1 AND clerk_user_id = $2
     LIMIT 1`,
    [tenant.id, input.principalId],
  );
  const membership = membershipResult.rows[0];
  if (!membership || membership.status !== 'active') return { kind: 'forbidden' };

  const branchesResult = await context.client.query<BranchRow>(
    `SELECT id, name, code, is_default, timezone, status
     FROM branch WHERE tenant_id = $1 AND status = 'active' ORDER BY is_default DESC, id ASC`,
    [tenant.id],
  );
  const activeBranches = branchesResult.rows;
  const activeBranch = input.branchId
    ? activeBranches.find((branch) => branch.id === input.branchId)
    : activeBranches.find((branch) => branch.is_default);
  if (!activeBranch) return input.branchId ? { kind: 'not_found' } : { kind: 'state_conflict' };

  const grantsResult = await context.client.query<GrantRow>(
    `SELECT bm.branch_id, bm.permission_codes
     FROM branch_membership bm
     JOIN branch b ON b.id = bm.branch_id AND b.tenant_id = bm.tenant_id
     WHERE bm.tenant_id = $1 AND bm.membership_id = $2 AND b.status = 'active'
     ORDER BY bm.branch_id`,
    [tenant.id, membership.id],
  );
  const grants = grantsResult.rows.map(toGrant);
  const selectedGrant = grants.find((grant) => grant.branch_id === activeBranch.id);
  if (!selectedGrant) return { kind: 'not_found' };

  const subscriptionResult = await context.client.query<SubscriptionRow>(
    `SELECT s.id, s.plan_id, p.code AS plan_code, s.status, s.trial_ends_at, s.grace_ends_at
     FROM subscription s
     JOIN plan p ON p.id = s.plan_id AND p.active = true
     WHERE s.tenant_id = $1
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [tenant.id],
  );
  const subscription = subscriptionResult.rows[0];
  if (!subscription) return { kind: 'state_conflict' };

  const entitlementSnapshot = await resolveTenantEntitlements(context.client, tenant.id);
  if (subscription.plan_id !== entitlementSnapshot.planId || subscription.plan_code !== entitlementSnapshot.planCode) {
    throw new StateConflictError('Workspace entitlement state is inconsistent.');
  }

  const effectiveTenantStatus = effectiveStatus(tenant.status, subscription.status);
  return {
    kind: 'resolved',
    context: {
      tenant: {
        id: tenantId.parse(tenant.id),
        name: tenant.name,
        slug: tenant.slug,
        status: effectiveTenantStatus,
        currency: tenant.currency,
        timezone: tenant.timezone,
        created_at: tenant.created_at.toISOString(),
        updated_at: tenant.updated_at.toISOString(),
      },
      membership: {
        id: membershipId.parse(membership.id),
        role: membership.role,
        status: 'active',
        updated_at: membership.updated_at.toISOString(),
      },
      branches: activeBranches.map(toBranch),
      active_branch_id: branchId.parse(activeBranch.id),
      branch_grants: grants,
      subscription: {
        id: subscriptionId.parse(subscription.id),
        plan_code: subscription.plan_code,
        status: subscription.status,
        trial_ends_at: subscription.trial_ends_at?.toISOString() ?? null,
        grace_ends_at: subscription.grace_ends_at?.toISOString() ?? null,
      },
      entitlements: {
        physical_assets_max: entitlementSnapshot.physicalAssetsMax,
        frontdesk_seats_max: entitlementSnapshot.frontdeskSeatsMax,
      },
      effectiveTenantStatus,
      // Lifecycle state is an authorization boundary. Keep the complete grant projection for
      // safe context display, but never expose active capabilities to policy checks while the
      // tenant or subscription is restricted/cancelled.
      activePermissionCodes:
        effectiveTenantStatus === 'active' ? selectedGrant.permission_codes : [],
    },
  };
}

function toWorkspaceSummary(row: WorkspaceRow): WorkspaceSummary {
  return {
    tenant: {
      id: tenantId.parse(row.tenant_id),
      name: row.tenant_name,
      slug: row.tenant_slug,
      status: row.tenant_status,
      currency: row.tenant_currency,
      timezone: row.tenant_timezone,
      created_at: row.tenant_created_at.toISOString(),
      updated_at: row.tenant_updated_at.toISOString(),
    },
    clerk_org_id: row.clerk_org_id,
    role: row.membership_role,
    membership_updated_at: row.membership_updated_at.toISOString(),
  };
}

function toBranch(row: BranchRow): ActorContext['branches'][number] {
  return {
    id: branchId.parse(row.id),
    name: row.name,
    code: row.code,
    is_default: row.is_default,
    timezone: row.timezone,
    status: 'active',
  };
}

function toGrant(row: GrantRow): ActorContext['branch_grants'][number] {
  if (!Array.isArray(row.permission_codes))
    throw new StateConflictError('Invalid branch permission grant.');
  const permissionCodes = row.permission_codes.filter((code): code is PermissionCode =>
    isPermissionCode(code),
  );
  if (permissionCodes.length !== row.permission_codes.length) {
    throw new StateConflictError('Invalid branch permission grant.');
  }
  return { branch_id: branchId.parse(row.branch_id), permission_codes: permissionCodes };
}

function effectiveStatus(
  tenantStatus: TenantStatus,
  subscriptionStatus: SubscriptionRow['status'],
): TenantStatus {
  if (tenantStatus === 'cancelled' || subscriptionStatus === 'cancelled') return 'cancelled';
  if (tenantStatus === 'restricted' || subscriptionStatus === 'restricted') return 'restricted';
  return 'active';
}

function isPermissionCode(value: unknown): value is PermissionCode {
  return permissionCode.safeParse(value).success;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('cursor');
    const record = parsed as Record<string, unknown>;
    if (typeof record.createdAt !== 'string' || typeof record.tenantId !== 'string')
      throw new Error('cursor');
    if (!tenantId.safeParse(record.tenantId).success) throw new Error('cursor');
    return { createdAt: new Date(record.createdAt).toISOString(), tenantId: record.tenantId };
  } catch {
    throw new ValidationError('Workspace cursor is invalid.');
  }
}
