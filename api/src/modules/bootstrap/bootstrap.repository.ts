import type { PoolClient } from 'pg';

import { config } from '../../config/index.js';
import { ValidationError } from '../../shared/errors.js';
import { serializeBoundedJson } from '../../shared/safe-json.js';

type BootstrapStatus = 'in_progress' | 'succeeded' | 'failed';

export interface ClaimBootstrapIdempotencyInput {
  accountId: string;
  operation: string;
  intentKey: string;
  payloadHash: string;
}

export type BootstrapIdempotencyClaim =
  | { kind: 'claimed'; recordId: string; expiresAt: Date }
  | {
      kind: 'replayed';
      recordId: string;
      status: Exclude<BootstrapStatus, 'in_progress'>;
      responseCode: number;
      safeResponse: unknown;
    }
  | { kind: 'in_progress'; recordId: string; expiresAt: Date }
  | { kind: 'key_reused'; recordId: string };

export interface FinalizeBootstrapIdempotencyInput extends ClaimBootstrapIdempotencyInput {
  recordId: string;
  status: Exclude<BootstrapStatus, 'in_progress'>;
  responseCode: number;
  safeResponse: unknown;
}

export type FinalizeBootstrapIdempotencyResult =
  | { kind: 'finalized'; recordId: string; status: Exclude<BootstrapStatus, 'in_progress'> }
  | {
      kind: 'already_finalized';
      recordId: string;
      status: Exclude<BootstrapStatus, 'in_progress'>;
      responseCode: number;
      safeResponse: unknown;
    }
  | { kind: 'key_reused'; recordId: string }
  | { kind: 'not_found' }
  | { kind: 'not_in_progress'; recordId: string };

interface BootstrapIdempotencyRow {
  id: string;
  payload_hash: string;
  status: BootstrapStatus;
  response_code: number | null;
  safe_response: unknown;
  expires_at: Date;
}

/**
 * Claims an account-scoped pre-tenant key using one atomic insert/reclaim statement. A
 * non-expired row is never overwritten; an expired row is reclaimed with database `now()` so
 * the retention boundary is consistent across API instances.
 */
export async function claimBootstrapIdempotency(
  client: PoolClient,
  input: ClaimBootstrapIdempotencyInput,
): Promise<BootstrapIdempotencyClaim> {
  validateClaimInput(input);

  const inserted = await client.query<BootstrapIdempotencyRow>(
    `INSERT INTO bootstrap_idempotency_record
       (account_id, operation, intent_key, payload_hash, status, expires_at)
     VALUES ($1, $2, $3, $4, 'in_progress', now() + ($5 * interval '1 day'))
     ON CONFLICT (account_id, operation, intent_key) DO UPDATE
       SET payload_hash = EXCLUDED.payload_hash,
           status = 'in_progress',
           response_code = NULL,
           safe_response = NULL,
           expires_at = EXCLUDED.expires_at,
           created_at = now()
       WHERE bootstrap_idempotency_record.expires_at <= now()
     RETURNING id, payload_hash, status, response_code, safe_response, expires_at`,
    [input.accountId, input.operation, input.intentKey, input.payloadHash, config.IDEMPOTENCY_RETENTION_DAYS],
  );

  if (inserted.rows[0]) {
    return {
      kind: 'claimed',
      recordId: inserted.rows[0].id,
      expiresAt: inserted.rows[0].expires_at,
    };
  }

  const existing = await findRecord(client, input);
  if (!existing) {
    // The account row is protected by RLS and the unique key is atomic. A missing row after a
    // conflict means another transaction reclaimed/removed it between statements; callers can
    // retry rather than treating an unobserved claim as successful.
    throw new ValidationError('Bootstrap idempotency claim could not be established; retry the request.');
  }
  if (existing.payload_hash !== input.payloadHash) {
    return { kind: 'key_reused', recordId: existing.id };
  }
  if (existing.status === 'in_progress') {
    return { kind: 'in_progress', recordId: existing.id, expiresAt: existing.expires_at };
  }
  return {
    kind: 'replayed',
    recordId: existing.id,
    status: existing.status,
    responseCode: existing.response_code as number,
    safeResponse: existing.safe_response,
  };
}

/**
 * Finalizes only the matching in-progress claim. Call this with the same client/transaction as
 * the business effect and audit append so a rollback removes all three together.
 */
export async function finalizeBootstrapIdempotency(
  client: PoolClient,
  input: FinalizeBootstrapIdempotencyInput,
): Promise<FinalizeBootstrapIdempotencyResult> {
  validateClaimInput(input);
  validateTerminalInput(input);
  const serialized = serializeBoundedJson(input.safeResponse, 'Idempotency safe response');

  const finalized = await client.query<{ id: string; status: Exclude<BootstrapStatus, 'in_progress'> }>(
    `UPDATE bootstrap_idempotency_record
     SET status = $6, response_code = $7, safe_response = $8
     WHERE id = $1
       AND account_id = $2
       AND operation = $3
       AND intent_key = $4
       AND payload_hash = $5
       AND status = 'in_progress'
     RETURNING id, status`,
    [
      input.recordId,
      input.accountId,
      input.operation,
      input.intentKey,
      input.payloadHash,
      input.status,
      input.responseCode,
      serialized,
    ],
  );
  if (finalized.rows[0]) {
    return { kind: 'finalized', recordId: finalized.rows[0].id, status: finalized.rows[0].status };
  }

  const existing = await findRecord(client, input);
  if (!existing) {
    return { kind: 'not_found' };
  }
  if (existing.payload_hash !== input.payloadHash) {
    return { kind: 'key_reused', recordId: existing.id };
  }
  if (existing.status === 'in_progress') {
    return { kind: 'not_in_progress', recordId: existing.id };
  }
  return {
    kind: 'already_finalized',
    recordId: existing.id,
    status: existing.status,
    responseCode: existing.response_code as number,
    safeResponse: existing.safe_response,
  };
}

async function findRecord(
  client: PoolClient,
  input: Pick<ClaimBootstrapIdempotencyInput, 'accountId' | 'operation' | 'intentKey'>,
): Promise<BootstrapIdempotencyRow | null> {
  const result = await client.query<BootstrapIdempotencyRow>(
    `SELECT id, payload_hash, status, response_code, safe_response, expires_at
     FROM bootstrap_idempotency_record
     WHERE account_id = $1 AND operation = $2 AND intent_key = $3`,
    [input.accountId, input.operation, input.intentKey],
  );
  return result.rows[0] ?? null;
}

function validateClaimInput(input: ClaimBootstrapIdempotencyInput): void {
  if (
    typeof input.accountId !== 'string' ||
    typeof input.operation !== 'string' ||
    input.operation.length < 1 ||
    input.operation.length > 100
  ) {
    throw new ValidationError('Bootstrap idempotency account and operation are required.');
  }
  if (
    typeof input.intentKey !== 'string' ||
    input.intentKey.length < 1 ||
    input.intentKey.length > 255
  ) {
    throw new ValidationError('Bootstrap idempotency intent key must be 1-255 characters.');
  }
  if (typeof input.payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.payloadHash)) {
    throw new ValidationError('Bootstrap idempotency payload hash must be a SHA-256 hex digest.');
  }
}

function validateTerminalInput(input: FinalizeBootstrapIdempotencyInput): void {
  if (!input.recordId) {
    throw new ValidationError('Bootstrap idempotency record ID is required.');
  }
  if (!Number.isInteger(input.responseCode) || input.responseCode < 100 || input.responseCode > 599) {
    throw new ValidationError('Bootstrap idempotency response code must be an HTTP status code.');
  }
}
