import type { PoolClient } from 'pg';

import {
  DependencyUnavailableError,
  IdempotencyKeyReusedError,
  StateConflictError,
  isAppError,
} from './errors.js';
import { canonicalRequestHash } from './idempotency.js';
import type { FailureEnvelope, SuccessEnvelope } from './response.js';
import { claimTenantIdempotency, finalizeTenantIdempotency } from './tenant-idempotency.js';

export interface CommandResult<T> {
  status: number;
  body: SuccessEnvelope<T> | FailureEnvelope;
}

export interface IdempotentCommandScope {
  tenantId: string;
  /** Who owns the key: a membership id for staff, a store-scoped guest digest for guests. */
  principalKey: string;
  operation: string;
  intentKey: string;
  requestId: string;
}

const SAVEPOINT = 'idempotent_command_effects';

/**
 * Runs one mutation at most once per (principal, operation, Idempotency-Key) inside the caller's
 * tenant transaction. A retry with the same key and payload replays the stored response; the same
 * key with a different payload is rejected. Expected business failures (AppError) are recorded as
 * the key's outcome after rolling back the command's own writes, so a failure never leaves partial
 * rows behind and a retry returns the same failure instead of trying again with stale input.
 */
export async function runIdempotentCommand<T>(
  client: PoolClient,
  scope: IdempotentCommandScope,
  payload: unknown,
  execute: () => Promise<T>,
  successStatus = 200,
): Promise<CommandResult<T>> {
  const payloadHash = canonicalRequestHash(payload);
  const keyInput = {
    tenantId: scope.tenantId,
    principalKey: scope.principalKey,
    operation: scope.operation,
    intentKey: scope.intentKey,
    payloadHash,
  };

  const claim = await claimTenantIdempotency(client, keyInput);
  if (claim.kind === 'replayed') {
    return { status: claim.responseCode, body: claim.safeResponse as CommandResult<T>['body'] };
  }
  if (claim.kind === 'key_reused') {
    throw new IdempotencyKeyReusedError('This Idempotency-Key was already used for a different request.');
  }
  if (claim.kind === 'in_progress') {
    throw new StateConflictError('An identical request is already being processed.');
  }

  await client.query(`SAVEPOINT ${SAVEPOINT}`);
  let result: CommandResult<T>;
  try {
    const data = await execute();
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    result = { status: successStatus, body: { success: true, data, request_id: scope.requestId } };
  } catch (error) {
    if (error instanceof DependencyUnavailableError) throw error;
    if (!isAppError(error)) throw error;
    await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    result = {
      status: error.status,
      body: { success: false, error: { code: error.code, message: error.message }, request_id: scope.requestId },
    };
  }

  await finalizeTenantIdempotency(client, {
    ...keyInput,
    status: result.body.success ? 'succeeded' : 'failed',
    responseCode: result.status,
    safeResponse: result.body,
  });
  return result;
}
