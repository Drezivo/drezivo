import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Public storefront reads against a real PostgreSQL with RLS: publish gating, projection allowlist,
 * catalogue filters, item detail, day availability, and fitting slots.
 */
import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  ensureAppRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';
import type { CatalogueResponse, FittingSlotsResponse, ItemDetail, PublicAvailabilityResponse, PublicStorefront } from '@drezivo/contracts';

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: () => ({ userId: null, orgId: null }),
}));

/** Typed envelope data for supertest responses. */
const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

describe('public storefront read API', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool } = await import('../../src/db/client.js');
  const { storefrontCmsService: cms } = await import('../../src/modules/storefront-cms/storefront-cms.service.js');
  const { addDays, localDate } = await import('../../src/modules/storefront/storefront.service.js');
  const { weekdayOf } = await import('../../src/modules/storefront/shop-closures.js');
  const { createStorefrontAsset, createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
  const { defaultStorefrontDocument, fileObjectId, productId } = await import('@drezivo/contracts');
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });

  const rules = {
    format: 'text' as const,
    image_file_ids: [],
    rental: 'Three-day rentals from pickup.',
    deposit: 'Refundable deposit at pickup.',
    cancellation: 'Free cancellation until 48 hours before pickup.',
    damage: 'Minor wear is covered.',
    delivery: { enabled: true, fee_minor: '15000', notes: 'Metro Manila only.' },
    privacy_notice: 'Your details are used only for this rental.',
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

  async function publishedWorkspace(label: string, tweak: (doc: ReturnType<typeof defaultStorefrontDocument>) => void = () => undefined) {
    const ws = await createStorefrontWorkspace(label);
    const document = defaultStorefrontDocument('Luna Gown Rentals');
    document.contact.email = 'hello@luna.test';
    document.contact.instagram = 'luna.gowns';
    document.content.featured_product_ids = [productId.parse(ws.productId)];
    tweak(document);
    expect((await cms.updateDocument(ws.owner, `${label}-doc`, { version: 1, document })).status).toBe(200);
    expect((await cms.publishPolicy(ws.owner, `${label}-pol`, { expected_version: 1, rules })).status).toBe(200);
    expect((await cms.publish(ws.owner, `${label}-pub`, 2)).status).toBe(200);
    return ws;
  }

  it('hides drafts and exposes only the allowlisted projection once published', async () => {
    const draft = await createStorefrontWorkspace('pub-draft');
    const app = createApp();
    expect((await request(app).get(`/api/v1/public/stores/${draft.slug}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/public/stores/no-such-store')).status).toBe(404);

    const ws = await publishedWorkspace('pub-live');
    const response = await request(app).get(`/api/v1/public/stores/${ws.slug}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('s-maxage=300');
    const store = dataOf<PublicStorefront>(response);
    expect(store).toMatchObject({
      name: 'Luna Gown Rentals',
      contact: { email: 'hello@luna.test', instagram_url: 'https://www.instagram.com/luna.gowns/' },
      fulfillment: { pickup: true, delivery: true, delivery_fee_minor: '15000' },
      policy: { version: 2, rental: rules.rental },
      fitting: { enabled: false },
    });
    expect(store.featured.map((card) => card.product_id)).toEqual([ws.productId]);
    expect(store.featured[0]?.image_url).toMatch(/^https?:\/\//);
    expect(store.categories).toEqual([{ id: expect.any(String) as string, name: 'Gowns', item_count: 1 }]);
    expect(store.payment_methods).toEqual([{ id: ws.paymentMethodId, name: 'Bank transfer', rail: 'manual_transfer' }]);

    // Signed image URLs carry the files module's object key (which includes the tenant id) and a
    // short-lived signature; nothing else in the projection may reveal internal identifiers.
    const withoutSignedUrls = JSON.stringify(store, (key, value: unknown) => (key.endsWith('_url') && typeof value === 'string' && value.startsWith('http') ? '[signed]' : value));
    for (const secret of [ws.tenantId, ws.branchId, ws.storefrontId, '001234567890', 'tenant-files/']) {
      expect(withoutSignedUrls).not.toContain(secret);
    }

    // Taking the store offline makes every public route a 404 again.
    await cms.unpublish(ws.owner, 'pub-live-off', 3);
    expect((await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue`)).status).toBe(404);
  });

  it('publishes rental terms as images in page order and never shows the typed text kept for later', async () => {
    const ws = await createStorefrontWorkspace('pub-img');
    const other = await createStorefrontWorkspace('pub-img-other');
    const pageOne = await createStorefrontAsset(ws.tenantId, ws.owner.principalId, 'policy-page-one');
    const pageTwo = await createStorefrontAsset(ws.tenantId, ws.owner.principalId, 'policy-page-two');
    const foreign = await createStorefrontAsset(other.tenantId, other.owner.principalId, 'policy-foreign');
    const document = defaultStorefrontDocument('Luna Gown Rentals');
    document.contact.email = 'hello@luna.test';
    expect((await cms.updateDocument(ws.owner, 'pub-img-doc', { version: 1, document })).status).toBe(200);

    const imageRules = {
      ...rules,
      format: 'images' as const,
      rental: 'Old typed wording the owner kept in the editor.',
      image_file_ids: [fileObjectId.parse(pageTwo), fileObjectId.parse(pageOne)],
    };
    const refused = await cms.publishPolicy(ws.owner, 'pub-img-foreign', {
      expected_version: 1,
      rules: { ...imageRules, image_file_ids: [fileObjectId.parse(pageOne), fileObjectId.parse(foreign)] },
    });
    expect(refused.status).toBe(422);

    const saved = await cms.publishPolicy(ws.owner, 'pub-img-pol', { expected_version: 1, rules: imageRules });
    expect(saved.status).toBe(200);
    const view = saved.body.success ? saved.body.data : null;
    expect(view?.policy.rules).toMatchObject({ format: 'images', image_file_ids: [pageTwo, pageOne] });
    expect(Object.keys(view?.policy.image_urls ?? {}).sort()).toEqual([pageOne, pageTwo].sort());
    expect(view?.readiness.has_policy).toBe(true);
    expect((await cms.publish(ws.owner, 'pub-img-pub', 2)).status).toBe(200);

    const store = dataOf<PublicStorefront>(await request(createApp()).get(`/api/v1/public/stores/${ws.slug}`));
    expect(store.policy).toMatchObject({ format: 'images', rental: '', deposit: '', cancellation: '', damage: null, privacy_notice: rules.privacy_notice });
    expect(store.policy.image_urls).toHaveLength(2);
    expect(store.policy.image_urls[0]).toContain('policy-page-two');
    expect(store.policy.image_urls[1]).toContain('policy-page-one');
  });

  it('filters, searches, and pages the catalogue without treating input as SQL wildcards', async () => {
    const ws = await publishedWorkspace('pub-cat');
    const app = createApp();
    await admin.query(`UPDATE product SET subcategory = 'LONG' WHERE tenant_id = $1 AND id = $2`, [ws.tenantId, ws.productId]);
    const miniProduct = await admin.query<{ id: string }>(
      `INSERT INTO product (tenant_id, category_id, code, name, description, subcategory, status)
       SELECT tenant_id, category_id, 'PUB-MINI-001', 'Mini Dress', 'A published mini dress.', 'MINI', 'active'
         FROM product WHERE tenant_id = $1 AND id = $2
       RETURNING id`,
      [ws.tenantId, ws.productId],
    );
    await admin.query(
      `INSERT INTO product_variant
         (tenant_id, product_id, sku, size_label, color_label, measurements, measurement_unit, measurement_mode,
          rental_price_minor, security_deposit_minor, currency, pricing_mode, included_duration_minutes,
          extra_day_price_minor, prep_minutes, turnaround_minutes, status)
       SELECT tenant_id, $2, 'PUB-MINI-M', size_label, color_label, measurements, measurement_unit, measurement_mode,
              rental_price_minor, security_deposit_minor, currency, pricing_mode, included_duration_minutes,
              extra_day_price_minor, prep_minutes, turnaround_minutes, 'active'
         FROM product_variant WHERE tenant_id = $1 AND id = $3`,
      [ws.tenantId, miniProduct.rows[0]?.id, ws.variantIds.m],
    );
    await admin.query(
      `INSERT INTO product (tenant_id, category_id, code, name, description, subcategory, status)
       SELECT tenant_id, category_id, 'DRAFT-SUB-001', 'Hidden Dress', '', 'DRAFT-ONLY', 'draft'
         FROM product WHERE tenant_id = $1 AND id = $2`,
      [ws.tenantId, ws.productId],
    );
    const all = await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue`);
    expect(dataOf<CatalogueResponse>(all)).toMatchObject({ total: 2, page: 1, page_size: 24, sizes: ['M', 'L'], subcategories: ['LONG', 'MINI'] });
    expect(dataOf<CatalogueResponse>(all).items.find((item) => item.name === 'Emerald Gown')).toMatchObject({ subcategory: 'LONG', price_from_minor: '180000', sizes: ['M', 'L'] });
    expect(dataOf<CatalogueResponse>(all).items.find((item) => item.name === 'Mini Dress')).toMatchObject({ subcategory: 'MINI' });
    expect(dataOf<CatalogueResponse>(await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue?subcategory=mini`))).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ name: 'Mini Dress', subcategory: 'MINI' })],
      subcategories: ['LONG', 'MINI'],
    });
    expect(dataOf<CatalogueResponse>(await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue?subcategory=DRAFT-ONLY`)).total).toBe(0);
    expect(dataOf<CatalogueResponse>(all).subcategories).not.toContain('DRAFT-ONLY');

    expect(dataOf<CatalogueResponse>(await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue?search=emerald`)).total).toBe(1);
    expect(dataOf<CatalogueResponse>(await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue?search=%25`)).total).toBe(0);
    expect(dataOf<CatalogueResponse>(await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue?size=xl`)).total).toBe(0);
    expect((await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue?page_size=500`)).status).toBe(422);
    expect((await request(app).get(`/api/v1/public/stores/${ws.slug}/catalogue?tenant=x`)).status).toBe(422);
  });

  it('shows item detail with sizes and measurements, and hides archived items', async () => {
    const ws = await publishedWorkspace('pub-item');
    const app = createApp();
    const item = await request(app).get(`/api/v1/public/stores/${ws.slug}/products/${ws.productId}`);
    expect(item.status).toBe(200);
    expect(dataOf<ItemDetail>(item).subcategory).toBeNull();
    expect(dataOf<ItemDetail>(item).variants.map((v) => v.size_label)).toEqual(['M', 'L']);
    expect(dataOf<ItemDetail>(item).variants[0]?.measurement).toEqual({
      mode: 'custom',
      unit: 'cm',
      values: [{ label: 'Bust', value: '86 cm' }, { label: 'Waist', value: '66 cm' }],
    });
    await admin.query<Record<string, unknown>>(`UPDATE product SET status = 'archived' WHERE id = $1`, [ws.productId]);
    expect((await request(app).get(`/api/v1/public/stores/${ws.slug}/products/${ws.productId}`)).status).toBe(404);
  });

  it('reports day availability in store time, honouring minimum notice', async () => {
    const ws = await publishedWorkspace('pub-avail');
    const other = await createStorefrontWorkspace('pub-avail-other');
    const app = createApp();
    const today = localDate(new Date(), 'Asia/Manila');
    const to = addDays(today, 6);
    const response = await request(app).get(`/api/v1/public/stores/${ws.slug}/availability?variant_id=${ws.variantIds.m}&from=${today}&to=${to}`);
    expect(response.status).toBe(200);
    const days = dataOf<PublicAvailabilityResponse>(response).days;
    expect(days).toHaveLength(7);
    // Days may carry `closed` (new branches close on Sundays); it never changes the garment's state.
    expect(days[0]).toMatchObject({ date: today, state: 'unavailable' }); // default notice is 1 day
    expect(days.slice(1).every((day) => day.state === 'available')).toBe(true);

    const foreign = await request(app).get(`/api/v1/public/stores/${ws.slug}/availability?variant_id=${other.variantIds.m}&from=${today}&to=${to}`);
    expect(foreign.status).toBe(404);
    const tooWide = await request(app).get(`/api/v1/public/stores/${ws.slug}/availability?variant_id=${ws.variantIds.m}&from=${today}&to=${addDays(today, 90)}`);
    expect(tooWide.status).toBe(422);
  });

  it('marks closed weekdays and special closures without blocking the garment', async () => {
    const ws = await publishedWorkspace('pub-avail-closed');
    const app = createApp();
    const today = localDate(new Date(), 'Asia/Manila');
    const closureDate = addDays(today, 4);
    const closedWeekday = weekdayOf(addDays(today, 2));
    await admin.query(
      `UPDATE branch SET operating_hours = jsonb_set(operating_hours, '{closed_weekdays}', $3::jsonb) WHERE tenant_id = $1 AND id = $2`,
      [ws.tenantId, ws.branchId, JSON.stringify([closedWeekday])],
    );
    await admin.query(`INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason) VALUES ($1, $2, $3, 'Inventory')`, [ws.tenantId, ws.branchId, closureDate]);

    const response = await request(app).get(`/api/v1/public/stores/${ws.slug}/availability?variant_id=${ws.variantIds.m}&from=${today}&to=${addDays(today, 13)}`);
    expect(response.status).toBe(200);
    const days = dataOf<PublicAvailabilityResponse>(response).days;
    const closed = days.filter((day) => day.closed).map((day) => day.date);
    const expected = days.map((day) => day.date).filter((date) => date === closureDate || weekdayOf(date) === closedWeekday);
    expect(closed).toEqual(expected);
    expect(closed).toContain(closureDate);
    // The flag is only ever `true`, and a closed day keeps its real (bookable) state.
    expect(days.filter((day) => day.date !== today && day.closed).every((day) => day.state === 'available')).toBe(true);
    expect(days.filter((day) => !day.closed).every((day) => !('closed' in day))).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('Inventory');
  });

  it('offers fitting slots only when the owner opts in, within hours, capacity, and closures', async () => {
    const ws = await publishedWorkspace('pub-fit', (doc) => {
      doc.checkout.fitting_requests = true;
      doc.content.sections.fitting = true;
    });
    const app = createApp();
    const date = addDays(localDate(new Date(), 'Asia/Manila'), 3);

    expect((await request(app).get(`/api/v1/public/stores/${ws.slug}/fitting-slots?date=${date}`)).status).toBe(404);

    await admin.query<Record<string, unknown>>(
      `INSERT INTO fitting_settings (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency)
       VALUES ($1, $2, true, 1, 60, 50000, 'PHP')`,
      [ws.tenantId, ws.branchId],
    );
    await admin.query<Record<string, unknown>>(
      `UPDATE branch
          SET operating_hours = '{"opens_local":"10:00","closes_local":"12:00","closed_weekdays":[]}'::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [ws.tenantId, ws.branchId],
    );
    const open = await request(app).get(`/api/v1/public/stores/${ws.slug}/fitting-slots?date=${date}`);
    expect(open.status).toBe(200);
    expect(dataOf<FittingSlotsResponse>(open)).toMatchObject({ duration_minutes: 60, fee_minor: '50000' });
    const openSlots = dataOf<FittingSlotsResponse>(open).slots;
    expect(openSlots.map((slot) => slot.start_at)).toEqual([
      `${date}T02:00:00.000Z`,
      `${date}T02:30:00.000Z`,
      `${date}T03:00:00.000Z`,
    ]);
    expect(openSlots[0]?.start_at).toBe(`${date}T02:00:00.000Z`); // 10:00 Asia/Manila opening time.
    expect(openSlots.at(-1)?.end_at).toBe(`${date}T04:00:00.000Z`); // Final slot ends exactly at 12:00 closing.

    await admin.query<Record<string, unknown>>(
      `INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason)
       VALUES ($1, $2, $3::date, 'Staff training')`,
      [ws.tenantId, ws.branchId, date],
    );
    const afterClosure = await request(app).get(`/api/v1/public/stores/${ws.slug}/fitting-slots?date=${date}`);
    expect(dataOf<FittingSlotsResponse>(afterClosure).slots).toEqual([]);

    await admin.query<Record<string, unknown>>(
      `DELETE FROM branch_closure WHERE tenant_id = $1 AND branch_id = $2 AND local_date = $3::date`,
      [ws.tenantId, ws.branchId, date],
    );
    const weekday = new Date(`${date}T00:00:00.000Z`)
      .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
      .toLowerCase();
    await admin.query<Record<string, unknown>>(
      `UPDATE branch
          SET operating_hours = jsonb_set(operating_hours, '{closed_weekdays}', to_jsonb(ARRAY[$3]::text[]))
        WHERE tenant_id = $1 AND id = $2`,
      [ws.tenantId, ws.branchId, weekday],
    );
    const recurringClosed = await request(app).get(`/api/v1/public/stores/${ws.slug}/fitting-slots?date=${date}`);
    expect(dataOf<FittingSlotsResponse>(recurringClosed).slots).toEqual([]);

    const store = await request(app).get(`/api/v1/public/stores/${ws.slug}`);
    expect(dataOf<PublicStorefront>(store).fitting).toEqual({ enabled: true, duration_minutes: 60, fee_minor: '50000' });
    expect(dataOf<PublicStorefront>(store).content.sections.fitting).toBe(true);
  });
});
