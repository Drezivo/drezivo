import express from 'express';
import { createHash, createHmac } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

/* Supertest's response body is intentionally untyped in these envelope assertions. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

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

const { createClerkWebhookRouter } = await import('../clerk.routes.js');
import type { ClerkWebhookRouterDependencies } from '../clerk.routes.js';
const { errorHandler } = await import('../../../middleware/error-handler.js');
const { requestId } = await import('../../../middleware/request-id.js');

function buildApp(options: {
  signingSecret?: string;
  verify?: (request: express.Request, options: { signingSecret: string }) => Promise<unknown>;
  ingest?: (input: {
    providerEventId: string;
    eventType: string;
    payloadDigest: string;
    safePayload: Record<string, unknown>;
  }) => Promise<'inserted' | 'duplicate'>;
}) {
  const app = express();
  app.use(requestId);
  const dependencies: ClerkWebhookRouterDependencies = {
    signingSecret: options.signingSecret ?? 'test-signing-secret',
  };
  if (options.verify) dependencies.verify = options.verify;
  if (options.ingest) dependencies.ingest = options.ingest;
  app.use(
    createClerkWebhookRouter(dependencies),
  );
  app.use(errorHandler);
  return app;
}

const organizationCreated = {
  type: 'organization.created',
  data: {
    id: 'org_123',
    created_by: 'user_123',
    name: 'Never persisted',
    private_metadata: {
      drezivo_onboarding: {
        source: 'owner_onboarding_v1',
        account_id: '11111111-1111-4111-8111-111111111111',
        attempt_id: '22222222-2222-4222-8222-222222222222',
      },
      email: 'owner@example.com',
      token: 'secret-token',
      url: 'https://example.invalid/private',
    },
  },
};

describe('Clerk webhook intake route', () => {
  it('accepts a valid Clerk/Svix signature with the explicit configured secret', async () => {
    const signingSecret = `whsec_${Buffer.from('test-signing-secret').toString('base64')}`;
    const raw = JSON.stringify({
      type: 'organization.updated',
      data: { id: 'org_signed' },
    });
    const eventId = 'evt_signed';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', Buffer.from('test-signing-secret'))
      .update(`${eventId}.${timestamp}.${raw}`)
      .digest('base64');
    let inserted = false;
    const app = buildApp({
      signingSecret,
      ingest: () => {
        inserted = true;
        return Promise.resolve('inserted');
      },
    });

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', eventId)
      .set('svix-timestamp', timestamp)
      .set('svix-signature', `v1,${signature}`)
      .send(raw);

    expect(response.status).toBe(204);
    expect(inserted).toBe(true);
  });

  it('rejects missing and stale Svix signature headers generically', async () => {
    const signingSecret = `whsec_${Buffer.from('test-signing-secret').toString('base64')}`;
    const raw = JSON.stringify({ type: 'user.created', data: { id: 'user_ignored' } });
    const eventId = 'evt_stale';
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    const staleSignature = createHmac('sha256', Buffer.from('test-signing-secret'))
      .update(`${eventId}.${staleTimestamp}.${raw}`)
      .digest('base64');
    const app = buildApp({ signingSecret });

    const missing = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', 'evt_missing_signature')
      .send(raw);
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('VALIDATION_FAILED');

    const stale = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', eventId)
      .set('svix-timestamp', staleTimestamp)
      .set('svix-signature', `v1,${staleSignature}`)
      .send(raw);
    expect(stale.status).toBe(422);
    expect(stale.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('passes exact raw bytes to verification and stores only the normalized safe projection', async () => {
    const raw = Buffer.from(` {"data":${JSON.stringify(organizationCreated.data)},"type":"organization.created"} `);
    let verifiedBody: Buffer | undefined;
    let ingested: Record<string, unknown> | undefined;
    const app = buildApp({
      verify: (req) => {
        verifiedBody = req.body as Buffer;
        return Promise.resolve(organizationCreated);
      },
      ingest: (input) => {
        ingested = input.safePayload;
        expect(input.payloadDigest).toBe(createHash('sha256').update(raw).digest('hex'));
        return Promise.resolve('inserted');
      },
    });

    const response = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', 'evt_123')
      .send(raw.toString('utf8'));

    expect(response.status).toBe(204);
    expect(verifiedBody).toEqual(raw);
    expect(ingested).toEqual({
      organization_id: 'org_123',
      created_by_user_id: 'user_123',
      drezivo_onboarding: {
        source: 'owner_onboarding_v1',
        account_id: '11111111-1111-4111-8111-111111111111',
        attempt_id: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(JSON.stringify(ingested)).not.toContain('Never persisted');
    expect(JSON.stringify(ingested)).not.toContain('owner@example.com');
    expect(JSON.stringify(ingested)).not.toContain('secret-token');
    expect(JSON.stringify(ingested)).not.toContain('https://');
  });

  it('returns generic validation for verifier failures and malformed supported events', async () => {
    const invalidSignatureApp = buildApp({
      verify: () => {
        return Promise.reject(new Error('signature is invalid'));
      },
    });
    const invalidSignature = await request(invalidSignatureApp)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', 'evt_bad')
      .send(JSON.stringify(organizationCreated));
    expect(invalidSignature.status).toBe(422);
    expect(invalidSignature.body.error.code).toBe('VALIDATION_FAILED');

    const malformedApp = buildApp({
      verify: () => Promise.resolve({ type: 'organization.created', data: { id: '' } }),
    });
    const malformed = await request(malformedApp)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', 'evt_malformed')
      .send('{}');
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('acknowledges duplicate and validly signed disallowed events without persistence', async () => {
    let calls = 0;
    const app = buildApp({
      verify: () => Promise.resolve({ type: 'user.created', data: { id: 'user_123' }}),
      ingest: () => {
        calls += 1;
        return Promise.resolve('duplicate');
      },
    });
    const response = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', 'evt_disallowed')
      .send('{}');
    expect(response.status).toBe(204);
    expect(calls).toBe(0);

    const supported = buildApp({
      verify: () => Promise.resolve(organizationCreated),
      ingest: () => {
        calls += 1;
        return Promise.resolve('duplicate');
      },
    });
    const duplicate = await request(supported)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', 'evt_duplicate')
      .send('{}');
    expect(duplicate.status).toBe(204);
    expect(calls).toBe(1);
  });

  it('rejects wrong content type, missing provider ID, and malformed JSON', async () => {
    const verify = (req: express.Request) => {
      JSON.parse((req.body as Buffer).toString('utf8'));
      return Promise.resolve(organizationCreated);
    };
    const app = buildApp({ verify });

    const wrongType = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'text/plain')
      .set('svix-id', 'evt_wrong_type')
      .send('{}');
    expect(wrongType.status).toBe(422);

    const missingId = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .send('{}');
    expect(missingId.status).toBe(422);

    const malformedJson = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', 'evt_bad_json')
      .send('{"type":');
    expect(malformedJson.status).toBe(422);
  });

  it('rejects oversized bodies and returns the standard rate-limit response', async () => {
    const app = buildApp({
      verify: () => Promise.resolve({ type: 'user.created', data: { id: 'user_123' } }),
    });
    const oversized = await request(app)
      .post('/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', 'evt_oversized')
      .send('a'.repeat(262_145));
    expect(oversized.status).toBe(422);

    const limited = buildApp({
      verify: () => Promise.resolve({ type: 'user.created', data: { id: 'user_123' } }),
    });
    const responses = await Promise.all(
      Array.from({ length: 61 }, (_, index) =>
        request(limited)
          .post('/webhooks/clerk')
          .set('content-type', 'application/json')
          .set('svix-id', `evt_rate_${index}`)
          .send('{}'),
      ),
    );
    expect(responses.filter((response) => response.status === 204)).toHaveLength(60);
    const rateLimited = responses.find((response) => response.status === 429);
    expect(rateLimited?.body.error.code).toBe('RATE_LIMITED');
  });
});
