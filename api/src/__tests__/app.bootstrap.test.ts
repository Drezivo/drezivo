import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Supertest's response body is intentionally untyped in these envelope assertions. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getUserVerificationState: vi.fn(),
  bootstrapOwnerTenant: vi.fn(),
}));

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: mocks.getAuth,
}));

vi.mock('../integrations/clerk/clerk.adapter.js', () => ({
  createClerkServerAdapter: () => ({
    getUserVerificationState: mocks.getUserVerificationState,
  }),
}));

vi.mock('../modules/onboarding/tenant-bootstrap.service.js', () => ({
  bootstrapOwnerTenant: mocks.bootstrapOwnerTenant,
}));

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.CLERK_SECRET_KEY = 'test';
process.env.CLERK_PUBLISHABLE_KEY = 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'test';
process.env.OBJECT_STORAGE_REGION = 'test';
process.env.OBJECT_STORAGE_BUCKET_PRIVATE = 'private';
process.env.OBJECT_STORAGE_BUCKET_PUBLIC = 'public';
process.env.OBJECT_STORAGE_ACCESS_KEY_ID = 'test';
process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = 'test';

const { createApp } = await import('../app.js');

describe('tenant bootstrap HTTP boundary', () => {
  beforeEach(() => {
    mocks.getAuth.mockReset();
    mocks.getUserVerificationState.mockReset();
    mocks.bootstrapOwnerTenant.mockReset();
    mocks.getAuth.mockReturnValue({ userId: 'user_bootstrap', orgId: 'org_bootstrap' });
    mocks.getUserVerificationState.mockResolvedValue({ primaryEmailVerified: true });
    mocks.bootstrapOwnerTenant.mockResolvedValue({
      status: 201,
      body: { success: true, data: {}, request_id: 'req-bootstrap' },
    });
  });

  it('answers the frontend preflight before Clerk authentication or JSON parsing', async () => {
    const response = await request(createApp())
      .options('/api/v1/onboarding')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });

  it('passes the strict empty body and idempotency key to the controller service', async () => {
    const onboardingId = '9fbd891f-cab6-48a9-a965-e84deea05df6';
    const response = await request(createApp())
      .post(`/api/v1/onboarding/${onboardingId}/bootstrap`)
      .set('content-type', 'application/json')
      .set('Idempotency-Key', 'bootstrap-http-001')
      .send({});

    expect(response.status).toBe(201);
    const call = mocks.bootstrapOwnerTenant.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(call).toMatchObject({
      principalId: 'user_bootstrap',
      clerkOrgId: 'org_bootstrap',
      idempotencyKey: 'bootstrap-http-001',
      onboardingId,
      request: {},
    });
    expect(call.requestId).toEqual(expect.any(String));
  });

  it('rejects extra body fields before the service runs', async () => {
    const response = await request(createApp())
      .post('/api/v1/onboarding/9fbd891f-cab6-48a9-a965-e84deea05df6/bootstrap')
      .set('content-type', 'application/json')
      .set('Idempotency-Key', 'bootstrap-http-002')
      .send({ plan_code: 'starter' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.bootstrapOwnerTenant).not.toHaveBeenCalled();
  });
});
