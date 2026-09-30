import { createClerkServerAdapter } from '../../integrations/clerk/clerk.adapter.js';
import {
  DependencyUnavailableError,
  IdempotencyKeyReusedError,
  NotFoundError,
  StateConflictError,
  isAppError,
  type AppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import { type FailureEnvelope, type SuccessEnvelope } from '../../shared/response.js';
import { ensureAccount, getAccountByClerkUserId } from '../accounts/account.repository.js';
import {
  getCurrentOwnerOnboarding,
  type CreateOrResumeOnboardingResult,
} from './onboarding.repository.js';
import {
  claimBootstrapRecord,
  withOnboardingTransaction,
} from './onboarding.persistence.js';
import { toPublicOnboarding, type OwnerOnboardingContextDTO } from './onboarding.dto.js';
import type {
  AbandonOwnerOnboardingInput as AbandonOwnerOnboardingRequestInput,
  ChooseOnboardingPlanInput as ChooseOnboardingPlanRequestInput,
  CreateOwnerOnboardingInput,
} from './onboarding.schemas.js';

const CREATE_OPERATION = 'onboarding.create';
const SELECT_PLAN_OPERATION = 'onboarding.plan.select';
const ABANDON_OPERATION = 'onboarding.abandon';

type CommandBody = SuccessEnvelope<ReturnType<typeof toPublicOnboarding>> | FailureEnvelope;

export interface OnboardingCommandResponse {
  status: number;
  body: CommandBody;
}

export interface GetCurrentOnboardingInput {
  principalId: string;
}

export interface StartOwnerOnboardingInput {
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  request: CreateOwnerOnboardingInput;
}

export interface SelectOnboardingPlanInput {
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  onboardingId: string;
  request: ChooseOnboardingPlanRequestInput;
}

export interface AbandonOwnerOnboardingInput {
  principalId: string;
  requestId: string;
  idempotencyKey: string;
  onboardingId: string;
  request: AbandonOwnerOnboardingRequestInput;
}

export async function getCurrentOwnerOnboardingContext(
  input: GetCurrentOnboardingInput,
): Promise<OwnerOnboardingContextDTO> {
  const [onboarding, account] = await Promise.all([
    getCurrentOwnerOnboarding(input.principalId),
    getAccountByClerkUserId(input.principalId),
  ]);
  return {
    onboarding: onboarding ? toPublicOnboarding(onboarding) : null,
    has_current_owned_tenant: Boolean(account?.currentOwnedTenantId),
    has_consumed_lifetime_trial: Boolean(account?.trialConsumedAt),
  };
}

export async function startOwnerOnboarding(
  input: StartOwnerOnboardingInput,
): Promise<OnboardingCommandResponse> {
  const payloadHash = canonicalRequestHash(input.request);
  const account = await ensureAccount(input.principalId);
  const claim = await withOnboardingTransaction(input.principalId, (transaction) =>
    transaction.claimStart({
      account,
      operation: CREATE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
      organizationName: input.request.organization_name,
      requestedSlug: null,
    }),
  );

  if (claim.claim.kind === 'replayed') {
    return {
      status: claim.claim.responseCode,
      body: claim.claim.safeResponse as CommandBody,
    };
  }
  if (claim.claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError(
      'This Idempotency-Key was already used for another request.',
    );
  }
  if (claim.claim.kind === 'in_progress') {
    const repaired = await getCurrentOwnerOnboarding(input.principalId);
    const attempt = claim.attempt;
    if (
      attempt?.providerOrgId &&
      repaired &&
      repaired.clerkOrgId === attempt.providerOrgId &&
      repaired.organizationName === attempt.organizationName &&
      repaired.requestedSlug === attempt.requestedSlug
    ) {
      const body = successBody(input.requestId, toPublicOnboarding(repaired));
      await withOnboardingTransaction(input.principalId, async (transaction) => {
        await transaction.appendAudit({
          accountId: account.id,
          actorKind: 'account',
          actorKey: input.principalId,
          action: 'onboarding.create.repaired',
          entityType: 'organization_onboarding',
          entityId: repaired.id,
          outcome: 'succeeded',
          redactedSummary: { source: 'signed_webhook_marker' },
          requestId: input.requestId,
        });
        await transaction.finalizeIdempotency({
          accountId: account.id,
          operation: CREATE_OPERATION,
          intentKey: input.idempotencyKey,
          payloadHash,
          recordId: claim.claim.recordId,
          status: 'succeeded',
          responseCode: 200,
          safeResponse: body,
        });
      });
      return { status: 200, body };
    }
    throw new StateConflictError(
      'An identical onboarding request is already being processed. Retry with the same key.',
    );
  }

  if (claim.otherInProgress) {
    const body = failureBody(
      input.requestId,
      'STATE_CONFLICT',
      'Another onboarding request is already being processed. Retry shortly.',
    );
    await finalizeFailure(input, account.id, claim.claim.recordId, payloadHash, body, 409);
    return { status: 409, body };
  }

  if (!claim.attempt) {
    throw new StateConflictError('Onboarding could not establish a durable provider attempt.');
  }
  const attemptId = claim.attempt.attemptId;
  if (account.currentOwnedTenantId) {
    const error = errorForCreate('owned_tenant');
    const body = failureBody(input.requestId, error.code, error.message);
    await finalizeFailure(input, account.id, claim.claim.recordId, payloadHash, body, error.status);
    return { status: error.status, body };
  }

  const current = await getCurrentOwnerOnboarding(input.principalId);
  if (current) {
    const body = successBody(input.requestId, toPublicOnboarding(current));
    await withOnboardingTransaction(input.principalId, async (transaction) => {
      await transaction.appendAudit({
        accountId: account.id,
        actorKind: 'account',
        actorKey: input.principalId,
        action: 'onboarding.create.replayed',
        entityType: 'organization_onboarding',
        entityId: current.id,
        outcome: 'succeeded',
        redactedSummary: { source: 'existing_active_onboarding' },
        requestId: input.requestId,
      });
      await transaction.finalizeIdempotency({
        accountId: account.id,
        operation: CREATE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        recordId: claim.claim.recordId,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
    });
    return { status: 200, body };
  }

  let organization: Awaited<ReturnType<ReturnType<typeof createClerkServerAdapter>['createOrganization']>>;
  try {
    organization = await createClerkServerAdapter().createOrganization({
      name: input.request.organization_name,
      createdByUserId: input.principalId,
      onboardingMarker: { accountId: account.id, attemptId },
    });
  } catch (error) {
    const appError = isAppError(error)
      ? error
      : new DependencyUnavailableError('Onboarding provider is unavailable.');
    if (appError.code === 'STATE_CONFLICT') {
      await withOnboardingTransaction(input.principalId, (transaction) =>
        transaction.markAttemptFailed(attemptId),
      );
      const body = failureBody(input.requestId, 'STATE_CONFLICT', appError.message);
      await finalizeFailure(input, account.id, claim.claim.recordId, payloadHash, body, 409);
      return { status: 409, body };
    }
    throw appError;
  }

  await withOnboardingTransaction(input.principalId, (transaction) =>
    transaction.markAttemptProviderCreated(attemptId, organization.id),
  );

  return withOnboardingTransaction(input.principalId, async (transaction) => {
    const result = await transaction.createOrResume({
      accountId: account.id,
      clerkOrgId: organization.id,
      principalId: input.principalId,
      organizationName: input.request.organization_name,
      requestedSlug: null,
    });
    if (result.kind === 'created' || result.kind === 'existing') {
      await transaction.markAttemptLocalPersisted(attemptId);
      const body = successBody(input.requestId, toPublicOnboarding(result.onboarding));
      await transaction.appendAudit({
        accountId: account.id,
        actorKind: 'account',
        actorKey: input.principalId,
        action: `onboarding.create.${result.kind}`,
        entityType: 'organization_onboarding',
        entityId: result.onboarding.id,
        outcome: 'succeeded',
        redactedSummary: { provider: 'clerk' },
        requestId: input.requestId,
      });
      await transaction.finalizeIdempotency({
        accountId: account.id,
        operation: CREATE_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        recordId: claim.claim.recordId,
        status: 'succeeded',
        responseCode: result.kind === 'created' ? 201 : 200,
        safeResponse: body,
      });
      return { status: result.kind === 'created' ? 201 : 200, body };
    }

    const error = errorForCreate(result.kind);
    const body = failureBody(input.requestId, error.code, error.message);
    await transaction.appendAudit({
      accountId: account.id,
      actorKind: 'account',
      actorKey: input.principalId,
      action: 'onboarding.create.rejected',
      entityType: 'organization_onboarding',
      outcome: 'rejected',
      redactedSummary: { reason: error.code },
      requestId: input.requestId,
    });
    await transaction.finalizeIdempotency({
      accountId: account.id,
      operation: CREATE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
      recordId: claim.claim.recordId,
      status: 'failed',
      responseCode: error.status,
      safeResponse: body,
    });
    return { status: error.status, body };
  });
}

export async function selectOnboardingPlan(
  input: SelectOnboardingPlanInput,
): Promise<OnboardingCommandResponse> {
  const account = await getAccountByClerkUserId(input.principalId);
  if (!account) {
    throw new NotFoundError('Onboarding could not be found.');
  }

  const payloadHash = canonicalRequestHash({
    onboarding_id: input.onboardingId,
    ...input.request,
  });

  return withOnboardingTransaction(input.principalId, async (transaction) => {
    const claim = await transaction.claimIdempotency({
      accountId: account.id,
      operation: SELECT_PLAN_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
    });

    if (claim.kind === 'replayed') {
      return {
        status: claim.responseCode,
        body: claim.safeResponse as CommandBody,
      };
    }
    if (claim.kind === 'key_reused') {
      throw new IdempotencyKeyReusedError(
        'This Idempotency-Key was already used for another request.',
      );
    }
    if (claim.kind === 'in_progress') {
      throw new StateConflictError(
        'An identical plan selection is already being processed. Retry with the same key.',
      );
    }

    const result = await transaction.choosePlan({
      onboardingId: input.onboardingId,
      planCode: input.request.plan_code,
      principalId: input.principalId,
    });

    if (result.kind === 'updated') {
      const body = successBody(input.requestId, toPublicOnboarding(result.onboarding));
      await transaction.appendAudit({
        accountId: account.id,
        actorKind: 'account',
        actorKey: input.principalId,
        action: 'onboarding.plan.selected',
        entityType: 'organization_onboarding',
        entityId: result.onboarding.id,
        outcome: 'succeeded',
        redactedSummary: { plan_code: input.request.plan_code },
        requestId: input.requestId,
      });
      await transaction.finalizeIdempotency({
        accountId: account.id,
        operation: SELECT_PLAN_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        recordId: claim.recordId,
        status: 'succeeded',
        responseCode: 200,
        safeResponse: body,
      });
      return { status: 200, body };
    }

    const error =
      result.kind === 'not_found_or_forbidden'
        ? new NotFoundError('Onboarding could not be found.')
        : result.kind === 'plan_unavailable'
          ? new StateConflictError('The selected plan is unavailable.')
          : new StateConflictError('Onboarding is not eligible for plan selection.');
    const body = failureBody(input.requestId, error.code, error.message);
    await transaction.appendAudit({
      accountId: account.id,
      actorKind: 'account',
      actorKey: input.principalId,
      action: 'onboarding.plan.rejected',
      entityType: 'organization_onboarding',
      entityId: input.onboardingId,
      outcome: 'rejected',
      redactedSummary: { reason: error.code },
      requestId: input.requestId,
    });
    await transaction.finalizeIdempotency({
      accountId: account.id,
      operation: SELECT_PLAN_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
      recordId: claim.recordId,
      status: 'failed',
      responseCode: error.status,
      safeResponse: body,
    });
    return { status: error.status, body };
  });
}

export async function abandonOwnerOnboarding(
  input: AbandonOwnerOnboardingInput,
): Promise<OnboardingCommandResponse> {
  const payloadHash = canonicalRequestHash({
    onboarding_id: input.onboardingId,
    ...input.request,
  });
  const account = await ensureAccount(input.principalId);
  const claim = await claimBootstrapRecord(input.principalId, {
    accountId: account.id,
    operation: ABANDON_OPERATION,
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
      'An identical request is already being processed. Retry with the same key.',
    );
  }

  return withOnboardingTransaction(input.principalId, async (transaction) => {
    const result = await transaction.abandon({
      onboardingId: input.onboardingId,
      principalId: input.principalId,
    });
    if (result.kind === 'not_found_or_forbidden') {
      const error = new NotFoundError('Onboarding could not be found.');
      const body = failureBody(input.requestId, error.code, error.message);
      await transaction.appendAudit({
        accountId: account.id,
        actorKind: 'account',
        actorKey: input.principalId,
        action: 'onboarding.abandon.rejected',
        entityType: 'organization_onboarding',
        outcome: 'rejected',
        redactedSummary: { reason: error.code },
        requestId: input.requestId,
      });
      await transaction.finalizeIdempotency({
        accountId: account.id,
        operation: ABANDON_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        recordId: claim.recordId,
        status: 'failed',
        responseCode: error.status,
        safeResponse: body,
      });
      return { status: error.status, body };
    }
    if (result.kind === 'provisioned') {
      const error = new StateConflictError('Provisioned onboarding cannot be abandoned.');
      const body = failureBody(input.requestId, error.code, error.message);
      await transaction.appendAudit({
        accountId: account.id,
        actorKind: 'account',
        actorKey: input.principalId,
        action: 'onboarding.abandon.rejected',
        entityType: 'organization_onboarding',
        entityId: result.onboarding.id,
        outcome: 'rejected',
        redactedSummary: { reason: error.code },
        requestId: input.requestId,
      });
      await transaction.finalizeIdempotency({
        accountId: account.id,
        operation: ABANDON_OPERATION,
        intentKey: input.idempotencyKey,
        payloadHash,
        recordId: claim.recordId,
        status: 'failed',
        responseCode: error.status,
        safeResponse: body,
      });
      return { status: error.status, body };
    }

    const body = successBody(input.requestId, toPublicOnboarding(result.onboarding));
    await transaction.appendAudit({
      accountId: account.id,
      actorKind: 'account',
      actorKey: input.principalId,
      action: `onboarding.abandon.${result.kind}`,
      entityType: 'organization_onboarding',
      entityId: result.onboarding.id,
      outcome: 'succeeded',
      redactedSummary: { reason_code: input.request.reason_code },
      requestId: input.requestId,
    });
    await transaction.finalizeIdempotency({
      accountId: account.id,
      operation: ABANDON_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
      recordId: claim.recordId,
      status: 'succeeded',
      responseCode: 200,
      safeResponse: body,
    });
    return { status: 200, body };
  });
}

function successBody<T>(requestId: string, data: T): SuccessEnvelope<T> {
  return { success: true, data, request_id: requestId };
}

function failureBody(
  requestId: string,
  code: FailureEnvelope['error']['code'],
  message: string,
): FailureEnvelope {
  return { success: false, error: { code, message }, request_id: requestId };
}

async function finalizeFailure(
  input: StartOwnerOnboardingInput,
  accountId: string,
  recordId: string,
  payloadHash: string,
  response: FailureEnvelope,
  statusCode: number,
): Promise<void> {
  await withOnboardingTransaction(input.principalId, async (transaction) => {
    await transaction.appendAudit({
      accountId,
      actorKind: 'account',
      actorKey: input.principalId,
      action: 'onboarding.create.rejected',
      entityType: 'organization_onboarding',
      outcome: 'rejected',
      redactedSummary: { reason: response.error.code },
      requestId: input.requestId,
    });
    await transaction.finalizeIdempotency({
      accountId,
      operation: CREATE_OPERATION,
      intentKey: input.idempotencyKey,
      payloadHash,
      recordId,
      status: 'failed',
      responseCode: statusCode,
      safeResponse: response,
    });
  });
}

function errorForCreate(kind: CreateOrResumeOnboardingResult['kind']): AppError {
  if (kind === 'owned_tenant') return new StateConflictError('An owned workspace already exists.');
  if (kind === 'active_exists')
    return new StateConflictError('An unfinished onboarding already exists.');
  if (kind === 'organization_conflict')
    return new StateConflictError('That organization is unavailable.');
  return new StateConflictError('Onboarding could not be started.');
}
