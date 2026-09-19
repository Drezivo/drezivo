import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getUserVerificationState: vi.fn(),
}));

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  getAuth: mocks.getAuth,
}));

vi.mock('../../integrations/clerk/clerk.adapter.js', () => ({
  createClerkServerAdapter: () => ({
    getUserVerificationState: mocks.getUserVerificationState,
  }),
}));

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

const { requireVerifiedStaffAuth } = await import('../auth.js');
const { errorHandler } = await import('../error-handler.js');

function buildApp() {
  const app = express();
  app.get('/owner', requireVerifiedStaffAuth, (_req, res) => res.status(204).send());
  app.use(errorHandler);
  return app;
}

describe('verified staff authentication', () => {
  beforeEach(() => {
    mocks.getAuth.mockReset();
    mocks.getUserVerificationState.mockReset();
    mocks.getAuth.mockReturnValue({ userId: 'user_123', orgId: null });
  });

  it('rejects an unverified primary email before the route runs', async () => {
    mocks.getUserVerificationState.mockResolvedValue({ primaryEmailVerified: false });
    const response = await request(buildApp()).get('/owner');

    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('fails closed when Clerk verification is unavailable', async () => {
    mocks.getUserVerificationState.mockRejectedValue(new Error('provider failure'));
    const response = await request(buildApp()).get('/owner');

    expect(response.status).toBe(503);
  });
});
