import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Supertest's response body is intentionally untyped in these envelope assertions. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getUserVerificationState: vi.fn(),
  selectOnboardingPlan: vi.fn(),
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

vi.mock('../modules/onboarding/onboarding.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/onboarding/onboarding.service.js')>();
  return { ...actual, selectOnboardingPlan: mocks.selectOnboardingPlan };
});

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.CLERK_SECRET_KEY = 'test';
process.env.CLERK_PUBLISHABLE_KEY = 'test';
process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'test';
process.env.AWS_REGION = 'test';
process.env.S3_BUCKET_PRIVATE = 'private';
process.env.S3_BUCKET_PUBLIC = 'public';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';

const { createApp } = await import('../app.js');

const onboardingId = '9fbd891f-cab6-48a9-a965-e84deea05df6';

describe('onboarding plan-selection HTTP boundary', () => {
  beforeEach(() => {
    mocks.getAuth.mockReset();
    mocks.getUserVerificationState.mockReset();
    mocks.selectOnboardingPlan.mockReset();
    mocks.getAuth.mockReturnValue({ userId: 'user_plan', orgId: 'org_plan' });
    mocks.getUserVerificationState.mockResolvedValue({ primaryEmailVerified: true });
    mocks.selectOnboardingPlan.mockResolvedValue({
      status: 200,
      body: {
        success: true,
        data: {
          id: onboardingId,
          clerk_org_id: 'org_plan',
          organization_name: 'Luna Rentals',
          requested_slug: 'luna-rentals',
          status: 'incomplete',
          selected_plan_code: 'professional',
          is_trial_eligible: true,
          created_at: '2026-09-19T00:00:00.000Z',
          updated_at: '2026-09-19T00:00:00.000Z',
        },
        request_id: 'req-plan',
      },
    });
  });

  it('passes only the validated plan code and idempotency key to the command service', async () => {
    const idempotencyKey = randomUUID();
    const response = await request(createApp())
      .post(`/api/v1/onboarding/${onboardingId}/plan`)
      .set('content-type', 'application/json')
      .set('Idempotency-Key', idempotencyKey)
      .send({ plan_code: 'professional' });

    expect(response.status).toBe(200);
    expect(mocks.selectOnboardingPlan).toHaveBeenCalledTimes(1);
    const call = mocks.selectOnboardingPlan.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(call).toMatchObject({
      principalId: 'user_plan',
      idempotencyKey,
      onboardingId,
      request: { plan_code: 'professional' },
    });
    expect(call.requestId).toEqual(expect.any(String));
  });

  it('rejects prices, limits, and other extra fields at the boundary', async () => {
    const response = await request(createApp())
      .post(`/api/v1/onboarding/${onboardingId}/plan`)
      .set('content-type', 'application/json')
      .set('Idempotency-Key', randomUUID())
      .send({ plan_code: 'professional', monthly_minor: 1, physical_assets_max: 999999 });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(mocks.selectOnboardingPlan).not.toHaveBeenCalled();
  });

  it('rejects a missing idempotency key before the command service runs', async () => {
    const response = await request(createApp())
      .post(`/api/v1/onboarding/${onboardingId}/plan`)
      .set('content-type', 'application/json')
      .send({ plan_code: 'starter' });

    expect(response.status).toBe(422);
    expect(mocks.selectOnboardingPlan).not.toHaveBeenCalled();
  });
});
