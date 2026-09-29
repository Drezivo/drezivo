import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';
import type { StorefrontSettings } from '@drezivo/contracts';

const clerk = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: clerk.getAuth,
}));

/** Typed envelope data for supertest responses. */
const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

describe('storefront CMS and settings HTTP boundary', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool } = await import('../../src/db/client.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
  const { defaultStorefrontDocument } = await import('@drezivo/contracts');

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await closePool();
  });

  it('rejects anonymous callers before touching data', async () => {
    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    const response = await request(createApp()).get('/api/v1/storefront');
    expect(response.status).toBe(401);
  });

  it('validates the body and Idempotency-Key at the boundary', async () => {
    const ws = await createStorefrontWorkspace('routes-validate');
    clerk.getAuth.mockReturnValue({ userId: ws.owner.principalId, orgId: ws.clerkOrgId });
    const app = createApp();

    const read = await request(app).get('/api/v1/storefront');
    expect(read.status).toBe(200);
    expect(dataOf<StorefrontSettings>(read)).not.toHaveProperty('tenant_id');

    const noKey = await request(app).patch('/api/v1/storefront').send({ version: 1, document: defaultStorefrontDocument('A') });
    expect(noKey.status).toBe(422);

    const unknownKey = await request(app)
      .patch('/api/v1/storefront')
      .set('Idempotency-Key', 'routes-validate-unknown')
      .send({ version: 1, document: defaultStorefrontDocument('A'), tenant_id: ws.tenantId });
    expect(unknownKey.status).toBe(422);
    expect((unknownKey.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

    const scriptInText = await request(app)
      .patch('/api/v1/storefront')
      .set('Idempotency-Key', 'routes-validate-script')
      .send({ version: 1, document: { ...defaultStorefrontDocument('A'), branding: { ...defaultStorefrontDocument('A').branding, tagline: '<script>alert(1)</script>' } } });
    // Plain text is stored as typed; the storefront renders it escaped. It must not be rejected or altered.
    expect(scriptInText.status).toBe(200);
    expect(dataOf<StorefrontSettings>(scriptInText).document.branding.tagline).toBe('<script>alert(1)</script>');
  });

  it('forbids front desk writes while allowing reads', async () => {
    const ws = await createStorefrontWorkspace('routes-desk');
    clerk.getAuth.mockReturnValue({ userId: ws.frontDesk.principalId, orgId: ws.clerkOrgId });
    const app = createApp();
    expect((await request(app).get('/api/v1/settings/business')).status).toBe(200);
    const write = await request(app)
      .post('/api/v1/storefront/publish')
      .set('Idempotency-Key', 'routes-desk-publish')
      .send({ version: 1 });
    expect(write.status).toBe(403);
  });
});
