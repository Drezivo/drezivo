import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../config/index.js';

/**
 * Owner preview of a storefront that is not published yet. A preview token is a short-lived,
 * read-only credential: `v1.<tenantId>.<storefrontId>.<expiresAtSeconds>.<signature>`, signed with
 * HMAC-SHA256. It opens public READS of exactly that storefront, never bookings or verification,
 * so a preview can not create a reservation on a store renters can not see yet.
 *
 * The signing key is derived from INVITATION_EMAIL_DIGEST_KEY with a purpose label, which keeps
 * the two uses cryptographically separate without adding a secret every deployment must set.
 */

export const PREVIEW_TTL_SECONDS = 60 * 60;
const VERSION = 'v1';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN_SHAPE = new RegExp(`^${VERSION}\\.(${UUID})\\.(${UUID})\\.(\\d{10})\\.([A-Za-z0-9_-]{43})$`);

export interface PreviewGrant {
  tenantId: string;
  storefrontId: string;
}

function signingKey(): Buffer {
  const root = Buffer.from(config.INVITATION_EMAIL_DIGEST_KEY, 'base64url');
  return createHmac('sha256', root).update('drezivo:storefront-preview:v1', 'utf8').digest();
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload, 'utf8').digest('base64url');
}

export function issuePreviewToken(grant: PreviewGrant, now = new Date()): { token: string; expiresAt: Date } {
  const expiresAt = new Date((Math.floor(now.getTime() / 1000) + PREVIEW_TTL_SECONDS) * 1000);
  const payload = `${VERSION}.${grant.tenantId}.${grant.storefrontId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

/** The grant the token carries, or null for anything malformed, tampered with, or expired. */
export function verifyPreviewToken(token: string | undefined, now = new Date()): PreviewGrant | null {
  if (!token || token.length > 200) return null;
  const match = TOKEN_SHAPE.exec(token);
  if (!match) return null;
  const [, tenantId, storefrontId, expires, signature] = match as unknown as [string, string, string, string, string];
  const expected = Buffer.from(sign(`${VERSION}.${tenantId}.${storefrontId}.${expires}`), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expires) * 1000 <= now.getTime()) return null;
  return { tenantId, storefrontId };
}
