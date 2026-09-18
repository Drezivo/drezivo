import type { PoolClient } from 'pg';

import { config } from '../config/index.js';

export type TenantIdempotencyClaim =
  | { kind: 'claimed'; recordId: string }
  | { kind: 'replayed'; responseCode: number; safeResponse: unknown }
  | { kind: 'in_progress' }
  | { kind: 'key_reused' };

export async function claimTenantIdempotency(
  client: PoolClient,
  input: {
    tenantId: string;
    principalKey: string;
    operation: string;
    intentKey: string;
    payloadHash: string;
  },
): Promise<TenantIdempotencyClaim> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO idempotency_record
       (tenant_id, principal_key, operation, intent_key, payload_hash, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'in_progress', now() + ($6::integer * interval '1 day'))
     ON CONFLICT (tenant_id, principal_key, operation, intent_key) DO NOTHING
     RETURNING id`,
    [
      input.tenantId,
      input.principalKey,
      input.operation,
      input.intentKey,
      input.payloadHash,
      config.IDEMPOTENCY_RETENTION_DAYS,
    ],
  );
  if (inserted.rows[0]) return { kind: 'claimed', recordId: inserted.rows[0].id };

  const existing = await client.query<{
    payload_hash: string;
    status: 'in_progress' | 'succeeded' | 'failed';
    response_code: number | null;
    safe_response: Record<string, unknown> | null;
  }>(
    `SELECT payload_hash, status, response_code, safe_response
       FROM idempotency_record
      WHERE tenant_id = $1 AND principal_key = $2 AND operation = $3 AND intent_key = $4
      FOR UPDATE`,
    [input.tenantId, input.principalKey, input.operation, input.intentKey],
  );
  const row = existing.rows[0];
  if (!row) return { kind: 'in_progress' };
  if (row.payload_hash !== input.payloadHash) return { kind: 'key_reused' };
  if (row.status === 'in_progress' || row.response_code === null || row.safe_response === null) {
    return { kind: 'in_progress' };
  }
  return { kind: 'replayed', responseCode: row.response_code, safeResponse: row.safe_response };
}

export async function finalizeTenantIdempotency(
  client: PoolClient,
  input: {
    tenantId: string;
    principalKey: string;
    operation: string;
    intentKey: string;
    payloadHash: string;
    status: 'succeeded' | 'failed';
    responseCode: number;
    safeResponse: unknown;
  },
): Promise<void> {
  const result = await client.query(
    `UPDATE idempotency_record
        SET status = $6, response_code = $7, safe_response = $8::jsonb
      WHERE tenant_id = $1 AND principal_key = $2 AND operation = $3 AND intent_key = $4
        AND payload_hash = $5 AND status = 'in_progress'`,
    [
      input.tenantId,
      input.principalKey,
      input.operation,
      input.intentKey,
      input.payloadHash,
      input.status,
      input.responseCode,
      JSON.stringify(input.safeResponse),
    ],
  );
  if (result.rowCount !== 1) throw new Error('Tenant idempotency record could not be finalized.');
}
