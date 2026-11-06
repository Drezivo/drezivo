import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { createOperatorPlanAssertionVerifier } from '../operator-plan-assertion.js';
import type { OperatorPlanCode } from '../operator-plan.schema.js';

const tenantId = '00000000-0000-4000-8000-000000000002';
const serviceAuth = 'Bearer internal-service-secret-that-is-long-enough';
const assertionSecret = 'operator-assertion-secret-that-is-at-least-thirty-two-bytes';
const now = 1_798_000_000_000;

function token(input: { path?: string; requestId?: string; idempotencyKey?: string; planCode?: OperatorPlanCode; reason?: string; exp?: number } = {}): string {
  const path = input.path ?? `/internal/operator/v1/tenants/${tenantId}/plan`;
  const requestId = input.requestId ?? 'request-1';
  const planCode = input.planCode ?? 'standard';
  const reason = input.reason;
  const iat = Math.floor(now / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const claims = encode({
    iss: 'drezivo-operator-api', aud: 'drezivo-business-api', sub: 'operator-1', org_id: 'org-1',
    role: 'platform_owner', permission: 'tenant.admin.manage', method: 'POST', path,
    tenant_id: tenantId, request_id: requestId, idempotency_key: input.idempotencyKey ?? 'operator-plan-request-1',
    body_hash: createHash('sha256').update(JSON.stringify({ plan_code: planCode, reason: reason ?? null })).digest('hex'),
    iat, exp: input.exp ?? iat + 60, jti: randomUUID(),
  });
  const signingInput = `${header}.${claims}`;
  const signature = createHmac('sha256', assertionSecret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function fakeRequest(input: { assertion?: string; authorization?: string; path?: string; requestId?: string; planCode?: OperatorPlanCode; reason?: string } = {}): Request {
  const headers: Record<string, string> = {
    authorization: input.authorization ?? serviceAuth,
    'x-drezivo-operator-assertion': input.assertion ?? token({
      ...(input.path === undefined ? {} : { path: input.path }),
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.planCode === undefined ? {} : { planCode: input.planCode }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    }),
  };
  return {
    header: (name: string) => headers[name.toLowerCase()],
    method: 'POST',
    originalUrl: input.path ?? `/internal/operator/v1/tenants/${tenantId}/plan`,
    requestId: input.requestId ?? 'request-1',
  } as unknown as Request;
}

describe('operator plan assertion', () => {
  const verify = createOperatorPlanAssertionVerifier({ serviceAuth, assertionSecret, now: () => now });
  const input = { tenantId, planCode: 'standard' as const, idempotencyKey: 'operator-plan-request-1', requestId: 'request-1' };

  it('accepts a signed request with matching tenant, body, request ID, and manage role', () => {
    expect(verify(fakeRequest(), input)).toMatchObject({
      principal: { subject: 'operator-1' },
      scope: { tenantId, permissions: ['tenant.admin.manage'] },
    });
  });

  it.each(['starter', 'standard', 'growth', 'scale'] as const)(
    'accepts an assertion for the %s tier',
    (planCode) => {
      const paidPlanInput = { ...input, planCode };
      expect(verify(fakeRequest({ planCode }), paidPlanInput)).not.toBeNull();
    },
  );

  it('rejects changed authorization, path, body, and expired assertions', () => {
    expect(verify(fakeRequest({ authorization: 'Bearer wrong' }), input)).toBeNull();
    expect(verify(fakeRequest({ path: `${input.tenantId}/plan?debug=1` }), input)).toBeNull();
    expect(verify(fakeRequest({ assertion: token({ planCode: 'starter' }) }), input)).toBeNull();
    const expired = token({ exp: Math.floor(now / 1000) - 1 });
    expect(verify(fakeRequest({ assertion: expired }), input)).toBeNull();
  });
});
