import { createServer, type Server } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { config } from '../../src/config/index.js';
import { requestId } from '../../src/middleware/request-id.js';
import { createPlatformPaymentAssertionVerifier } from '../../src/modules/internal-operator/platform-payment-assertion.js';
import { captureServerError, initMonitoring, monitoringRoute, requestMonitoring } from '../../src/shared/monitoring.js';

describe('privacy-safe monitoring', () => {
  let server: Server;
  const envelopes: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => { envelopes.push(Buffer.concat(chunks).toString()); res.writeHead(200).end(); });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a local TCP listener');
    config.SENTRY_DSN = `http://key@127.0.0.1:${address.port}/1`;
    config.SENTRY_TRACES_SAMPLE_RATE = 1;
    initMonitoring();
  });

  afterAll(async () => {
    await Sentry.close(3_000);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('groups private paths without retaining their identifiers', () => {
    expect(monitoringRoute('GET', '/api/v1/public/stores/private-slug/availability'))
      .toBe('GET /api/v1/public/stores/:slug/availability');
    expect(monitoringRoute('GET', '/api/v1/guest/private-token')).toBe('other');
  });

  it('preserves existing request IDs used by signed internal commands', async () => {
    const app = express();
    app.use(requestId);
    app.get('/', (_req, res) => res.status(204).end());
    const valid = 'a4da8fb7-a492-4138-9d82-bd096892d0fe';
    expect((await request(app).get('/').set('x-request-id', valid)).headers['x-request-id']).toBe(valid);
    const signed = await request(app).get('/').set('x-request-id', 'test-request');
    expect(signed.headers['x-request-id']).toBe('test-request');
  });

  it('verifies a body-bound operator assertion with a non-UUID request ID', async () => {
    const app = express();
    app.use(requestId, express.json());
    const verify = createPlatformPaymentAssertionVerifier({ serviceAuth: 'service', assertionSecret: 'secret' });
    app.post('/internal/test', (req, res) => {
      res.sendStatus(verify(req, 'tenant.admin.manage', 'intent') ? 200 : 401);
    });
    const body = { label: 'synthetic' };
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const head = encode({ alg: 'HS256', typ: 'JWT' });
    const payload = encode({ iss: 'drezivo-operator-api', aud: 'drezivo-business-api', sub: 'operator', org_id: 'org', role: 'platform_owner', permission: 'tenant.admin.manage', method: 'POST', path: '/internal/test', request_id: 'test-request', idempotency_key: 'intent', body_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), iat: now, exp: now + 60, jti: randomUUID() });
    const signature = createHmac('sha256', 'secret').update(`${head}.${payload}`).digest('base64url');
    const send = (requestIdValue: string) => request(app).post('/internal/test').set('Authorization', 'service')
      .set('X-Request-ID', requestIdValue).set('X-Drezivo-Operator-Assertion', `${head}.${payload}.${signature}`).send(body);
    await send('test-request').expect(200);
    await send('different-request').expect(401);
  });

  it('sends a route span and scrubbed error without request or exception secrets', async () => {
    const app = express();
    app.use((req, _res, next) => { req.requestId = 'a4da8fb7-a492-4138-9d82-bd096892d0fe'; next(); });
    app.use(requestMonitoring);
    app.get('/api/v1/dashboard/overview', (req, res) => {
      Sentry.startSpan({ name: 'tenant database work', op: 'db.transaction', onlyIfParent: true }, () => {
        captureServerError(new Error('private-error-value'), req);
        res.status(500).end();
      });
    });
    await request(app).get('/api/v1/dashboard/overview?token=private-query-value')
      .set('Authorization', 'Bearer private-header-value').expect(500);
    expect(await Sentry.flush(5_000)).toBe(true);
    const wire = envelopes.join('\n');
    expect(wire).toContain('GET /api/v1/dashboard/overview');
    expect(wire).toContain('tenant database work');
    expect(wire).toContain('"type":"span"');
    expect(wire).toContain('a4da8fb7-a492-4138-9d82-bd096892d0fe');
    expect(wire).not.toContain('private-error-value');
    expect(wire).not.toContain('private-query-value');
    expect(wire).not.toContain('private-header-value');
  });
});
