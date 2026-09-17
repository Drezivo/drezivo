import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';

import {
  abandonOwnerOnboardingRequest,
  createOwnerOnboardingRequest,
  idempotencyKey as idempotencyKeySchema,
} from '@drezivo/contracts';

import { requireStaffAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { withGlobalTransaction } from '../../db/client.js';
import { createClerkServerAdapter } from '../../integrations/clerk/clerk.adapter.js';
import { ensureAccount, getAccountByClerkUserId } from '../accounts/account.repository.js';
import { appendGlobalAuditEvent } from '../audit/global-audit.repository.js';
import {
  claimBootstrapIdempotency,
  finalizeBootstrapIdempotency,
} from '../bootstrap/bootstrap.repository.js';
import {
  abandonOnboardingInTransaction,
  createOrResumeOnboardingInTransaction,
  getCurrentOwnerOnboarding,
  type OwnerOnboardingRecord,
} from './onboarding.repository.js';
import {
  DependencyUnavailableError,
  IdempotencyKeyReusedError,
  NotFoundError,
  StateConflictError,
  ValidationError,
  isAppError,
  type AppError,
} from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import { sendSuccess, type FailureEnvelope, type SuccessEnvelope } from '../../shared/response.js';

const MAX_BODY_BYTES = 16 * 1024;
const CREATE_OPERATION = 'onboarding.create';
const ABANDON_OPERATION = 'onboarding.abandon';

type PublicOnboarding = {
  id: string;
  organization_name: string;
  requested_slug: string | null;
  status: OwnerOnboardingRecord['status'];
  selected_plan_code: OwnerOnboardingRecord['selectedPlanCode'];
  is_trial_eligible: boolean;
  created_at: string;
  updated_at: string;
};

function toPublicOnboarding(record: OwnerOnboardingRecord): PublicOnboarding {
  return {
    id: record.id,
    organization_name: record.organizationName,
    requested_slug: record.requestedSlug,
    status: record.status,
    selected_plan_code: record.selectedPlanCode,
    is_trial_eligible: record.isTrialEligible,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function principal(req: Request): string {
  const userId = req.clerkPrincipal?.clerkUserId;
  if (!userId) throw new ValidationError('Verified principal is required.');
  return userId;
}

function readIdempotencyKey(req: Request): string {
  const parsed = idempotencyKeySchema.safeParse(req.header('Idempotency-Key')?.trim());
  if (!parsed.success) throw new ValidationError('A valid Idempotency-Key header is required.');
  return parsed.data;
}

function bodyLimit(req: Request, _res: Response, next: NextFunction): void {
  if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > MAX_BODY_BYTES) {
    next(new ValidationError('Request body is too large.'));
    return;
  }
  next();
}

function successBody<T>(req: Request, data: T): SuccessEnvelope<T> {
  return { success: true, data, request_id: req.requestId };
}

function failureBody(
  req: Request,
  code: FailureEnvelope['error']['code'],
  message: string,
): FailureEnvelope {
  return { success: false, error: { code, message }, request_id: req.requestId };
}

function errorForCreate(kind: string): AppError {
  if (kind === 'owned_tenant') return new StateConflictError('An owned workspace already exists.');
  if (kind === 'active_exists')
    return new StateConflictError('An unfinished onboarding already exists.');
  if (kind === 'organization_conflict')
    return new StateConflictError('That organization is unavailable.');
  return new StateConflictError('Onboarding could not be started.');
}

async function finalizeFailure(
  principalId: string,
  accountId: string,
  operation: string,
  intentKey: string,
  payloadHash: string,
  recordId: string,
  response: FailureEnvelope,
  requestId: string,
  action: string,
  statusCode: number,
): Promise<void> {
  await withGlobalTransaction(principalId, async (client) => {
    await appendGlobalAuditEvent(client, {
      accountId,
      actorKind: 'account',
      actorKey: principalId,
      action,
      entityType: 'organization_onboarding',
      outcome: 'rejected',
      redactedSummary: { reason: response.error.code },
      requestId,
    });
    await finalizeBootstrapIdempotency(client, {
      accountId,
      operation,
      intentKey,
      payloadHash,
      recordId,
      status: 'failed',
      responseCode: statusCode,
      safeResponse: response,
    });
  });
}

export const onboardingRouter = Router();

onboardingRouter.get(
  '/onboarding/current',
  requireStaffAuth,
  rateLimit({
    windowMs: 60_000,
    max: 30,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  async (req, res, next) => {
    try {
      const userId = principal(req);
      const [onboarding, account] = await Promise.all([
        getCurrentOwnerOnboarding(userId),
        getAccountByClerkUserId(userId),
      ]);
      sendSuccess(req, res, {
        onboarding: onboarding ? toPublicOnboarding(onboarding) : null,
        has_current_owned_tenant: Boolean(account?.currentOwnedTenantId),
        has_consumed_lifetime_trial: Boolean(account?.trialConsumedAt),
      });
    } catch (error) {
      next(error);
    }
  },
);

onboardingRouter.post(
  '/onboarding',
  requireStaffAuth,
  bodyLimit,
  rateLimit({
    windowMs: 60_000,
    max: 5,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  async (req, res, next) => {
    const userId = principal(req);
    try {
      const parsed = createOwnerOnboardingRequest.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Onboarding request is invalid.');
      const intentKey = readIdempotencyKey(req);
      const payloadHash = canonicalRequestHash(parsed.data);
      const account = await ensureAccount(userId);
      const claim = await withGlobalTransaction(userId, async (client) => {
        const claimed = await claimBootstrapIdempotency(client, {
          accountId: account.id,
          operation: CREATE_OPERATION,
          intentKey,
          payloadHash,
        });
        if (claimed.kind !== 'claimed') return { claim: claimed, otherInProgress: false };
        const other = await client.query<{ id: string }>(
          `SELECT id FROM bootstrap_idempotency_record
           WHERE account_id = $1 AND operation = $2 AND status = 'in_progress'
             AND expires_at > now() AND id <> $3
           LIMIT 1`,
          [account.id, CREATE_OPERATION, claimed.recordId],
        );
        return { claim: claimed, otherInProgress: Boolean(other.rows[0]) };
      });

      if (claim.claim.kind === 'replayed') {
        res.status(claim.claim.responseCode).json(claim.claim.safeResponse);
        return;
      }
      if (claim.claim.kind === 'key_reused') {
        throw new IdempotencyKeyReusedError(
          'This Idempotency-Key was already used for another request.',
        );
      }
      if (claim.claim.kind === 'in_progress') {
        const repaired = await getCurrentOwnerOnboarding(userId);
        if (
          repaired &&
          repaired.organizationName === parsed.data.organization_name &&
          repaired.requestedSlug === (parsed.data.slug ?? null)
        ) {
          const response = successBody(req, toPublicOnboarding(repaired));
          await withGlobalTransaction(userId, async (client) => {
            await appendGlobalAuditEvent(client, {
              accountId: account.id,
              actorKind: 'account',
              actorKey: userId,
              action: 'onboarding.create.repaired',
              entityType: 'organization_onboarding',
              entityId: repaired.id,
              outcome: 'succeeded',
              redactedSummary: { source: 'signed_webhook_marker' },
              requestId: req.requestId,
            });
            await finalizeBootstrapIdempotency(client, {
              accountId: account.id,
              operation: CREATE_OPERATION,
              intentKey,
              payloadHash,
              recordId: claim.claim.recordId,
              status: 'succeeded',
              responseCode: 200,
              safeResponse: response,
            });
          });
          res.status(200).json(response);
          return;
        }
        throw new StateConflictError(
          'An identical onboarding request is already being processed. Retry with the same key.',
        );
      }
      if (claim.otherInProgress) {
        const response = failureBody(
          req,
          'STATE_CONFLICT',
          'Another onboarding request is already being processed. Retry shortly.',
        );
        await finalizeFailure(
          userId,
          account.id,
          CREATE_OPERATION,
          intentKey,
          payloadHash,
          claim.claim.recordId,
          response,
          req.requestId,
          'onboarding.create.rejected',
          409,
        );
        res.status(409).json(response);
        return;
      }

      if (account.currentOwnedTenantId) {
        const error = errorForCreate('owned_tenant');
        const response = failureBody(req, error.code, error.message);
        await finalizeFailure(
          userId,
          account.id,
          CREATE_OPERATION,
          intentKey,
          payloadHash,
          claim.claim.recordId,
          response,
          req.requestId,
          'onboarding.create.rejected',
          error.status,
        );
        res.status(error.status).json(response);
        return;
      }

      const current = await getCurrentOwnerOnboarding(userId);
      if (current) {
        const response = successBody(req, toPublicOnboarding(current));
        await withGlobalTransaction(userId, async (client) => {
          await appendGlobalAuditEvent(client, {
            accountId: account.id,
            actorKind: 'account',
            actorKey: userId,
            action: 'onboarding.create.replayed',
            entityType: 'organization_onboarding',
            entityId: current.id,
            outcome: 'succeeded',
            redactedSummary: { source: 'existing_active_onboarding' },
            requestId: req.requestId,
          });
          await finalizeBootstrapIdempotency(client, {
            accountId: account.id,
            operation: CREATE_OPERATION,
            intentKey,
            payloadHash,
            recordId: claim.claim.recordId,
            status: 'succeeded',
            responseCode: 200,
            safeResponse: response,
          });
        });
        res.status(200).json(response);
        return;
      }

      let organization: Awaited<
        ReturnType<ReturnType<typeof createClerkServerAdapter>['createOrganization']>
      >;
      try {
        organization = await createClerkServerAdapter().createOrganization({
          name: parsed.data.organization_name,
          createdByUserId: userId,
          slug: parsed.data.slug,
          onboardingMarker: { accountId: account.id, attemptId: randomUUID() },
        });
      } catch (error) {
        const appError = isAppError(error)
          ? error
          : new DependencyUnavailableError('Onboarding provider is unavailable.');
        const response = failureBody(
          req,
          appError.code === 'STATE_CONFLICT' ? 'STATE_CONFLICT' : 'DEPENDENCY_UNAVAILABLE',
          appError.code === 'STATE_CONFLICT'
            ? appError.message
            : 'Onboarding provider is temporarily unavailable.',
        );
        await finalizeFailure(
          userId,
          account.id,
          CREATE_OPERATION,
          intentKey,
          payloadHash,
          claim.claim.recordId,
          response,
          req.requestId,
          'onboarding.create.failed',
          appError.status === 409 ? 409 : 503,
        );
        next(appError);
        return;
      }

      let outcome: { status: number; body: SuccessEnvelope<PublicOnboarding> | FailureEnvelope };
      try {
        outcome = await withGlobalTransaction(userId, async (client) => {
          const result = await createOrResumeOnboardingInTransaction(
            client,
            account.id,
            organization.id,
            userId,
            {
              organizationName: parsed.data.organization_name,
              requestedSlug: parsed.data.slug ?? null,
            },
          );
          if (result.kind === 'created' || result.kind === 'existing') {
            const body = successBody(req, toPublicOnboarding(result.onboarding));
            await appendGlobalAuditEvent(client, {
              accountId: account.id,
              actorKind: 'account',
              actorKey: userId,
              action: `onboarding.create.${result.kind}`,
              entityType: 'organization_onboarding',
              entityId: result.onboarding.id,
              outcome: 'succeeded',
              redactedSummary: { provider: 'clerk' },
              requestId: req.requestId,
            });
            await finalizeBootstrapIdempotency(client, {
              accountId: account.id,
              operation: CREATE_OPERATION,
              intentKey,
              payloadHash,
              recordId: claim.claim.recordId,
              status: 'succeeded',
              responseCode: result.kind === 'created' ? 201 : 200,
              safeResponse: body,
            });
            return { status: result.kind === 'created' ? 201 : 200, body };
          }
          const error = errorForCreate(result.kind);
          const body = failureBody(req, error.code, error.message);
          await appendGlobalAuditEvent(client, {
            accountId: account.id,
            actorKind: 'account',
            actorKey: userId,
            action: 'onboarding.create.rejected',
            entityType: 'organization_onboarding',
            outcome: 'rejected',
            redactedSummary: { reason: error.code },
            requestId: req.requestId,
          });
          await finalizeBootstrapIdempotency(client, {
            accountId: account.id,
            operation: CREATE_OPERATION,
            intentKey,
            payloadHash,
            recordId: claim.claim.recordId,
            status: 'failed',
            responseCode: error.status,
            safeResponse: body,
          });
          return { status: error.status, body };
        });
      } catch (error) {
        // Provider success with a local transaction failure remains in progress. The signed
        // organization.created marker repairs the local row without a second provider create.
        next(error);
        return;
      }
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      next(error);
    }
  },
);

onboardingRouter.post(
  '/onboarding/:onboardingId/abandon',
  requireStaffAuth,
  bodyLimit,
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyOf: (req) => req.clerkPrincipal?.clerkUserId ?? req.ip ?? 'unknown',
  }),
  async (req, res, next) => {
    try {
      const userId = principal(req);
      const onboardingId = String(req.params.onboardingId ?? '');
      if (!idempotencyKeySchema.uuid().safeParse(onboardingId).success) {
        throw new ValidationError('Onboarding ID is invalid.');
      }
      const parsedBody = abandonOwnerOnboardingRequest.safeParse(req.body);
      if (!parsedBody.success) throw new ValidationError('Abandon request is invalid.');
      const intentKey = readIdempotencyKey(req);
      const payloadHash = canonicalRequestHash({ onboarding_id: onboardingId, ...parsedBody.data });
      const account = await ensureAccount(userId);
      const claim = await withGlobalTransaction(userId, (client) =>
        claimBootstrapIdempotency(client, {
          accountId: account.id,
          operation: ABANDON_OPERATION,
          intentKey,
          payloadHash,
        }),
      );
      if (claim.kind === 'replayed') {
        res.status(claim.responseCode).json(claim.safeResponse);
        return;
      }
      if (claim.kind === 'key_reused')
        throw new IdempotencyKeyReusedError(
          'This Idempotency-Key was already used for another request.',
        );
      if (claim.kind === 'in_progress')
        throw new StateConflictError(
          'An identical request is already being processed. Retry with the same key.',
        );

      const outcome = await withGlobalTransaction(userId, async (client) => {
        const result = await abandonOnboardingInTransaction(client, onboardingId, userId);
        if (result.kind === 'not_found_or_forbidden') {
          const error = new NotFoundError('Onboarding could not be found.');
          const body = failureBody(req, error.code, error.message);
          await appendGlobalAuditEvent(client, {
            accountId: account.id,
            actorKind: 'account',
            actorKey: userId,
            action: 'onboarding.abandon.rejected',
            entityType: 'organization_onboarding',
            outcome: 'rejected',
            redactedSummary: { reason: error.code },
            requestId: req.requestId,
          });
          await finalizeBootstrapIdempotency(client, {
            accountId: account.id,
            operation: ABANDON_OPERATION,
            intentKey,
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
          const body = failureBody(req, error.code, error.message);
          await appendGlobalAuditEvent(client, {
            accountId: account.id,
            actorKind: 'account',
            actorKey: userId,
            action: 'onboarding.abandon.rejected',
            entityType: 'organization_onboarding',
            entityId: result.onboarding.id,
            outcome: 'rejected',
            redactedSummary: { reason: error.code },
            requestId: req.requestId,
          });
          await finalizeBootstrapIdempotency(client, {
            accountId: account.id,
            operation: ABANDON_OPERATION,
            intentKey,
            payloadHash,
            recordId: claim.recordId,
            status: 'failed',
            responseCode: error.status,
            safeResponse: body,
          });
          return { status: error.status, body };
        }
        const body = successBody(req, toPublicOnboarding(result.onboarding));
        await appendGlobalAuditEvent(client, {
          accountId: account.id,
          actorKind: 'account',
          actorKey: userId,
          action: `onboarding.abandon.${result.kind}`,
          entityType: 'organization_onboarding',
          entityId: result.onboarding.id,
          outcome: 'succeeded',
          redactedSummary: { reason_provided: true },
          requestId: req.requestId,
        });
        await finalizeBootstrapIdempotency(client, {
          accountId: account.id,
          operation: ABANDON_OPERATION,
          intentKey,
          payloadHash,
          recordId: claim.recordId,
          status: 'succeeded',
          responseCode: 200,
          safeResponse: body,
        });
        return { status: 200, body };
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      next(error);
    }
  },
);
