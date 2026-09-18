import type { PoolClient } from 'pg';

const REQUIRED_CAPABILITIES = ['physical_assets.max', 'frontdesk_seats.max'] as const;

export type RequiredCapability = (typeof REQUIRED_CAPABILITIES)[number];

export interface PlanRow {
  id: string;
  code: string;
  version: number;
  monthly_minor: number;
  currency: string;
  active: boolean;
}

export interface PlanEntitlementRow {
  capability: string;
  limit_value: number | null;
  enabled: boolean;
}

export interface TenantPlanRow extends PlanRow {
  subscription_status: string;
}

export async function readActiveV1Plan(
  client: PoolClient,
  planCode: string,
): Promise<{ plan: PlanRow; entitlements: PlanEntitlementRow[] } | null> {
  const planResult = await client.query<PlanRow>(
    `SELECT id, code, version, monthly_minor, currency, active
     FROM plan
     WHERE code = $1 AND version = 1 AND active = true
     LIMIT 2`,
    [planCode],
  );
  const plan = planResult.rows[0];
  if (!plan || planResult.rows.length !== 1) return null;

  return { plan, entitlements: await readRequiredEntitlements(client, plan.id) };
}

export async function readTenantPlan(
  client: PoolClient,
  tenantId: string,
): Promise<{ plan: TenantPlanRow; entitlements: PlanEntitlementRow[] } | null> {
  const result = await client.query<TenantPlanRow>(
    `SELECT p.id, p.code, p.version, p.monthly_minor, p.currency, p.active,
            s.status AS subscription_status
     FROM subscription s
     JOIN plan p ON p.id = s.plan_id
                 AND p.version = 1
                 AND p.active = true
     WHERE s.tenant_id = $1
     LIMIT 2`,
    [tenantId],
  );
  const plan = result.rows[0];
  if (!plan || result.rows.length !== 1) return null;

  return { plan, entitlements: await readRequiredEntitlements(client, plan.id) };
}

export async function lockTenantForQuota(client: PoolClient, tenantId: string): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM tenant
     WHERE id = $1
     FOR UPDATE`,
    [tenantId],
  );
  return result.rows.length === 1;
}

export async function countActivePhysicalAssets(client: PoolClient, tenantId: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM physical_asset
     WHERE tenant_id = $1
       AND lifecycle_status = 'active'`,
    [tenantId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function countActiveFrontdeskMemberships(
  client: PoolClient,
  tenantId: string,
): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM membership
     WHERE tenant_id = $1
       AND role = 'frontdesk'
       AND status = 'active'`,
    [tenantId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function countReservedFrontdeskSeats(
  client: PoolClient,
  tenantId: string,
  excludeInvitationId?: string,
): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT (
       (SELECT count(*)::int
          FROM membership
         WHERE tenant_id = $1 AND role = 'frontdesk' AND status = 'active')
       +
       (SELECT count(*)::int
         FROM membership_invitation
         WHERE tenant_id = $1 AND status = 'pending' AND expires_at > now()
           AND ($2::uuid IS NULL OR id <> $2::uuid))
     )::int AS count`,
    [tenantId, excludeInvitationId ?? null],
  );
  return result.rows[0]?.count ?? 0;
}

async function readRequiredEntitlements(
  client: PoolClient,
  planId: string,
): Promise<PlanEntitlementRow[]> {
  const result = await client.query<PlanEntitlementRow>(
    `SELECT capability, limit_value, enabled
     FROM plan_entitlement
     WHERE plan_id = $1
       AND capability = ANY($2::text[])
     ORDER BY capability`,
    [planId, [...REQUIRED_CAPABILITIES]],
  );
  return result.rows;
}
