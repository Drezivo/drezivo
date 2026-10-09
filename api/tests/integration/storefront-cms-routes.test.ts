import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../src/config/load-env.js';
import { fileObjectId } from '@drezivo/contracts';
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
process.env.FILE_OBJECT_CLEANUP_ENABLED = 'true';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

describe('storefront CMS and settings HTTP boundary', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { createStorefrontAsset, createStorefrontWorkspace } =
    await import('./helpers/storefront-fixture.js');
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

    const noKey = await request(app)
      .patch('/api/v1/storefront')
      .send({ version: 1, document: defaultStorefrontDocument('A') });
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
      .send({
        version: 1,
        document: {
          ...defaultStorefrontDocument('A'),
          branding: {
            ...defaultStorefrontDocument('A').branding,
            tagline: '<script>alert(1)</script>',
          },
        },
      });
    // Plain text is stored as typed; the storefront renders it escaped. It must not be rejected or altered.
    expect(scriptInText.status).toBe(200);
    expect(dataOf<StorefrontSettings>(scriptInText).document.branding.tagline).toBe(
      '<script>alert(1)</script>',
    );
  });

  it('normalizes submitted social profile URLs before saving the storefront document', async () => {
    const ws = await createStorefrontWorkspace('routes-social-urls');
    clerk.getAuth.mockReturnValue({ userId: ws.owner.principalId, orgId: ws.clerkOrgId });
    const app = createApp();
    const document = defaultStorefrontDocument('A');
    document.contact.instagram = 'https://www.instagram.com/luna.gowns/';
    document.contact.facebook = 'https://facebook.com/luna-rentals';
    document.contact.tiktok = 'https://www.tiktok.com/@luna.gowns/';

    const saved = await request(app)
      .patch('/api/v1/storefront')
      .set('Idempotency-Key', 'routes-social-urls-save')
      .send({ version: 1, document });
    expect(saved.status).toBe(200);
    expect(dataOf<StorefrontSettings>(saved).document.contact).toMatchObject({
      instagram: 'luna.gowns',
      facebook: 'luna-rentals',
      tiktok: 'luna.gowns',
    });

    const legacyDocument = defaultStorefrontDocument('A');
    legacyDocument.contact.instagram = '@luna.gowns';
    legacyDocument.contact.facebook = 'luna-rentals';
    legacyDocument.contact.tiktok = '@luna.gowns';
    const legacyHandles = await request(app)
      .patch('/api/v1/storefront')
      .set('Idempotency-Key', 'routes-social-urls-legacy')
      .send({ version: 2, document: legacyDocument });
    expect(legacyHandles.status).toBe(200);

    const reloaded = await request(app).get('/api/v1/storefront');
    expect(dataOf<StorefrontSettings>(reloaded).document.contact).toMatchObject({
      instagram: 'luna.gowns',
      facebook: 'luna-rentals',
      tiktok: 'luna.gowns',
    });
  });

  it('persists and reloads a normalized numeric Facebook Page reference', async () => {
    const ws = await createStorefrontWorkspace('routes-facebook-id');
    clerk.getAuth.mockReturnValue({ userId: ws.owner.principalId, orgId: ws.clerkOrgId });
    const app = createApp();
    const document = defaultStorefrontDocument('A');
    document.contact.facebook = 'https://www.facebook.com/profile.php?id=615940716454514';

    const saved = await request(app)
      .patch('/api/v1/storefront')
      .set('Idempotency-Key', 'routes-facebook-id-save')
      .send({ version: 1, document });
    expect(saved.status).toBe(200);
    expect(dataOf<StorefrontSettings>(saved).document.contact.facebook).toBe(
      'profile.php?id=615940716454514',
    );

    const reloaded = await request(app).get('/api/v1/storefront');
    expect(dataOf<StorefrontSettings>(reloaded).document.contact.facebook).toBe(
      'profile.php?id=615940716454514',
    );
  });

  it('queues only storefront images displaced across logo, cover, hero, and about fields', async () => {
    const ws = await createStorefrontWorkspace('routes-cleanup-media');
    clerk.getAuth.mockReturnValue({ userId: ws.owner.principalId, orgId: ws.clerkOrgId });
    const app = createApp();
    const previous = {
      logo: fileObjectId.parse(
        await createStorefrontAsset(ws.tenantId, ws.owner.principalId, 'cleanup-logo-old'),
      ),
      cover: fileObjectId.parse(
        await createStorefrontAsset(ws.tenantId, ws.owner.principalId, 'cleanup-cover-kept'),
      ),
      hero: fileObjectId.parse(
        await createStorefrontAsset(ws.tenantId, ws.owner.principalId, 'cleanup-hero-old'),
      ),
      about: fileObjectId.parse(
        await createStorefrontAsset(ws.tenantId, ws.owner.principalId, 'cleanup-about-old'),
      ),
    };
    const replacement = {
      logo: fileObjectId.parse(
        await createStorefrontAsset(ws.tenantId, ws.owner.principalId, 'cleanup-logo-new'),
      ),
      about: fileObjectId.parse(
        await createStorefrontAsset(ws.tenantId, ws.owner.principalId, 'cleanup-about-new'),
      ),
    };
    const initialDocument = defaultStorefrontDocument('A');
    initialDocument.branding.logo_file_id = previous.logo;
    initialDocument.branding.cover_file_id = previous.cover;
    initialDocument.content.hero.image_file_id = previous.hero;
    initialDocument.content.about.image_file_id = previous.about;

    const initial = await request(app)
      .patch('/api/v1/storefront')
      .set('Idempotency-Key', 'routes-cleanup-media-initial')
      .send({ version: 1, document: initialDocument });
    expect(initial.status).toBe(200);

    await withTenantTransaction(ws.tenantId, ws.owner.principalId, async (client) => {
      await client.query(
        `UPDATE policy_snapshot
            SET rental_rules = jsonb_set(COALESCE(rental_rules, '{}'::jsonb), '{image_file_ids}', $3::jsonb, true)
          WHERE tenant_id = $1 AND storefront_id = $2 AND version = 1`,
        [ws.tenantId, ws.storefrontId, JSON.stringify([previous.about])],
      );
    });

    const replacementDocument = { ...initialDocument };
    replacementDocument.branding = { ...initialDocument.branding, logo_file_id: replacement.logo };
    replacementDocument.content = {
      ...initialDocument.content,
      hero: { ...initialDocument.content.hero, image_file_id: replacement.logo },
      about: { ...initialDocument.content.about, image_file_id: replacement.about },
    };
    const saved = await request(app)
      .patch('/api/v1/storefront')
      .set('Idempotency-Key', 'routes-cleanup-media-replace')
      .send({ version: 2, document: replacementDocument });
    expect(saved.status).toBe(200);
    expect(dataOf<StorefrontSettings>(saved).document.branding).toMatchObject({
      logo_file_id: replacement.logo,
      cover_file_id: previous.cover,
    });
    expect(dataOf<StorefrontSettings>(saved).document.content).toMatchObject({
      hero: { image_file_id: replacement.logo },
      about: { image_file_id: replacement.about },
    });

    const cleanupCandidates = await withTenantTransaction(
      ws.tenantId,
      ws.owner.principalId,
      async (client) => {
        const result = await client.query<{ payload: { file_id: string } }>(
          `SELECT payload FROM outbox_event
          WHERE tenant_id = $1 AND event_type = 'file.object_cleanup.requested'
          ORDER BY dedupe_key`,
          [ws.tenantId],
        );
        return result.rows.map((row) => row.payload.file_id);
      },
    );
    expect(cleanupCandidates).toEqual([previous.about, previous.hero, previous.logo].sort());
    expect(cleanupCandidates).not.toContain(previous.cover);
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
