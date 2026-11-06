import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import type { OperatorPrincipal, OperatorScope, PlanAssertionInput, VerifiedPlanAssertion } from './internal-operator.routes.js';

type Claims = {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  org_id?: unknown;
  role?: unknown;
  permission?: unknown;
  method?: unknown;
  path?: unknown;
  tenant_id?: unknown;
  request_id?: unknown;
  idempotency_key?: unknown;
  body_hash?: unknown;
  iat?: unknown;
  exp?: unknown;
  jti?: unknown;
};

function decodeJson(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const bytes = Buffer.from(segment, 'base64url');
    if (bytes.toString('base64url') !== segment) return null;
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function bodyHash(planCode: PlanAssertionInput['planCode'], reason: string | undefined): string {
  return createHash('sha256')
    .update(JSON.stringify({ plan_code: planCode, reason: reason ?? null }), 'utf8')
    .digest('hex');
}

/** Verify the service credential plus the short-lived, body-bound manage assertion from Operator. */
export function createOperatorPlanAssertionVerifier(options: {
  serviceAuth: string;
  assertionSecret: string;
  now?: () => number;
}) {
  return (req: Request, input: PlanAssertionInput): VerifiedPlanAssertion | null => {
    const authorization = req.header('Authorization') ?? '';
    if (!safeEqual(authorization, options.serviceAuth)) return null;

    const token = req.header('X-Drezivo-Operator-Assertion') ?? '';
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedClaims, signature] = parts;
    if (!encodedHeader || !encodedClaims || !signature || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
    const header = decodeJson(encodedHeader);
    const claims = decodeJson(encodedClaims) as Claims | null;
    if (!header || typeof header !== 'object' || (header as { alg?: unknown }).alg !== 'HS256' || (header as { typ?: unknown }).typ !== 'JWT' || !claims || typeof claims !== 'object') return null;

    const expectedSignature = createHmac('sha256', Buffer.from(options.assertionSecret, 'utf8'))
      .update(`${encodedHeader}.${encodedClaims}`, 'ascii')
      .digest('base64url');
    if (!safeEqual(signature, expectedSignature)) return null;

    const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
    const requestId = req.requestId;
    const expectedPath = `/internal/operator/v1/tenants/${input.tenantId}/plan`;
    const isValid =
      claims.iss === 'drezivo-operator-api' && claims.aud === 'drezivo-business-api' &&
      typeof claims.sub === 'string' && claims.sub.length > 0 && claims.sub.length <= 255 &&
      typeof claims.org_id === 'string' && claims.org_id.length > 0 && claims.org_id.length <= 255 &&
      claims.role === 'platform_owner' && claims.permission === 'tenant.admin.manage' &&
      claims.method === 'POST' && claims.path === expectedPath && req.method === 'POST' && req.originalUrl === expectedPath &&
      claims.tenant_id === input.tenantId && claims.request_id === requestId && input.requestId === requestId &&
      claims.idempotency_key === input.idempotencyKey &&
      typeof claims.body_hash === 'string' && claims.body_hash === bodyHash(input.planCode, input.reason) &&
      typeof claims.iat === 'number' && Number.isInteger(claims.iat) && claims.iat <= nowSeconds + 5 &&
      typeof claims.exp === 'number' && Number.isInteger(claims.exp) && claims.exp > nowSeconds &&
      claims.exp > claims.iat && claims.exp - claims.iat <= 60 && nowSeconds - claims.iat <= 60 &&
      typeof claims.jti === 'string' && /^[0-9a-f-]{36}$/i.test(claims.jti);
    if (!isValid) return null;

    const principal: OperatorPrincipal = { subject: claims.sub as string };
    const scope: OperatorScope = { tenantId: input.tenantId, permissions: ['tenant.admin.manage'] };
    return { principal, scope };
  };
}
