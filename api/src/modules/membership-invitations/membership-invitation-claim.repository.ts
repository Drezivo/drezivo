import type { PermissionCode } from '@drezivo/contracts';
import type { PoolClient } from 'pg';

export interface ClaimTenantRow {
  id: string;
  clerk_org_id: string;
  status: 'active' | 'restricted' | 'cancelled';
}

export interface ClaimInvitationRow {
  id: string;
  tenant_id: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: Date;
  clerk_invitation_id: string | null;
  dispatch_version: number;
}

export interface ClaimMembershipRow {
  id: string;
  role: 'owner' | 'frontdesk';
  status: 'active' | 'suspended' | 'removed';
}

export async function findClaimTenant(
  client: PoolClient,
  clerkOrgId: string,
  invitationId: string,
): Promise<ClaimTenantRow | null> {
  const result = await client.query<ClaimTenantRow>(
    `SELECT id, clerk_org_id, status
       FROM resolve_membership_invitation_tenant($1, $2::uuid)
      LIMIT 1`,
    [clerkOrgId, invitationId],
  );
  return result.rows[0] ?? null;
}

export async function lockClaimTenant(
  client: PoolClient,
  tenantId: string,
): Promise<ClaimTenantRow | null> {
  const result = await client.query<ClaimTenantRow>(
    `SELECT id, clerk_org_id, status
       FROM tenant
      WHERE id = $1
      FOR UPDATE`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function expireClaimInvitation(
  client: PoolClient,
  tenantId: string,
  invitationId: string,
): Promise<void> {
  await client.query(
    `UPDATE membership_invitation
        SET status = 'expired', updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'pending' AND expires_at <= now()`,
    [tenantId, invitationId],
  );
}

export async function lockClaimInvitation(
  client: PoolClient,
  tenantId: string,
  invitationId: string,
): Promise<ClaimInvitationRow | null> {
  const result = await client.query<ClaimInvitationRow>(
    `SELECT id, tenant_id, status, expires_at, clerk_invitation_id, dispatch_version
       FROM membership_invitation
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [tenantId, invitationId],
  );
  return result.rows[0] ?? null;
}

export async function findClaimMembership(
  client: PoolClient,
  tenantId: string,
  clerkUserId: string,
): Promise<ClaimMembershipRow | null> {
  const result = await client.query<ClaimMembershipRow>(
    `SELECT id, role, status
       FROM membership
      WHERE tenant_id = $1 AND clerk_user_id = $2
      FOR UPDATE`,
    [tenantId, clerkUserId],
  );
  return result.rows[0] ?? null;
}

export async function findDefaultClaimBranch(
  client: PoolClient,
  tenantId: string,
): Promise<{ id: string } | null> {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM branch
      WHERE tenant_id = $1 AND is_default = true AND status = 'active'
      LIMIT 1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function insertClaimMembership(
  client: PoolClient,
  input: { tenantId: string; clerkUserId: string; clerkMembershipId: string },
): Promise<ClaimMembershipRow> {
  const result = await client.query<ClaimMembershipRow>(
    `INSERT INTO membership
       (tenant_id, clerk_user_id, clerk_membership_id, role, status)
     VALUES ($1, $2, $3, 'frontdesk', 'active')
     RETURNING id, role, status`,
    [input.tenantId, input.clerkUserId, input.clerkMembershipId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Membership insert returned no row.');
  return row;
}

export async function restoreClaimMembership(
  client: PoolClient,
  input: { tenantId: string; membershipId: string; clerkMembershipId: string },
): Promise<ClaimMembershipRow> {
  const result = await client.query<ClaimMembershipRow>(
    `UPDATE membership
        SET status = 'active', role = 'frontdesk', clerk_membership_id = $3,
            authz_version = authz_version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND role = 'frontdesk'
      RETURNING id, role, status`,
    [input.tenantId, input.membershipId, input.clerkMembershipId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Membership restore returned no row.');
  return row;
}

export async function persistClaimMembershipProviderId(
  client: PoolClient,
  input: { tenantId: string; membershipId: string; clerkMembershipId: string },
): Promise<void> {
  await client.query(
    `UPDATE membership
        SET clerk_membership_id = $3, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, input.membershipId, input.clerkMembershipId],
  );
}

export async function upsertClaimBranchGrant(
  client: PoolClient,
  input: { tenantId: string; branchId: string; membershipId: string; permissionCodes: PermissionCode[] },
): Promise<void> {
  await client.query(
    `INSERT INTO branch_membership
       (tenant_id, branch_id, membership_id, permission_codes)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (branch_id, membership_id)
     DO UPDATE SET permission_codes = EXCLUDED.permission_codes`,
    [input.tenantId, input.branchId, input.membershipId, JSON.stringify(input.permissionCodes)],
  );
}

export async function acceptClaimInvitation(
  client: PoolClient,
  input: { tenantId: string; invitationId: string; providerInvitationId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE membership_invitation
        SET status = 'accepted', clerk_invitation_id = COALESCE(clerk_invitation_id, $3),
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'pending' AND expires_at > now()`,
    [input.tenantId, input.invitationId, input.providerInvitationId],
  );
  return result.rowCount === 1;
}

/** Preserve provider correlation when replaying an invitation already accepted locally. */
export async function persistClaimInvitationProviderId(
  client: PoolClient,
  input: { tenantId: string; invitationId: string; providerInvitationId: string },
): Promise<void> {
  await client.query(
    `UPDATE membership_invitation
        SET clerk_invitation_id = COALESCE(clerk_invitation_id, $3), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'accepted'`,
    [input.tenantId, input.invitationId, input.providerInvitationId],
  );
}

export async function appendClaimAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    membershipId: string;
    invitationId: string;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, 'membership_invitation.claimed', 'membership', $3,
             $4::jsonb, $5, now(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.membershipId,
      JSON.stringify({ invitation_id: input.invitationId, membership_id: input.membershipId }),
      input.requestId,
    ],
  );
}
