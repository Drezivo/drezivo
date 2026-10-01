import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../config/index.js';

/**
 * Lets an operator open a business's proof of payment without the business API exposing an
 * operator login. The operator API (separate repository) authorizes its operator, then signs
 *   p1.<tenantId>.<paymentId>.<expiresAtSeconds>.<signature>
 * with HMAC-SHA256 over everything before the signature, using OPERATOR_PROOF_LINK_SECRET (the
 * same value on both services). Links live at most PROOF_LINK_MAX_TTL_SECONDS. This API verifies
 * the link and redirects to a short-lived signed storage URL. Without the secret, proof links are
 * off. The secret, links, and URLs are never logged.
 */
export const PROOF_LINK_MAX_TTL_SECONDS = 5 * 60;
/** The two services run on different hosts; a slightly fast operator clock must not void every link. */
const CLOCK_SKEW_SECONDS = 60;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LINK_SHAPE = new RegExp(`^p1\\.(${UUID})\\.(${UUID})\\.(\\d{10})\\.([A-Za-z0-9_-]{43})$`);

export interface ProofLinkGrant {
  tenantId: string;
  paymentId: string;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

/** Used by tests and documents the format the operator API produces. */
export function signProofLink(grant: ProofLinkGrant, expiresAt: Date, secret: string): string {
  const payload = `p1.${grant.tenantId}.${grant.paymentId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyProofLink(
  token: string,
  now = new Date(),
  secret: string | undefined = config.OPERATOR_PROOF_LINK_SECRET,
): ProofLinkGrant | null {
  if (!secret || token.length > 200) return null;
  const match = LINK_SHAPE.exec(token);
  if (!match) return null;
  const [, tenantId, paymentId, expires, signature] = match as unknown as [string, string, string, string, string];
  const expected = Buffer.from(sign(`p1.${tenantId}.${paymentId}.${expires}`, secret), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresMs = Number(expires) * 1000;
  if (expiresMs <= now.getTime() || expiresMs > now.getTime() + (PROOF_LINK_MAX_TTL_SECONDS + CLOCK_SKEW_SECONDS) * 1000) return null;
  return { tenantId, paymentId };
}
