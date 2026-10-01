import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Storefront CMS and business settings against a real PostgreSQL with RLS: owner-only writes,
 * optimistic versions, idempotent replay, concurrent double-fire, publish readiness, and
 * cross-workspace reference checks.
 */
import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

describe('storefront CMS and settings', async () => {
  const { closePool } = await import('../../src/db/client.js');
  /** Assertions read as the superuser so RLS cannot hide the rows being checked. */
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const { storefrontCmsService: cms } = await import('../../src/modules/storefront-cms/storefront-cms.service.js');
  const { settingsService: settings } = await import('../../src/modules/settings/settings.service.js');
  const { createStorefrontWorkspace, createStorefrontAsset } = await import('./helpers/storefront-fixture.js');
  const { defaultStorefrontDocument, storefrontDocument } = await import('@drezivo/contracts');

  const policy = {
    format: 'text' as const,
    image_file_ids: [],
    rental: 'Rentals run for three days from pickup.',
    deposit: 'A refundable deposit is collected at pickup.',
    cancellation: 'Cancel at least 48 hours before pickup for a full refund.',
    damage: null,
    delivery: { enabled: true, fee_minor: '15000', notes: 'Metro Manila only.' },
    privacy_notice: 'We use your details only to handle this rental.',
  };

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
  });
  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  it('starts from a default draft document that is not ready to publish', async () => {
    const ws = await createStorefrontWorkspace('cms-default');
    const view = await cms.get(ws.owner);
    expect(view.status).toBe('draft');
    expect(view.version).toBe(1);
    expect(view.document.branding.display_name).toMatch(/^Test Business/);
    expect(view.policy.rules).toBeNull();
    expect(view.readiness).toMatchObject({ has_policy: false, has_active_clothing: true, has_storefront_payment_method: true, has_contact: false, ready: false });
    // Front desk may read but never write.
    await expect(cms.get(ws.frontDesk)).resolves.toMatchObject({ slug: ws.slug });
    expect(() => cms.updateDocument(ws.frontDesk, 'k-desk', { version: 1, document: view.document })).toThrow(/owner/);
  });

  it('saves once per key, replays retries, rejects key reuse and stale versions', async () => {
    const ws = await createStorefrontWorkspace('cms-save');
    const document = { ...defaultStorefrontDocument('Luna'), contact: { ...defaultStorefrontDocument('Luna').contact, phone: '+63 917 123 4567' } };

    const first = await cms.updateDocument(ws.owner, 'save-1', { version: 1, document });
    expect(first.status).toBe(200);
    expect(first.body.success && first.body.data.version).toBe(2);

    const replay = await cms.updateDocument(ws.owner, 'save-1', { version: 1, document });
    expect(replay).toEqual(first);

    await expect(cms.updateDocument(ws.owner, 'save-1', { version: 1, document: { ...document, branding: { ...document.branding, theme: 'noir' } } }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    const stale = await cms.updateDocument(ws.owner, 'save-2', { version: 1, document });
    expect(stale.status).toBe(409);
    expect(stale.body.success).toBe(false);

    const audit = await admin.query<Record<string, unknown>>(`SELECT count(*)::int AS n FROM audit_event WHERE tenant_id = $1 AND action = 'storefront.document.updated'`, [ws.tenantId]);
    expect(audit.rows[0]?.['n']).toBe(1);
  });

  it('lets exactly one of two concurrent edits of the same version win', async () => {
    const ws = await createStorefrontWorkspace('cms-race');
    const document = defaultStorefrontDocument('Race');
    const results = await Promise.all([
      cms.updateDocument(ws.owner, 'race-a', { version: 1, document: { ...document, branding: { ...document.branding, theme: 'sage' } } }),
      cms.updateDocument(ws.owner, 'race-b', { version: 1, document: { ...document, branding: { ...document.branding, theme: 'blush' } } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const view = await cms.get(ws.owner);
    expect(view.version).toBe(2);
  });

  it('refuses images and featured items that do not belong to the workspace', async () => {
    const ws = await createStorefrontWorkspace('cms-refs');
    const other = await createStorefrontWorkspace('cms-refs-other');
    const foreignAsset = await createStorefrontAsset(other.tenantId, other.owner.principalId, 'logo');
    const ownAsset = await createStorefrontAsset(ws.tenantId, ws.owner.principalId, 'logo');
    const base = defaultStorefrontDocument('Refs');

    const foreign = await cms.updateDocument(ws.owner, 'refs-1', { version: 1, document: storefrontDocument.parse({ ...base, branding: { ...base.branding, logo_file_id: foreignAsset } }) });
    expect(foreign.status).toBe(422);
    const foreignProduct = await cms.updateDocument(ws.owner, 'refs-2', { version: 1, document: storefrontDocument.parse({ ...base, content: { ...base.content, featured_product_ids: [other.productId] } }) });
    expect(foreignProduct.status).toBe(422);
    // A catalogue image is not a storefront asset even inside the same workspace.
    const wrongPurpose = await cms.updateDocument(ws.owner, 'refs-3', { version: 1, document: storefrontDocument.parse({ ...base, branding: { ...base.branding, logo_file_id: ws.imageFileId } }) });
    expect(wrongPurpose.status).toBe(422);

    const ok = await cms.updateDocument(ws.owner, 'refs-4', {
      version: 1,
      document: storefrontDocument.parse({ ...base, branding: { ...base.branding, logo_file_id: ownAsset }, content: { ...base.content, featured_product_ids: [ws.productId] } }),
    });
    expect(ok.status).toBe(200);
  });

  it('publishes only when ready, and policy versions are append-only', async () => {
    const ws = await createStorefrontWorkspace('cms-publish');
    const blocked = await cms.publish(ws.owner, 'pub-1', 1);
    expect(blocked.status).toBe(422);
    expect(!blocked.body.success && blocked.body.error.message).toMatch(/rental policy.*contact/);

    const firstPolicy = await cms.publishPolicy(ws.owner, 'pol-1', { expected_version: 1, rules: policy });
    expect(firstPolicy.body.success && firstPolicy.body.data.policy).toMatchObject({ version: 2, rules: policy });
    const stalePolicy = await cms.publishPolicy(ws.owner, 'pol-2', { expected_version: 1, rules: policy });
    expect(stalePolicy.status).toBe(409);

    const base = defaultStorefrontDocument('Publish');
    await cms.updateDocument(ws.owner, 'doc-1', { version: 1, document: { ...base, contact: { ...base.contact, email: 'hello@luna.test' } } });
    const published = await cms.publish(ws.owner, 'pub-2', 2);
    expect(published.status).toBe(200);
    expect(published.body.success && published.body.data).toMatchObject({ status: 'published', version: 3 });
    expect(published.body.success && published.body.data.published_at).not.toBeNull();

    const unpublished = await cms.unpublish(ws.owner, 'unpub-1', 3);
    expect(unpublished.body.success && unpublished.body.data.status).toBe('draft');
    const policies = await admin.query<Record<string, unknown>>(`SELECT version FROM policy_snapshot WHERE tenant_id = $1 ORDER BY version`, [ws.tenantId]);
    expect(policies.rows.map((r) => r['version'])).toEqual([1, 2]);
  });

  it('keeps storefront addresses unique across workspaces', async () => {
    const a = await createStorefrontWorkspace('slug-a');
    const b = await createStorefrontWorkspace('slug-b');
    const taken = await cms.updateSlug(b.owner, 'slug-1', { version: 1, slug: a.slug });
    expect(taken.status).toBe(409);
    const changed = await cms.updateSlug(b.owner, 'slug-2', { version: 1, slug: 'luna-gowns-qc' });
    expect(changed.body.success && changed.body.data).toMatchObject({ slug: 'luna-gowns-qc', public_path: '/s/luna-gowns-qc' });
  });

  it('updates business information and notification preferences with version checks', async () => {
    const ws = await createStorefrontWorkspace('settings');
    const business = await settings.getBusiness(ws.owner);
    expect(business).toMatchObject({ version: 1, timezone: 'Asia/Manila', currency: 'PHP', business_email: null });

    const saved = await settings.updateBusiness(ws.owner, 'biz-1', {
      version: 1,
      business_name: 'Luna Gown Rentals',
      business_email: 'owner@luna.test',
      business_phone: '+63 917 000 0000',
      business_address: '12 Mabini St, Quezon City',
    });
    expect(saved.body.success && saved.body.data).toMatchObject({ version: 2, business_name: 'Luna Gown Rentals' });
    const tenant = await admin.query<Record<string, unknown>>('SELECT name FROM tenant WHERE id = $1', [ws.tenantId]);
    expect(tenant.rows[0]?.['name']).toBe('Luna Gown Rentals');

    const notifications = await settings.getNotifications(ws.owner);
    expect(notifications).toMatchObject({ version: 2, email_enabled: true, business_recipient: 'owner@luna.test' });
    const muted = await settings.updateNotifications(ws.owner, 'notif-1', {
      version: 2,
      email_enabled: true,
      customer: { ...notifications.customer, request_rejected: false },
      business: { ...notifications.business, new_fitting_request: false },
    });
    expect(muted.body.success && muted.body.data.customer.request_rejected).toBe(false);
    const stale = await settings.updateNotifications(ws.owner, 'notif-2', { version: 2, email_enabled: false, customer: notifications.customer, business: notifications.business });
    expect(stale.status).toBe(409);
    expect(() => settings.updateBusiness(ws.frontDesk, 'biz-desk', { version: 3, business_name: 'X Rentals', business_email: null, business_phone: null, business_address: null })).toThrow(/owner/);
  });
});
