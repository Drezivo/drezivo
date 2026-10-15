import {
  type ChangeSubscriptionPlanRequest,
  planCode,
  subscriptionId,
  type SubscriptionSummary,
} from '@drezivo/contracts';
import type { PoolClient } from 'pg';

import {
  db,
  withActorTenantResolutionTransaction,
  withSystemTenantTransaction,
} from '../../db/client.js';
import { tenant } from '../../db/schema/index.js';
import {
  ForbiddenError,
  IdempotencyKeyReusedError,
  StateConflictError,
  isAppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import {
  appendSubscriptionEvent,
  appendTenantAuditEvent,
  claimTenantIdempotency,
  finalizeTenantIdempotency,
  lockTenantSubscription,
  readSubscriptionProjection,
  updateSubscriptionToPastDue,
  updateSubscriptionToRestricted,
  type LockedSubscriptionRow,
} from './billing.repository.js';
import {
  assertPlanCapacity,
  resolvePlanEntitlements as resolvePlan,
  resolveTenantEntitlements,
} from '../entitlements/entitlements.service.js';
import { PAST_DUE_GRACE_DURATION_DAYS, TRIAL_DURATION_DAYS } from './billing.constants.js';

const PLAN_CHANGE_OPERATION = 'subscription.plan_change';

export interface LifecycleActor {
  actorKey: string;
  requestId: string;
}

export interface LifecycleReconciliationResult {
  transitions: Array<'past_due' | 'restricted'>;
  subscription: LockedSubscriptionRow | null;
}

export async function reconcileTenantLifecycle(
  client: PoolClient,
  tenantId: string,
  actor: LifecycleActor,
): Promise<LifecycleReconciliationResult> {
  const initial = await lockTenantSubscription(client, tenantId);
  if (!initial) return { transitions: [], subscription: null };

  const nowResult = await client.query<{ now: Date }>('SELECT now() AS now');
  const now = nowResult.rows[0]?.now;
  if (!now) throw new StateConflictError('Subscription lifecycle clock is unavailable.');

  const transitions: Array<'past_due' | 'restricted'> = [];
  let current = initial;

  if (current.tenant_status !== 'cancelled' && current.status !== 'cancelled') {
    if (current.status === 'trialing') {
      if (!current.trial_ends_at) {
        throw new StateConflictError('Trial lifecycle state is incomplete.');
      }
      if (now >= current.trial_ends_at) {
        const changed = await updateSubscriptionToPastDue(
          client,
          current.subscription_id,
          current.trial_ends_at,
          PAST_DUE_GRACE_DURATION_DAYS,
        );
        if (changed) {
          await appendSubscriptionEvent(client, {
            tenantId,
            subscriptionId: current.subscription_id,
            priorPlanId: current.plan_id,
            nextPlanId: current.plan_id,
            eventType: 'past_due',
            effectiveAt: current.trial_ends_at,
            businessKey: `subscription-lifecycle:${current.subscription_id}:past_due`,
          });
          await appendTenantAuditEvent(client, {
            tenantId,
            actorKey: actor.actorKey,
            action: 'subscription.trial_expired',
            entityId: current.subscription_id,
            redactedSummary: { prior_status: 'trialing', next_status: 'past_due' },
            requestId: actor.requestId,
          });
          transitions.push('past_due');
        }
        current = {
          ...current,
          status: 'past_due',
          grace_ends_at: new Date(
            current.trial_ends_at.getTime() + PAST_DUE_GRACE_DURATION_DAYS * 24 * 60 * 60 * 1000,
          ),
        };
      }
    }

    if (current.status === 'past_due') {
      if (!current.grace_ends_at) {
        throw new StateConflictError('Subscription grace state is incomplete.');
      }
      if (now >= current.grace_ends_at) {
        const changed = await updateSubscriptionToRestricted(
          client,
          tenantId,
          current.subscription_id,
        );
        if (changed) {
          await appendSubscriptionEvent(client, {
            tenantId,
            subscriptionId: current.subscription_id,
            priorPlanId: current.plan_id,
            nextPlanId: current.plan_id,
            eventType: 'restricted',
            effectiveAt: current.grace_ends_at,
            businessKey: `subscription-lifecycle:${current.subscription_id}:restricted`,
          });
          await appendTenantAuditEvent(client, {
            tenantId,
            actorKey: actor.actorKey,
            action: 'subscription.grace_expired',
            entityId: current.subscription_id,
            redactedSummary: { prior_status: 'past_due', next_status: 'restricted' },
            requestId: actor.requestId,
          });
          transitions.push('restricted');
          current = { ...current, status: 'restricted', tenant_status: 'restricted' };
        }
      }
    }
  }

  return { transitions, subscription: current };
}

export async function reconcileDueSubscriptionsForAllTenants(): Promise<number> {
  const tenants = await db.select({ id: tenant.id }).from(tenant);
  let transitionCount = 0;
  for (const currentTenant of tenants) {
    const result = await withSystemTenantTransaction(
      currentTenant.id,
      'system:subscription-lifecycle',
      (client) =>
        reconcileTenantLifecycle(client, currentTenant.id, {
          actorKey: 'system:subscription-lifecycle',
          requestId: 'worker:subscription-lifecycle',
        }),
    );
    transitionCount += result.transitions.length;
  }
  return transitionCount;
}

export interface ChangeTrialPlanInput {
  tenantId: string;
  membershipId: string;
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  request: ChangeSubscriptionPlanRequest;
}

type CommandBody = SuccessEnvelope<SubscriptionSummary> | FailureEnvelope;

export interface SubscriptionCommandResponse {
  status: number;
  body: CommandBody;
}

export async function changeTrialPlan(
  input: ChangeTrialPlanInput,
): Promise<SubscriptionCommandResponse> {
  const payloadHash = canonicalRequestHash(input.request);
  return withActorTenantResolutionTransaction(input.principalId, async (transaction) => {
    const { client } = transaction;
    const accountResult = await client.query<{
      id: string;
      trial_consumed_at: Date | null;
      current_owned_tenant_id: string | null;
    }>(
      `SELECT id, trial_consumed_at, current_owned_tenant_id
         FROM account
        WHERE clerk_user_id = $1
        FOR UPDATE`,
      [input.principalId],
    );
    const account = accountResult.rows[0];
    if (!account || account.current_owned_tenant_id !== input.tenantId) {
      throw new StateConflictError('Workspace trial eligibility is unavailable.');
    }
    await transaction.setTenantContext(input.tenantId);

    const membership = await client.query<{
      clerk_user_id: string;
      role: 'owner' | 'frontdesk';
      status: string;
    }>(
      `SELECT clerk_user_id, role, status
         FROM membership
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
      [input.membershipId, input.tenantId],
    );
    if (
      membership.rows[0]?.clerk_user_id !== input.principalId ||
      membership.rows[0]?.role !== 'owner' ||
      membership.rows[0]?.status !== 'active'
    ) {
      throw new ForbiddenError('Only the tenant owner can change the trial plan.');
    }

    const claim = await claimTenantIdempotency(client, {
      tenantId: input.tenantId,
      principalKey: input.membershipId,
      operation: PLAN_CHANGE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });
    if (claim.kind === 'replayed') {
      return { status: claim.responseCode, body: claim.safeResponse as CommandBody };
    }
    if (claim.kind === 'key_reused') {
      throw new IdempotencyKeyReusedError(
        'This Idempotency-Key was already used for another request.',
      );
    }
    if (claim.kind === 'in_progress') {
      throw new StateConflictError(
        'An identical request is already being processed. Retry shortly.',
      );
    }

    try {
      await reconcileTenantLifecycle(client, input.tenantId, {
        actorKey: input.principalId,
        requestId: input.requestId,
      });
      const current = await lockTenantSubscription(client, input.tenantId);
      if (!current) throw new StateConflictError('Workspace subscription is unavailable.');
      const currentPlan = await resolveTenantEntitlements(client, input.tenantId);
      if (currentPlan.planId !== current.plan_id) {
        throw new StateConflictError('Workspace entitlement state is inconsistent.');
      }
      const target = await resolvePlan(client, input.request.plan_code);
      if (target.planId !== current.plan_id) {
        if (
          current.tenant_status !== 'active' ||
          currentPlan.planCode !== 'free' ||
          current.status !== 'active' ||
          target.planCode === 'free'
        ) {
          throw new StateConflictError('Only a Free workspace can select a paid plan.');
        }
        if (account.trial_consumed_at) {
          throw new StateConflictError('The lifetime trial has already been used. Submit a plan payment to upgrade.');
        }
        await assertPlanCapacity(client, input.tenantId, target);
        const nowResult = await client.query<{ now: Date }>('SELECT statement_timestamp() AS now');
        const now = nowResult.rows[0]?.now;
        if (!now) throw new StateConflictError('Subscription clock is unavailable.');
        const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
        await transaction.clearTenantContext();
        const consumed = await client.query(
          `UPDATE account SET trial_consumed_at = $2, updated_at = $2
            WHERE id = $1 AND current_owned_tenant_id = $3 AND trial_consumed_at IS NULL`,
          [account.id, now, input.tenantId],
        );
        if (consumed.rowCount !== 1) throw new StateConflictError('The lifetime trial has already been used. Submit a plan payment to upgrade.');
        await transaction.setTenantContext(input.tenantId);
        const updated = await client.query(
          `UPDATE subscription
              SET plan_id = $3, status = 'trialing', trial_ends_at = $4,
                  current_period_start = $5, current_period_end = $4, grace_ends_at = NULL
            WHERE tenant_id = $1 AND id = $2 AND plan_id = $6 AND status = 'active'`,
          [input.tenantId, current.subscription_id, target.planId, trialEndsAt, now, current.plan_id],
        );
        if (updated.rowCount !== 1) throw new Error('The locked Free subscription changed before trial activation.');
        await appendSubscriptionEvent(client, {
          tenantId: input.tenantId,
          subscriptionId: current.subscription_id,
          priorPlanId: current.plan_id,
          nextPlanId: target.planId,
          eventType: 'plan_changed',
          effectiveAt: now,
          businessKey: `free-upgrade-trial:${input.idempotencyKey}`,
        });
        await appendTenantAuditEvent(client, {
          tenantId: input.tenantId,
          actorKey: input.principalId,
          action: 'subscription.free_trial_started',
          entityId: current.subscription_id,
          redactedSummary: { prior_plan_code: 'free', next_plan_code: target.planCode },
          requestId: input.requestId,
        });
      } else if (current.status !== 'trialing' && currentPlan.planCode !== 'free') {
        throw new StateConflictError('The subscription plan can only change during the trial.');
      }

      const projection = await readSubscriptionProjection(client, input.tenantId);
      if (!projection) throw new StateConflictError('Subscription projection is unavailable.');
      const body = successBody(input.requestId, toSubscriptionSummary(projection));
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: PLAN_CHANGE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    } catch (error) {
      if (!isAppError(error)) throw error;
      const body = failureBody(input.requestId, error.code, error.message);
      await appendTenantAuditEvent(client, {
        tenantId: input.tenantId,
        actorKey: input.principalId,
        action: 'subscription.plan_change.rejected',
        entityId: input.tenantId,
        redactedSummary: { reason: error.code },
        requestId: input.requestId,
      });
      await finalizeTenantIdempotency(client, {
        tenantId: input.tenantId,
        principalKey: input.membershipId,
        operation: PLAN_CHANGE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        status: 'failed',
        responseCode: error.status,
        safeResponse: body,
      });
      return { status: error.status, body };
    }
  });
}

function toSubscriptionSummary(row: {
  id: string;
  plan_code: string;
  status: SubscriptionSummary['status'];
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
}): SubscriptionSummary {
  const code = planCode.safeParse(row.plan_code);
  if (!code.success) throw new StateConflictError('Subscription plan is unavailable.');
  return {
    id: subscriptionId.parse(row.id),
    plan_code: code.data,
    status: row.status,
    trial_ends_at: row.trial_ends_at?.toISOString() ?? null,
    grace_ends_at: row.grace_ends_at?.toISOString() ?? null,
  };
}

function successBody(
  requestId: string,
  data: SubscriptionSummary,
): SuccessEnvelope<SubscriptionSummary> {
  return { success: true, data, request_id: requestId };
}

function failureBody(
  requestId: string,
  code: FailureEnvelope['error']['code'],
  message: string,
): FailureEnvelope {
  return { success: false, error: { code, message }, request_id: requestId };
}
