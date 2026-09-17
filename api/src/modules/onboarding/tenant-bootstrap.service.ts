import { IdempotencyKeyReusedError, StateConflictError, ForbiddenError } from '../../shared/errors.js';
import { canonicalRequestHash } from '../../shared/idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from '../../shared/response.js';
import { runTenantBootstrap } from './tenant-bootstrap.persistence.js';
import type { BootstrapTenantInput } from './onboarding.schemas.js';

export interface BootstrapTenantCommandInput {
  principalId: string;
  clerkOrgId: string | null;
  requestId: string;
  idempotencyKey: string;
  onboardingId: string;
  request: BootstrapTenantInput;
}

export type BootstrapTenantCommandResponse =
  | { status: number; body: SuccessEnvelope<unknown> | FailureEnvelope };

/** Runs the authenticated owner bootstrap command and maps persistence results to HTTP shapes. */
export async function bootstrapOwnerTenant(
  input: BootstrapTenantCommandInput,
): Promise<BootstrapTenantCommandResponse> {
  if (!input.clerkOrgId) {
    throw new ForbiddenError('An active organization is required.');
  }
  const result = await runTenantBootstrap({
    principalId: input.principalId,
    clerkOrgId: input.clerkOrgId,
    onboardingId: input.onboardingId,
    idempotencyKey: input.idempotencyKey,
    payloadHash: canonicalRequestHash({ onboarding_id: input.onboardingId, body: input.request }),
    requestId: input.requestId,
  });
  if (result.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError(
      'This Idempotency-Key was already used for another request.',
    );
  }
  if (result.kind === 'in_progress') {
    throw new StateConflictError(
      'An identical bootstrap request is already being processed. Retry with the same key.',
    );
  }
  if (result.kind === 'replayed' || result.kind === 'success' || result.kind === 'rejected') {
    return { status: result.status, body: result.body };
  }
  throw new StateConflictError('Tenant bootstrap could not be completed.');
}
