import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../config/index.js';

const VERSION = 'm1';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SIGNATURE = '[A-Za-z0-9_-]{43}';
const PREVIEW_SESSION_SHAPE = new RegExp(`^${VERSION}\\.session\\.(${UUID})\\.(${UUID})\\.(\\d{10})\\.(${SIGNATURE})$`, 'i');
const FILE_GRANT_SHAPE = new RegExp(`^${VERSION}\\.(preview|guest)\\.(${UUID})\\.(${UUID})\\.(${UUID})\\.(\\d{10})\\.(${SIGNATURE})$`, 'i');
export const FILE_MEDIA_GRANT_TTL_SECONDS = 5 * 60;
export const PREVIEW_MEDIA_SESSION_TTL_SECONDS = 60 * 60;

export interface PreviewMediaSession {
  tenantId: string;
  storefrontId: string;
  expiresAt?: number;
}

export interface FileMediaGrant {
  purpose: 'preview' | 'guest';
  tenantId: string;
  resourceId: string;
  fileId: string;
  expiresAt: number;
}

function signingKey(): Buffer {
  const root = config.MEDIA_READ_GRANT_SECRET
    ? Buffer.from(config.MEDIA_READ_GRANT_SECRET, 'utf8')
    : Buffer.from(config.INVITATION_EMAIL_DIGEST_KEY, 'base64url');
  return createHmac('sha256', root).update('drezivo:browser-media-grant:v1', 'utf8').digest();
}

function signature(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload, 'utf8').digest('base64url');
}

function token(payload: string): string {
  return `${payload}.${signature(payload)}`;
}

function validSignature(payload: string, given: string): boolean {
  const expected = Buffer.from(signature(payload), 'utf8');
  const actual = Buffer.from(given, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function expiry(now: Date, ttlSeconds: number): number {
  return Math.floor(now.getTime() / 1000) + ttlSeconds;
}

export function issuePreviewMediaSession(
  scope: PreviewMediaSession,
  now = new Date(),
): { session: string; expiresAt: string } {
  const expires = Math.min(
    expiry(now, PREVIEW_MEDIA_SESSION_TTL_SECONDS),
    scope.expiresAt ?? Number.MAX_SAFE_INTEGER,
  );
  const payload = `${VERSION}.session.${scope.tenantId}.${scope.storefrontId}.${expires}`;
  return { session: token(payload), expiresAt: new Date(expires * 1000).toISOString() };
}

export function verifyPreviewMediaSession(
  value: string | undefined,
  now = new Date(),
): PreviewMediaSession | null {
  if (!value || value.length > 256) return null;
  const match = PREVIEW_SESSION_SHAPE.exec(value);
  if (!match) return null;
  const [, tenantId, storefrontId, expires, given] = match;
  if (!tenantId || !storefrontId || !expires || !given) return null;
  const payload = `${VERSION}.session.${tenantId}.${storefrontId}.${expires}`;
  if (!validSignature(payload, given) || Number(expires) * 1000 <= now.getTime()) return null;
  return { tenantId, storefrontId, expiresAt: Number(expires) };
}

export function issueFileMediaGrant(
  input: Omit<FileMediaGrant, 'expiresAt'>,
  now = new Date(),
  expiresNoLaterThan?: number,
): { grant: string; expiresAt: string } {
  const expires = Math.min(expiry(now, FILE_MEDIA_GRANT_TTL_SECONDS), expiresNoLaterThan ?? Number.MAX_SAFE_INTEGER);
  if (expires * 1000 <= now.getTime()) throw new Error('The media session has expired.');
  const payload = `${VERSION}.${input.purpose}.${input.tenantId}.${input.resourceId}.${input.fileId}.${expires}`;
  return { grant: token(payload), expiresAt: new Date(expires * 1000).toISOString() };
}

export function verifyFileMediaGrant(
  value: string | undefined,
  expected: { purpose: FileMediaGrant['purpose']; resourceId?: string; fileId: string },
  now = new Date(),
): FileMediaGrant | null {
  if (!value || value.length > 320) return null;
  const match = FILE_GRANT_SHAPE.exec(value);
  if (!match) return null;
  const [, purpose, tenantId, resourceId, fileId, expires, given] = match;
  if (!purpose || !tenantId || !resourceId || !fileId || !expires || !given) return null;
  const payload = `${VERSION}.${purpose}.${tenantId}.${resourceId}.${fileId}.${expires}`;
  if (
    purpose !== expected.purpose ||
    (expected.resourceId !== undefined && resourceId.toLowerCase() !== expected.resourceId.toLowerCase()) ||
    fileId.toLowerCase() !== expected.fileId.toLowerCase() ||
    !validSignature(payload, given) ||
    Number(expires) * 1000 <= now.getTime()
  ) return null;
  return {
    purpose,
    tenantId,
    resourceId,
    fileId,
    expiresAt: Number(expires),
  };
}
