import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Verify a short-lived assertion bound to the exact platform-payment operation. */
export function createPlatformPaymentAssertionVerifier(options: { serviceAuth: string; assertionSecret: string; now?: () => number }) {
  return (req: Request, permission: 'tenant.admin.read' | 'tenant.admin.manage', key: string | null): string | null => {
    if (!equal(req.header('Authorization') ?? '', options.serviceAuth)) return null;
    const parts = (req.header('X-Drezivo-Operator-Assertion') ?? '').split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const [head, payload, signature] = parts as [string, string, string];
    const expected = createHmac('sha256', options.assertionSecret).update(`${head}.${payload}`).digest('base64url');
    if (!equal(signature, expected)) return null;
    let header: Record<string, unknown>; let claim: Record<string, unknown>;
    try { header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as Record<string, unknown>; claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
    if (!header || !claim || header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
    const body = req.method === 'GET' ? {} : req.body as unknown;
    const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const valid = claim.iss === 'drezivo-operator-api' && claim.aud === 'drezivo-business-api' &&
      typeof claim.sub === 'string' && claim.sub.length > 0 && claim.sub.length <= 255 &&
      typeof claim.org_id === 'string' && claim.org_id.length > 0 && claim.org_id.length <= 255 &&
      claim.role === 'platform_owner' && claim.permission === permission && claim.method === req.method &&
      claim.path === req.originalUrl && claim.request_id === req.requestId && claim.idempotency_key === key && claim.body_hash === bodyHash &&
      typeof claim.iat === 'number' && Number.isInteger(claim.iat) && claim.iat <= now + 5 && now - claim.iat <= 60 &&
      typeof claim.exp === 'number' && Number.isInteger(claim.exp) && claim.exp > now && claim.exp > claim.iat && claim.exp - claim.iat <= 60 &&
      typeof claim.jti === 'string' && /^[0-9a-f-]{36}$/i.test(claim.jti);
    return valid ? claim.sub as string : null;
  };
}
