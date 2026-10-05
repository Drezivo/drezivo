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
