import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import { StateConflictError } from '../../shared/errors.js';
import { withBootstrapTransaction, type BootstrapTransactionContext } from '../../db/client.js';
import {
  claimBootstrapIdempotency,
  finalizeBootstrapIdempotency,
} from '../bootstrap/bootstrap.repository.js';
import { resolvePlanEntitlements } from '../entitlements/entitlements.service.js';
import {
  appendBootstrapGlobalAudit,
  createTenantBootstrapGraph,
  lockBootstrapAccount,
  lockBootstrapOnboarding,
} from './tenant-bootstrap.repository.js';
import type { TenantBootstrapResponse } from './tenant-bootstrap.repository.js';

export type BootstrapPersistenceResult =
  | { kind: 'success'; status: 201; body: SuccessEnvelope<TenantBootstrapResponse> }
  | { kind: 'replayed'; status: number; body: SuccessEnvelope<TenantBootstrapResponse> | FailureEnvelope }
  | { kind: 'in_progress' }
  | { kind: 'key_reused' }
  | { kind: 'rejected'; status: 404 | 409; body: FailureEnvelope };

export interface RunBootstrapInput {
  principalId: string;
  clerkOrgId: string;
  onboardingId: string;
  idempotencyKey: string;
  payloadHash: string;
  requestId: string;
}

const OPERATION = 'tenant.bootstrap';

/** Coordinates the single transaction that owns the complete tenant graph. */
export async function runTenantBootstrap(input: RunBootstrapInput): Promise<BootstrapPersistenceResult> {
  return withBootstrapTransaction(input.principalId, async (context) => {
    const { client } = context;
    const account = await lockBootstrapAccount(client, input.principalId);
    if (!account) {
      return { kind: 'rejected', status: 404, body: failure(input.requestId, 'NOT_FOUND', 'Onboarding could not be found.') };
    }

    const claim = await claimBootstrapIdempotency(client, {
      accountId: account.id,
      operation: OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (claim.kind === 'replayed') {
      return {
        kind: 'replayed',
        status: claim.responseCode,
        body: claim.safeResponse as SuccessEnvelope<TenantBootstrapResponse> | FailureEnvelope,
      };
    }
    if (claim.kind === 'in_progress') return { kind: 'in_progress' };
    if (claim.kind === 'key_reused') return { kind: 'key_reused' };

    const onboarding = await lockBootstrapOnboarding(client, input.onboardingId, account.id);
    if (!onboarding || onboarding.clerk_org_id !== input.clerkOrgId) {
      return rejectAndFinalize(context, account.id, input, claim.recordId, 404, 'NOT_FOUND', 'Onboarding could not be found.', 'not_found');
    }
    if (
      onboarding.status !== 'incomplete' ||
      onboarding.provisioned_tenant_id ||
      !onboarding.selected_plan_code ||
      account.trial_consumed_at ||
      account.current_owned_tenant_id
    ) {
      return rejectAndFinalize(context, account.id, input, claim.recordId, 409, 'STATE_CONFLICT', 'Onboarding is not eligible for bootstrap.', 'state_conflict');
    }

    let plan;
    try {
      const entitlementSnapshot = await resolvePlanEntitlements(client, onboarding.selected_plan_code);
      plan = { id: entitlementSnapshot.planId, code: entitlementSnapshot.planCode };
    } catch (error) {
      if (!(error instanceof StateConflictError)) throw error;
      return rejectAndFinalize(context, account.id, input, claim.recordId, 409, 'STATE_CONFLICT', 'The selected plan is unavailable.', 'plan_unavailable');
    }

    const graph = await createTenantBootstrapGraph(context, {
      accountId: account.id,
      principalId: input.principalId,
      onboardingId: input.onboardingId,
      clerkOrgId: input.clerkOrgId,
      organizationName: onboarding.organization_name,
      planCode: plan.code,
      requestId: input.requestId,
    }, plan);
    if (graph.kind === 'slug_conflict') {
      return rejectAndFinalize(context, account.id, input, claim.recordId, 409, 'STATE_CONFLICT', 'We could not create a unique storefront URL. Please try again.', 'slug_conflict');
    }
    if (graph.kind === 'state_conflict') {
      return rejectAndFinalize(context, account.id, input, claim.recordId, 409, 'STATE_CONFLICT', 'Onboarding is no longer eligible for bootstrap.', 'state_conflict');
    }

    const body: SuccessEnvelope<TenantBootstrapResponse> = {
      success: true,
      data: graph.response,
      request_id: input.requestId,
    };
    await appendBootstrapGlobalAudit(client, {
      accountId: account.id,
      principalId: input.principalId,
      onboardingId: input.onboardingId,
      tenantId: graph.tenantId,
      outcome: 'succeeded',
      requestId: input.requestId,
    });
    await finalizeBootstrapIdempotency(client, {
      accountId: account.id,
      operation: OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      recordId: claim.recordId,
      status: 'succeeded',
      responseCode: 201,
      safeResponse: body,
    });
    return { kind: 'success', status: 201, body };
  });
}

async function rejectAndFinalize(
  context: BootstrapTransactionContext,
  accountId: string,
  input: RunBootstrapInput,
  recordId: string,
  status: 404 | 409,
  code: 'NOT_FOUND' | 'STATE_CONFLICT',
  message: string,
  reason: string,
): Promise<BootstrapPersistenceResult> {
  const body = failure(input.requestId, code, message);
  await appendBootstrapGlobalAudit(context.client, {
    accountId,
    principalId: input.principalId,
    onboardingId: input.onboardingId,
    tenantId: null,
    outcome: 'rejected',
    reason,
    requestId: input.requestId,
  });
  await finalizeBootstrapIdempotency(context.client, {
    accountId,
    operation: OPERATION,
    intentKey: input.idempotencyKey,
    payloadHash: input.payloadHash,
    recordId,
    status: 'failed',
    responseCode: status,
    safeResponse: body,
  });
  return { kind: 'rejected', status, body };
}

function failure(
  requestId: string,
  code: FailureEnvelope['error']['code'],
  message: string,
): FailureEnvelope {
  return { success: false, error: { code, message }, request_id: requestId };
}
