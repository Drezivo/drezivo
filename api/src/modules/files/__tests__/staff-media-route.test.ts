import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('@clerk/express', async (importOriginal) => ({
  ...await importOriginal<typeof import('@clerk/express')>(),
  getAuth: auth.getAuth,
}));
vi.mock('../../billing/plans.service.js', () => ({ getPublicPlanCatalog: () => Promise.resolve([]) }));

import { errorHandler } from '../../../middleware/error-handler.js';
import { planCatalogRouter } from '../../billing/plans.routes.js';
import { filesRouter } from '../files.routes.js';

function buildApp() {
  const app = express();
  app.use('/api/v1', planCatalogRouter, filesRouter);
  app.use(errorHandler);
  return app;
}

describe('staff media route', () => {
  const path = '/api/v1/files/media/staff/00000000-0000-4000-8000-000000000101?w=960';

  it('matches the generated path and denies an anonymous request without caching it', async () => {
    auth.getAuth.mockReturnValue({ userId: null });
    const response = await request(buildApp()).get(path);
    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('denies a signed-in user without an organization without caching the denial', async () => {
    auth.getAuth.mockReturnValue({ userId: 'user_test', orgId: null });
    const response = await request(buildApp()).get(path);
    expect(response.status).toBe(403);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('limits the public cache header to the plans route', async () => {
    const app = buildApp();
    const plans = await request(app).get('/api/v1/plans');
    const other = await request(app).get('/api/v1/unknown');
    expect(plans.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(other.headers['cache-control']).toBeUndefined();
  });
});
