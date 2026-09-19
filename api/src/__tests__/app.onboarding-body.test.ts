import request from 'supertest';
import { describe, expect, it } from 'vitest';

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

describe('owner onboarding raw body limit', () => {
  it('rejects whitespace-heavy bodies before JSON parsing', async () => {
    const response = await request(createApp())
      .post('/api/v1/onboarding')
      .set('content-type', 'application/json')
      .send(`{"organization_name":"Studio"}${' '.repeat(16 * 1024)}`);

    expect(response.status).toBe(422);
    expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('maps malformed JSON to the generic validation envelope', async () => {
    const response = await request(createApp())
      .post('/api/v1/onboarding')
      .set('content-type', 'application/json')
      .send('{"organization_name":');

    expect(response.status).toBe(422);
    expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});
