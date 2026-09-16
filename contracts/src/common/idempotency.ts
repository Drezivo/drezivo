/**
 * TRD §4 "Idempotency contract" — "Generate one key per user intent; reuse
 * it across network retries. A new edited intent receives a new key... On
 * the server, scope a unique idempotency record by tenant, stable
 * authenticated or checkout principal, operation, and key. Store a
 * canonical validated request hash. Same key/different hash returns 409; a
 * concurrent matching request waits briefly or returns an in-progress
 * response with retry guidance."
 * PRD §3 — "One idempotency key per intent plus conditional
 * transitions/database constraints means sequential and concurrent
 * double-fire tests yield zero duplicate reservations, allocations, or
 * postings."
 *
 * This module is documentation-as-code: the header name and key format are
 * the part of the idempotency contract every consumer must literally agree
 * on. The server-side storage/locking mechanics (principal scoping, request
 * hashing, retention window) are implemented in `api`, not here — this
 * package only fixes the wire-visible shape.
 */
import { z } from 'zod';

/** The header name every mutating endpoint that requires idempotency reads. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;

/**
 * Client-generated opaque token, one per user intent (not per HTTP attempt).
 * A UUID is a good default generator but the contract does not require one
 * — any sufficiently random, sufficiently unique-per-intent string works, so
 * this is bounded and printable rather than UUID-shaped.
 */
export const idempotencyKey = z
  .string()
  .min(8, 'idempotency key must be at least 8 characters to carry enough entropy')
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/, 'idempotency key must be URL-safe (letters, digits, - and _)');
export type IdempotencyKey = z.infer<typeof idempotencyKey>;

/**
 * Every request schema for an endpoint documented as idempotency-protected
 * embeds this so the key travels through the same validated request object
 * as the rest of the body — even though it is transmitted as a header, not
 * a body field, keeping it in the schema makes the requirement visible at
 * the type level instead of only in a route's middleware config.
 */
export const idempotentRequestHeaders = z.object({
  idempotency_key: idempotencyKey,
});
export type IdempotentRequestHeaders = z.infer<typeof idempotentRequestHeaders>;
