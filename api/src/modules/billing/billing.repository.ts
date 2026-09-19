import type { PoolClient } from 'pg';

import type { SubscriptionStatus } from '@drezivo/contracts';

export { claimTenantIdempotency, finalizeTenantIdempotency } from '../../shared/tenant-idempotency.js';
export type { TenantIdempotencyClaim } from '../../shared/tenant-idempotency.js';

export interface LockedSubscriptionRow {
  tenant_id: string;
  tenant_status: 'active' | 'restricted' | 'cancelled';
  subscription_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  trial_ends_at: Date | null;
  current_period_start: Date;
  current_period_end: Date;
  grace_ends_at: Date | null;
}

export interface SubscriptionProjectionRow {
  id: string;
  plan_code: string;
  status: SubscriptionStatus;
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
}

export async function lockTenantSubscription(
  client: PoolClient,
  tenantId: string,
): Promise<LockedSubscriptionRow | null> {
  const result = await client.query<LockedSubscriptionRow>(
    `SELECT t.id AS tenant_id, t.status AS tenant_status,
            s.id AS subscription_id, s.plan_id, s.status,
            s.trial_ends_at, s.current_period_start, s.current_period_end,
            s.grace_ends_at
       FROM tenant t
       JOIN subscription s ON s.tenant_id = t.id
      WHERE t.id = $1
      FOR UPDATE OF t, s`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function readSubscriptionProjection(
  client: PoolClient,
  tenantId: string,
): Promise<SubscriptionProjectionRow | null> {
  const result = await client.query<SubscriptionProjectionRow>(
    `SELECT s.id, p.code AS plan_code, s.status, s.trial_ends_at, s.grace_ends_at
       FROM subscription s
       JOIN plan p ON p.id = s.plan_id
      WHERE s.tenant_id = $1
      LIMIT 2`,
    [tenantId],
  );
  if (result.rows.length !== 1) return null;
  return result.rows[0] ?? null;
}

export async function updateSubscriptionToPastDue(
  client: PoolClient,
  subscriptionId: string,
  trialEndsAt: Date,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE subscription
        SET status = 'past_due',
            grace_ends_at = $2::timestamptz + interval '7 days'
      WHERE id = $1 AND status = 'trialing'`,
    [subscriptionId, trialEndsAt],
  );
  return result.rowCount === 1;
}

export async function updateSubscriptionToRestricted(
  client: PoolClient,
  tenantId: string,
  subscriptionId: string,
): Promise<boolean> {
  const subscriptionResult = await client.query(
    `UPDATE subscription
        SET status = 'restricted'
      WHERE id = $1 AND tenant_id = $2 AND status = 'past_due'`,
    [subscriptionId, tenantId],
  );
  if (subscriptionResult.rowCount !== 1) return false;

  await client.query(
    `UPDATE tenant
        SET status = 'restricted', updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [tenantId],
  );
  return true;
}

export async function appendSubscriptionEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    subscriptionId: string;
    priorPlanId: string;
    nextPlanId: string;
    eventType: 'past_due' | 'restricted' | 'plan_changed';
    effectiveAt: Date;
    businessKey: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO subscription_event
       (tenant_id, subscription_id, prior_plan_id, next_plan_id,
        event_type, effective_at, business_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, business_key) DO NOTHING`,
    [
      input.tenantId,
      input.subscriptionId,
      input.priorPlanId,
      input.nextPlanId,
      input.eventType,
      input.effectiveAt,
      input.businessKey,
    ],
  );
}

export async function appendTenantAuditEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    actorKey: string;
    action: string;
    entityId: string;
    redactedSummary: Record<string, unknown>;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_event
       (tenant_id, actor_kind, actor_key, action, entity_type, entity_id,
        redacted_summary, request_id, occurred_at, outcome)
     VALUES ($1, 'staff', $2, $3, 'subscription', $4, $5::jsonb, $6, now(), 'succeeded')`,
    [
      input.tenantId,
      input.actorKey,
      input.action,
      input.entityId,
      JSON.stringify(input.redactedSummary),
      input.requestId,
    ],
  );
}

export async function updateSubscriptionPlan(
  client: PoolClient,
  input: { tenantId: string; subscriptionId: string; planId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE subscription
        SET plan_id = $3
      WHERE tenant_id = $1 AND id = $2 AND status = 'trialing'`,
    [input.tenantId, input.subscriptionId, input.planId],
  );
  return result.rowCount === 1;
}
