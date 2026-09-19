import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { corsMiddleware } from '../cors.js';
import { errorHandler } from '../error-handler.js';

function buildApp() {
  const app = express();
  app.use(corsMiddleware);
  app.get('/resource', (_req, res) => res.status(200).json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('CORS boundary', () => {
  it('allows the configured frontend origin and exposes request IDs', async () => {
    const response = await request(buildApp()).get('/resource').set('Origin', 'http://localhost:3000');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-expose-headers']).toBe('X-Request-Id');
    expect(response.headers.vary).toContain('Origin');
  });

  it('answers an allowed preflight before authentication or body parsing', async () => {
    const response = await request(buildApp())
      .options('/resource')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type, Idempotency-Key');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    expect(response.headers['access-control-max-age']).toBe('600');
  });

  it('rejects an origin outside the explicit allowlist without permissive headers', async () => {
    const response = await request(buildApp()).get('/resource').set('Origin', 'http://localhost:5000');

    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    const body = response.body as { error?: { code?: string } };
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  it('leaves non-browser requests untouched', async () => {
    const response = await request(buildApp()).get('/resource');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
