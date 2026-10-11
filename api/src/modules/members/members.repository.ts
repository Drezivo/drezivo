import type { PoolClient } from 'pg';

export interface ActiveTenantMemberRow {
  id: string;
  clerk_user_id: string;
  role: 'owner' | 'frontdesk';
}

export async function listActiveTenantMembers(
  client: PoolClient,
  tenantId: string,
): Promise<ActiveTenantMemberRow[]> {
  const result = await client.query<ActiveTenantMemberRow>(
    `SELECT id, clerk_user_id, role
       FROM membership
      WHERE tenant_id = $1 AND status = 'active' AND role IN ('owner', 'frontdesk')
      ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, id`,
    [tenantId],
  );
  return result.rows;
}

export interface LockedMembershipRow {
  id: string;
  clerk_user_id: string;
  role: 'owner' | 'frontdesk';
  status: 'active' | 'suspended' | 'removed';
  authz_version: number;
}

export async function lockMembership(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<LockedMembershipRow | null> {
  const result = await client.query<LockedMembershipRow>(
    `SELECT id, clerk_user_id, role, status, authz_version
       FROM membership
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [tenantId, membershipId],
  );
  return result.rows[0] ?? null;
}

/**
 * Ends a Front Desk member's access. The tenant resolver only accepts `active` memberships, so the
 * member is denied on their next request; bumping `authz_version` invalidates cached grants.
 */
export async function markFrontdeskMembershipRemoved(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<{ authz_version: number } | null> {
  const result = await client.query<{ authz_version: number }>(
    `UPDATE membership
        SET status = 'removed', authz_version = authz_version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND role = 'frontdesk' AND status = 'active'
      RETURNING authz_version`,
    [tenantId, membershipId],
  );
  return result.rows[0] ?? null;
}

/** Queues leaving the Clerk organization; the worker retries until Clerk confirms. */
export async function insertMemberRemovalOutbox(
  client: PoolClient,
  input: { tenantId: string; membershipId: string; authzVersion: number },
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
     VALUES ($1, $2, 'clerk.membership.remove_requested', $3::jsonb)
     ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [
      input.tenantId,
      `membership:${input.membershipId}:${input.authzVersion}:remove`,
      JSON.stringify({ membership_id: input.membershipId, authz_version: input.authzVersion }),
    ],
  );
}

export async function insertMemberRemovalAudit(
  client: PoolClient,
  input: { tenantId: string; actorKey: string; membershipId: string; requestId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, 'membership.removed', 'membership', $3,
             $4::jsonb, $5, now(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.membershipId,
      JSON.stringify({ membership_id: input.membershipId, role: 'frontdesk' }),
      input.requestId,
    ],
  );
}

/** The worker's view of a removal: the membership plus the tenant's Clerk organization. */
export async function lockMembershipForProviderRemoval(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<(LockedMembershipRow & { clerk_org_id: string }) | null> {
  const result = await client.query<LockedMembershipRow & { clerk_org_id: string }>(
    `SELECT m.id, m.clerk_user_id, m.role, m.status, m.authz_version, t.clerk_org_id
       FROM membership m
       JOIN tenant t ON t.id = m.tenant_id
      WHERE m.tenant_id = $1 AND m.id = $2
      FOR UPDATE OF m`,
    [tenantId, membershipId],
  );
  return result.rows[0] ?? null;
}
