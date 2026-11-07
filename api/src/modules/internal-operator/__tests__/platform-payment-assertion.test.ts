import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { createPlatformPaymentAssertionVerifier } from '../platform-payment-assertion.js';

const service = 'local-service-test';
const secret = 'local-assertion-test';
const path = '/internal/operator/v1/platform-payment-methods';
const now = 1_798_000_000_000;
const body = { label: 'Bank', qr: null };
const key = 'local-intent-12345';
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

function request(overrides: Record<string, unknown> = {}, requestBody: unknown = body): Request {
  const issued = Math.floor(now / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const claims = encode({ iss: 'drezivo-operator-api', aud: 'drezivo-business-api', sub: 'operator', org_id: 'org', role: 'platform_owner',
    permission: 'tenant.admin.manage', method: 'POST', path, request_id: 'req', idempotency_key: key,
    body_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), iat: issued, exp: issued + 60, jti: randomUUID(), ...overrides });
  const signature = createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url');
  return { header: (name: string) => name === 'Authorization' ? service : `${header}.${claims}.${signature}`, method: 'POST', originalUrl: path, requestId: 'req', body: requestBody } as unknown as Request;
}

describe('platform payment operator assertion', () => {
  const verify = createPlatformPaymentAssertionVerifier({ serviceAuth: service, assertionSecret: secret, now: () => now });
  it('accepts an exact authorized operation', () => expect(verify(request(), 'tenant.admin.manage', key)).toBe('operator'));
  it('rejects a changed request body, path, permission, and expired assertion', () => {
    expect(verify(request({}, { label: 'changed' }), 'tenant.admin.manage', key)).toBeNull();
    expect(verify(request({ path: `${path}/other` }), 'tenant.admin.manage', key)).toBeNull();
    expect(verify(request({ permission: 'tenant.admin.read' }), 'tenant.admin.manage', key)).toBeNull();
    expect(verify(request({ exp: Math.floor(now / 1000) - 1 }), 'tenant.admin.manage', key)).toBeNull();
  });
});
