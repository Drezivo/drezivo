import { createHash } from 'node:crypto';

import { withOperatorTenantTransaction } from '../../db/client.js';
import {
  appendSubscriptionEvent,
  lockTenantSubscription,
  readSubscriptionProjection,
  updateSubscriptionPlan,
} from '../billing/billing.repository.js';
import {
  assertOperatorPlanCapacity,
  resolvePlanEntitlements,
  resolveTenantEntitlements,
} from '../entitlements/entitlements.service.js';
import {
  DependencyUnavailableError,
  IdempotencyKeyReusedError,
  NotFoundError,
  PaymentAlreadyPendingError,
  StateConflictError,
  ValidationError,
} from '../../shared/errors.js';
import { operatorPlanCode, type OperatorPlanCode } from './operator-plan.schema.js';

export type OperatorPlanChangeInput = {
  tenantId: string;
  planCode: OperatorPlanCode;
  reason: string | null;
  operatorSubject: string;
  idempotencyKey: string;
  requestId: string;
};

export type OperatorPlanChangeResult = {
  tenant_id: string;
  plan_code: OperatorPlanCode;
  changed: boolean;
  replayed: boolean;
};

type Eligibility = {
  tenantStatus: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  currentPlanCode: string;
  now: Date;
  pendingPayment: boolean;
};

export function operatorPlanReplayStatus(
  existing: { resource_id: string; request_fingerprint: string | null; status: string } | undefined,
  tenantId: string,
  fingerprint: string,
): 'replay' | null {
  if (!existing) return null;
  if (existing.resource_id !== tenantId || existing.request_fingerprint !== fingerprint) {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for another request.');
  }
  if (existing.status !== 'completed') {
    throw new StateConflictError('This plan change is still being processed. Retry shortly.');
  }
  return 'replay';
}

/** Changing the plan does not grant access or change the existing billing period. */
export function assertOperatorPlanChangeEligible(input: Eligibility): void {
  const eligibleStatus = ['trialing', 'active', 'past_due', 'restricted'].includes(input.subscriptionStatus);
  if (input.tenantStatus !== 'active' || input.currentPlanCode === 'free' || !eligibleStatus) {
    throw new StateConflictError('Plan changes require an active business with a non-cancelled paid subscription.');
  }
  if (input.pendingPayment) {
    throw new PaymentAlreadyPendingError('Resolve the pending subscription payment before changing the plan.');
  }
}

export function operatorPlanRequestFingerprint(input: Pick<OperatorPlanChangeInput, 'planCode' | 'reason'>): string {
  return createHash('sha256')
    .update(JSON.stringify({ plan_code: input.planCode, reason: input.reason ?? null }), 'utf8')
    .digest('hex');
}

/**
 * Business-owned operator plan mutation. Tenant/subscription locks, capacity checks, events,
 * idempotency, and audit all commit or roll back together in the tenant RLS transaction.
 */
export async function changeTenantPlan(input: OperatorPlanChangeInput): Promise<OperatorPlanChangeResult> {
  if (!operatorPlanCode.safeParse(input.planCode).success) {
    throw new ValidationError('Choose an active paid plan.');
  }
  const fingerprint = operatorPlanRequestFingerprint(input);
  return withOperatorTenantTransaction(input.tenantId, input.operatorSubject, async (client) => {
    const current = await lockTenantSubscription(client, input.tenantId);
    if (!current) throw new NotFoundError('The business subscription was not found.');

    const previous = await client.query<{
      id: string;
      resource_id: string;
      request_fingerprint: string | null;
      status: string;
    }>(
      `SELECT id, resource_id, request_fingerprint, status
         FROM operator_command
        WHERE tenant_id = $1 AND operator_subject = $2
          AND command_kind = 'subscription.plan_change' AND intent_key = $3
        FOR UPDATE`,
      [input.tenantId, input.operatorSubject, input.idempotencyKey],
    );
    const priorCommand = previous.rows[0];
    if (operatorPlanReplayStatus(priorCommand, input.tenantId, fingerprint) === 'replay') {
      const projection = await readSubscriptionProjection(client, input.tenantId);
      if (!projection) throw new StateConflictError('Workspace subscription is unavailable.');
      const replayPlanCode = operatorPlanCode.safeParse(projection.plan_code);
      if (!replayPlanCode.success) throw new StateConflictError('Workspace subscription plan is unavailable.');
      return {
        tenant_id: input.tenantId,
        plan_code: replayPlanCode.data,
        changed: false,
        replayed: true,
      };
    }

    const clock = await client.query<{ now: Date }>('SELECT statement_timestamp() AS now');
    const pendingPayment = await client.query<{ pending: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM subscription_payment
          WHERE tenant_id = $1 AND status = 'pending'
       ) AS pending`,
      [input.tenantId],
    );
    const clockRows = clock.rows;
    const pendingRows = pendingPayment.rows;
    const databaseNow = clockRows[0]?.now;
    if (!databaseNow) throw new DependencyUnavailableError('The subscription clock is unavailable.');
    const currentPlan = await resolveTenantEntitlements(client, input.tenantId);
    if (currentPlan.planId !== current.plan_id) {
      throw new StateConflictError('Workspace entitlement state is inconsistent.');
    }
    assertOperatorPlanChangeEligible({
      tenantStatus: current.tenant_status,
      subscriptionStatus: current.status,
      trialEndsAt: current.trial_ends_at,
      currentPeriodEnd: current.current_period_end,
      currentPlanCode: currentPlan.planCode,
      now: databaseNow,
      pendingPayment: pendingRows[0]?.pending ?? false,
    });
    const targetPlan = await resolvePlanEntitlements(client, input.planCode);
    const changed = targetPlan.planId !== current.plan_id;
    if (changed) {
      await assertOperatorPlanCapacity(client, input.tenantId, targetPlan);
      const updated = await updateSubscriptionPlan(client, {
        tenantId: input.tenantId,
        subscriptionId: current.subscription_id,
        planId: targetPlan.planId,
      });
      if (!updated) throw new StateConflictError('The subscription plan changed before this command completed.');
      await appendSubscriptionEvent(client, {
        tenantId: input.tenantId,
        subscriptionId: current.subscription_id,
        priorPlanId: current.plan_id,
        nextPlanId: targetPlan.planId,
        eventType: 'plan_changed',
        effectiveAt: databaseNow,
        businessKey: `operator:${input.operatorSubject}:${input.idempotencyKey}`,
      });
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO operator_command
         (tenant_id, operator_subject, command_kind, resource_kind, resource_id,
          intent_key, reason, status, request_id, accepted_at, completed_at, request_fingerprint)
       VALUES ($1, $2, 'subscription.plan_change', 'tenant', $1,
               $3, $4, 'completed', $5, $6, $6, $7)
       RETURNING id`,
      [input.tenantId, input.operatorSubject, input.idempotencyKey,
        input.reason, input.requestId, databaseNow, fingerprint],
    );
    const commandId = inserted.rows[0]?.id;
    if (!commandId) throw new DependencyUnavailableError('The subscription plan command could not be recorded.');

    await client.query(
      `INSERT INTO audit_event
         (tenant_id, actor_kind, actor_key, operator_command_id, action, entity_type,
          entity_id, redacted_summary, request_id, occurred_at, outcome)
       VALUES ($1, 'operator', $2, $3, 'subscription.plan_changed', 'subscription',
               $4, $5::jsonb, $6, $7, 'succeeded')`,
      [input.tenantId, `operator:${input.operatorSubject}`, commandId, current.subscription_id,
        JSON.stringify({ prior_plan_code: currentPlan.planCode, plan_code: input.planCode, changed }),
        input.requestId, databaseNow],
    );

    return { tenant_id: input.tenantId, plan_code: input.planCode, changed, replayed: false };
  });
}
