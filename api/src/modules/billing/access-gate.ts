import type { SubscriptionAccess } from '@drezivo/contracts';

import { SubscriptionLockedError, SubscriptionReadOnlyError } from '../../shared/errors.js';

/**
 * Applies the derived subscription access (./access.ts) to every staff request, centrally, right
 * after the tenant context is resolved, so no route can forget it:
 * - full: everything.
 * - read_only: reads, plus paying for the subscription (and uploading its proof).
 * - locked: only the actor context, the billing reads, and paying.
 * The operator's manual lock (tenant.status = 'restricted') is enforced separately by
 * tenancy.service's action gate.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Requests allowed in every access level: what a locked owner needs in order to subscribe. */
const ALWAYS_ALLOWED: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/api\/v1\/actor-context$/ },
  { method: 'GET', path: /^\/api\/v1\/billing$/ },
  { method: 'GET', path: new RegExp(`^/api/v1/billing/payment-methods/${UUID}/qr$`, 'i') },
  { method: 'POST', path: /^\/api\/v1\/billing\/payments$/ },
  { method: 'POST', path: new RegExp(`^/api/v1/uploads/${UUID}/finalize$`, 'i') },
];

const PROOF_UPLOAD = /^\/api\/v1\/uploads$/;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface GateRequest {
  method: string;
  /** Path without the query string, e.g. /api/v1/reservations. */
  path: string;
  /** Parsed JSON body, used only to recognise a payment-proof upload. */
  body: unknown;
}

export function assertSubscriptionAccess(request: GateRequest, access: SubscriptionAccess): void {
  if (access.level === 'full') return;
  const method = request.method.toUpperCase();
  if (ALWAYS_ALLOWED.some((rule) => rule.method === method && rule.path.test(request.path))) return;
  if (method === 'POST' && PROOF_UPLOAD.test(request.path) && isProofUpload(request.body)) return;

  if (access.level === 'read_only') {
    if (READ_METHODS.has(method)) return;
    throw new SubscriptionReadOnlyError('This workspace is view-only until the subscription is paid.');
  }
  throw new SubscriptionLockedError('This workspace is locked until the subscription is paid.');
}

function isProofUpload(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { purpose?: unknown }).purpose === 'subscription_payment_proof';
}
