import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
/* Supertest's response body is intentionally untyped in these envelope assertions. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.CLERK_SECRET_KEY = 'test'; process.env.CLERK_PUBLISHABLE_KEY = 'test'; process.env.CLERK_JWT_ISSUER = 'https://clerk.test';
process.env.AWS_REGION = 'test'; process.env.S3_BUCKET_PRIVATE = 'private'; process.env.S3_BUCKET_PUBLIC = 'public';
process.env.S3_ACCESS_KEY_ID = 'test'; process.env.S3_SECRET_ACCESS_KEY = 'test';
// Keep unit tests deterministic without weakening production authentication. The real Clerk
// middleware is never bypassed by NODE_ENV; this test-only module mock is hoisted by Vitest.
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: () => ({ userId: null, orgId: null }),
}));
/* Keep configuration available before the dynamically imported app initializes. */
/*
  process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.CLERK_SECRET_KEY = 'test'; process.env.CLERK_PUBLISHABLE_KEY = 'test'; process.env.CLERK_JWT_ISSUER = 'https://clerk.test';
  process.env.AWS_REGION = 'test'; process.env.S3_BUCKET_PRIVATE = 'private'; process.env.S3_BUCKET_PUBLIC = 'public';
  process.env.S3_ACCESS_KEY_ID = 'test'; process.env.S3_SECRET_ACCESS_KEY = 'test';
*/

describe('API scaffold', async () => {
  const { createApp } = await import('../app.js');
  const app = createApp();
  it('returns health without external dependencies', async () => { expect((await request(app).get('/health')).status).toBe(200); });
  it('returns stable 501 for duplicate unfinished mutations', async () => {
    const responses = await Promise.all([request(app).post('/api/v1/public/stores/demo/holds'), request(app).post('/api/v1/public/stores/demo/holds')]);
    expect(responses.map((r) => r.status)).toEqual([501, 501]); expect(responses[0]?.body.success).toBe(false); expect(responses[0]?.body.error.code).toBe('NOT_IMPLEMENTED'); expect(responses[0]?.body.error.message).toBe(responses[1]?.body.error.message); expect(responses[0]?.body.request_id).toBe(responses[0]?.headers['x-request-id']);
  });
  it('returns a shared JSON envelope for unknown routes', async () => { const response = await request(app).get('/api/v1/no-such-route'); expect(response.status).toBe(404); expect(response.body.success).toBe(false); expect(response.body.error.code).toBe('NOT_FOUND'); });
});
