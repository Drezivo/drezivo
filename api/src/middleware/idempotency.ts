import { createHash } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { config } from '../config/index.js';
import { withTenantTransaction } from '../db/client.js';
import { IdempotencyKeyReusedError, StateConflictError, ValidationError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { sendError } from '../shared/response.js';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export interface IdempotencyScope {
  tenantId: string;
  /** Server-derived namespace — a staff membership id, or a checkout-session id for anonymous guests. Never a raw client-supplied user id (Data-Model §8). */
  principalKey: string;
  operation: string;
}

/**
 * TRD §4 idempotency contract, implemented once, shared by every mutating route:
 *
 *   "On the server, scope a unique idempotency record by tenant, stable authenticated or
 *   checkout principal, operation, and key. Store a canonical validated request hash. Same
 *   key/different hash returns 409; a concurrent matching request waits briefly or returns an
 *   in-progress response with retry guidance. Commit the domain change, outcome and outbox
 *   rows atomically."
 *
 * This middleware only handles the CLAIM (insert-if-absent) and the REPLAY (return the stored
 * outcome for an exact repeat). The actual domain change + outbox row are committed together
 * inside the route handler's own transaction — this middleware never wraps the handler in a
 * transaction of its own, because holding a claim-transaction open across the handler's
 * unrelated DB work (and a mutating call to Clerk/S3) would serialize unrelated requests
 * against this one row for no reason.
 */
export function idempotent(
  operation: string,
  resolveScope: (req: Request) => Omit<IdempotencyScope, 'operation'>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handle(req, res, next, operation, resolveScope);
  };
}

async function handle(
  req: Request,
  res: Response,
  next: NextFunction,
  operation: string,
  resolveScope: (req: Request) => Omit<IdempotencyScope, 'operation'>,
): Promise<void> {
  try {
    const intentKey = req.header(IDEMPOTENCY_KEY_HEADER);
    if (!intentKey || intentKey.length > 200) {
      throw new ValidationError(`Header "Idempotency-Key" is required for ${operation}.`);
    }

    const { tenantId, principalKey } = resolveScope(req);
    const payloadHash = canonicalHash(req.body as unknown);

    const claim = await withTenantTransaction(tenantId, principalKey, async (client) => {
      const expiresAt = new Date(Date.now() + config.IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      // ON CONFLICT DO NOTHING is the atomic "claim if absent" step — a plain
      // SELECT-then-INSERT here would let two concurrent identical requests both observe "no
      // row yet" and both proceed, exactly the double-submit this table exists to prevent.
      const inserted = await client.query<{
        id: string;
        status: 'in_progress' | 'succeeded' | 'failed';
        payload_hash: string;
        response_code: number | null;
        safe_response: Record<string, unknown> | null;
      }>(
        `INSERT INTO idempotency_record (tenant_id, principal_key, operation, intent_key, payload_hash, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'in_progress', $6)
         ON CONFLICT (tenant_id, principal_key, operation, intent_key) DO NOTHING
         RETURNING id, status, payload_hash, response_code, safe_response`,
        [tenantId, principalKey, operation, intentKey, payloadHash, expiresAt],
      );

      if (inserted.rows[0]) {
        return { won: true as const, recordId: inserted.rows[0].id };
      }

      // Lost the claim race (or this is a genuine retry) — fetch the existing row to decide
      // between "replay the stored outcome" and "reject: same key, different request".
      const existing = await client.query<{
        id: string;
        status: 'in_progress' | 'succeeded' | 'failed';
        payload_hash: string;
        response_code: number | null;
        safe_response: Record<string, unknown> | null;
      }>(
        `SELECT id, status, payload_hash, response_code, safe_response FROM idempotency_record
         WHERE tenant_id = $1 AND principal_key = $2 AND operation = $3 AND intent_key = $4`,
        [tenantId, principalKey, operation, intentKey],
      );
      const row = existing.rows[0];
      if (!row) {
        // Extremely narrow race: conflicted on insert, then the row vanished (TTL sweep).
        // Safe to treat as "not claimed"; caller can retry with a fresh request.
        throw new StateConflictError('Idempotency claim could not be established; retry the request.');
      }
      return { won: false as const, record: row };
    });

    if (claim.won) {
      // Capture the outcome once the handler finishes, so this same middleware call can
      // finalize the row without the handler needing to know idempotency exists at all.
      finalizeOnResponse(res, tenantId, principalKey, operation, intentKey);
      next();
      return;
    }

    if (claim.record.payload_hash !== payloadHash) {
      throw new IdempotencyKeyReusedError(
        'This idempotency key was already used with a different request body. Use a new key for a new intent.',
      );
    }

    if (claim.record.status === 'in_progress') {
      // TRD §4: "a concurrent matching request ... returns an in-progress response with retry
      // guidance" — the ORIGINAL request has not committed yet, so there is no outcome to
      // replay; the caller retries the SAME key shortly instead of generating a new one.
      sendError(
        res,
        409,
        'STATE_CONFLICT',
        'An identical request is already being processed. Retry shortly with the same key.',
        req.requestId,
      );
      return;
    }

    // Exact replay: same scope, same key, same payload hash, already resolved — return the
    // original outcome verbatim rather than re-running the handler (this is what makes a
    // network-retried POST safe).
    res.status(claim.record.response_code ?? 200).json(claim.record.safe_response ?? {});
  } catch (error) {
    next(error);
  }
}

function finalizeOnResponse(
  res: Response,
  tenantId: string,
  principalKey: string,
  operation: string,
  intentKey: string,
): void {
  const originalJson = res.json.bind(res);
  let capturedBody: unknown;

  res.json = ((body: unknown) => {
    capturedBody = body;
    return originalJson(body);
  }) as Response['json'];

  res.on('finish', () => {
    const status = res.statusCode < 400 ? 'succeeded' : 'failed';
    // Deliberately not awaited on the request path: the HTTP response has already been sent,
    // and this write only finalizes OUR OWN bookkeeping ledger, not the business outcome
    // itself (which is already durably committed inside the handler's own transaction before
    // this ever runs). A failure here just leaves the record `in_progress` until its TTL
    // expires — the worst case is one retry window has degraded replay, not a lost or
    // duplicated business effect, so this is not the fire-and-forget the non-negotiable rule
    // is aimed at (outbox rows are; see worker/handlers/outbox-dispatcher.ts for that path).
    void withTenantTransaction(tenantId, principalKey, async (client) => {
      await client.query(
        `UPDATE idempotency_record SET status = $5, response_code = $6, safe_response = $7
         WHERE tenant_id = $1 AND principal_key = $2 AND operation = $3 AND intent_key = $4`,
        [tenantId, principalKey, operation, intentKey, status, res.statusCode, JSON.stringify(capturedBody ?? {})],
      );
    }).catch((error: unknown) => {
      logger.error({ err: error, tenantId, operation }, 'failed to finalize idempotency record');
    });
  });
}

/** Deterministic hash over the validated request body: same intent -> same hash regardless of key ordering. */
function canonicalHash(body: unknown): string {
  const canonical = JSON.stringify(sortKeysDeep(body));
  return createHash('sha256').update(canonical).digest('hex');
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(record[key]);
        return acc;
      }, {});
  }
  return value;
}
