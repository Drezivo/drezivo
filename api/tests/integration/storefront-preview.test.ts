import pg from 'pg';
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
import type { StorefrontPreviewLink } from '@drezivo/contracts';

const clerk = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: clerk.getAuth,
}));

const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

/**
 * Owner preview of an unpublished storefront: a signed, short-lived token opens public READS of
 * exactly one storefront, is never cached, and never opens guest writes on a draft store.
 */
describe('storefront owner preview', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool } = await import('../../src/db/client.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
  const { issuePreviewToken } = await import('../../src/modules/storefront/storefront-preview.js');
  const admin = new pg.Client({ connectionString: adminUrl });

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await admin.connect();
  });
  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  const HEADER = 'X-Storefront-Preview';

  async function previewFor(ws: { owner: { principalId: string }; clerkOrgId: string }): Promise<StorefrontPreviewLink> {
    clerk.getAuth.mockReturnValue({ userId: ws.owner.principalId, orgId: ws.clerkOrgId });
    const response = await request(createApp()).get('/api/v1/storefront/preview');
    expect(response.status).toBe(200);
    return dataOf<StorefrontPreviewLink>(response);
  }

  it('requires a signed-in staff member to issue a preview', async () => {
    clerk.getAuth.mockReturnValue({ userId: null, orgId: null });
    expect((await request(createApp()).get('/api/v1/storefront/preview')).status).toBe(401);
  });

  it('shows the draft storefront only with a valid preview token, and never caches it', async () => {
    const ws = await createStorefrontWorkspace('preview-draft');
    const link = await previewFor(ws);
    expect(link.slug).toBe(ws.slug);
    const app = createApp();

    const hidden = await request(app).get(`/api/v1/public/stores/${ws.slug}`);
    expect(hidden.status).toBe(404);

    const shown = await request(app).get(`/api/v1/public/stores/${ws.slug}`).set(HEADER, link.token);
    expect(shown.status).toBe(200);
    expect(shown.headers['cache-control']).toBe('private, no-store');
    expect(shown.headers['vary']).toMatch(/X-Storefront-Preview/i);

    const catalogue = await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue`).set(HEADER, link.token);
    expect(catalogue.status).toBe(200);
    expect(catalogue.headers['cache-control']).toBe('private, no-store');
  });

  it('rejects tampered, expired, and other-store tokens as if no preview was sent', async () => {
    const ws = await createStorefrontWorkspace('preview-a');
    const other = await createStorefrontWorkspace('preview-b');
    const link = await previewFor(ws);
    const app = createApp();

    const last = link.token.slice(-1);
    const tampered = link.token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect((await request(app).get(`/api/v1/public/stores/${ws.slug}`).set(HEADER, tampered)).status).toBe(404);

    const expired = issuePreviewToken({ tenantId: ws.tenantId, storefrontId: ws.storefrontId }, new Date(Date.now() - 2 * 60 * 60 * 1000));
    expect((await request(app).get(`/api/v1/public/stores/${ws.slug}`).set(HEADER, expired.token)).status).toBe(404);

    // A token only opens the storefront it names, even on a slug of the same shape.
    expect((await request(app).get(`/api/v1/public/stores/${other.slug}`).set(HEADER, link.token)).status).toBe(404);
    expect((await request(app).get(`/api/v1/public/stores/${ws.slug}`).set(HEADER, 'v1.garbage')).status).toBe(404);
  });

  it('does not expose the removed guest verification endpoint', async () => {
    const ws = await createStorefrontWorkspace('preview-writes');
    const link = await previewFor(ws);
    const app = createApp();

    const removed = await request(app)
      .post(`/api/v1/public/stores/${ws.slug}/verifications`)
      .set(HEADER, link.token)
      .send({ email: 'renter@example.com' });
    expect(removed.status).toBe(404);
  });

  it('keeps ordinary public reads cacheable and marked to vary on the preview header', async () => {
    const ws = await createStorefrontWorkspace('preview-published');
    await admin.query(`UPDATE storefront SET status = 'published', published_at = now() WHERE id = $1`, [ws.storefrontId]);
    const response = await request(createApp()).get(`/api/v1/public/stores/${ws.slug}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toMatch(/^public/);
    expect(response.headers['vary']).toMatch(/X-Storefront-Preview/i);
  });
});
