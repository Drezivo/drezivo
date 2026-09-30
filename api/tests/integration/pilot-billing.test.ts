import { randomUUID } from 'node:crypto';

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

/**
 * Pilot billing (migration 0062) end to end over HTTP against PostgreSQL with RLS: access derived
 * from the subscription dates, the storefront and bookings following it, duplicate-safe proof of
 * payment, and the five-online-method limit for a business's own payment methods.
 */
const clerk = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: clerk.getAuth,
}));

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

type Envelope = { success: boolean; data?: Record<string, unknown>; error?: { code: string } };
const bodyOf = (response: { body: unknown }): Envelope => response.body as Envelope;
/** The first row, or a clear failure instead of a non-null assertion. */
function onlyRow<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error('expected a row');
  return row;
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)]);

describe('pilot billing', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool } = await import('../../src/db/client.js');
  const { storefrontCmsService: cms } = await import('../../src/modules/storefront-cms/storefront-cms.service.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
  const { defaultStorefrontDocument, productId } = await import('@drezivo/contracts');
  const admin = new pg.Pool({ connectionString: adminUrl, max: 3 });

  const rules = {
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
  beforeEach(() => clerk.getAuth.mockReset());
  afterEach(async () => {
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  async function publishedWorkspace(label: string) {
    const ws = await createStorefrontWorkspace(label);
    const document = defaultStorefrontDocument('Luna Gown Rentals');
    document.contact.email = 'hello@luna.test';
    document.content.featured_product_ids = [productId.parse(ws.productId)];
    expect((await cms.updateDocument(ws.owner, `${label}-doc`, { version: 1, document })).body).toMatchObject({ success: true });
    expect((await cms.publishPolicy(ws.owner, `${label}-pol`, { expected_version: 1, rules })).body).toMatchObject({ success: true });
    expect((await cms.publish(ws.owner, `${label}-pub`, 2)).body).toMatchObject({ success: true });
    return ws;
  }

  /** Moves the workspace's subscription dates; `sql` is a trusted literal from this file only. */
  async function setSubscription(tenantId: string, sql: string): Promise<void> {
    await admin.query(`UPDATE subscription SET ${sql} WHERE tenant_id = $1`, [tenantId]);
  }

  const asOwner = (ws: { owner: { principalId: string }; clerkOrgId: string }) =>
    clerk.getAuth.mockReturnValue({ userId: ws.owner.principalId, orgId: ws.clerkOrgId });

  describe('access follows the subscription dates', () => {
    it('keeps a paid shop fully open, with bookings on', async () => {
      const ws = await publishedWorkspace('pb-full');
      asOwner(ws);
      const app = createApp();
      const context = bodyOf(await request(app).get('/api/v1/actor-context')).data as { access: Record<string, unknown> };
      expect(context.access).toMatchObject({ level: 'full', reason: 'paid', storefront_online: true });
      const store = await request(app).get(`/api/v1/public/stores/${ws.slug}`);
      expect(store.status).toBe(200);
      expect(bodyOf(store).data).toMatchObject({ booking_open: true });
    });

    it('makes a lapsed shop view-only: reads work, writes are refused, the storefront stays up with bookings paused', async () => {
      const ws = await publishedWorkspace('pb-readonly');
      await setSubscription(ws.tenantId, "current_period_end = now() - interval '1 day'");
      asOwner(ws);
      const app = createApp();

      expect((await request(app).get('/api/v1/storefront')).status).toBe(200);
      const write = await request(app).patch('/api/v1/storefront').set('Idempotency-Key', 'pb-readonly-write')
        .send({ version: 3, document: defaultStorefrontDocument('Renamed') });
      expect(write.status).toBe(403);
      expect(bodyOf(write).error?.code).toBe('SUBSCRIPTION_READ_ONLY');

      const store = await request(app).get(`/api/v1/public/stores/${ws.slug}`);
      expect(store.status).toBe(200);
      expect(bodyOf(store).data).toMatchObject({ booking_open: false });
      const verify = await request(app).post(`/api/v1/public/stores/${ws.slug}/verifications`).send({ email: 'ana@example.test' });
      expect(verify.status).toBe(409);
      expect(bodyOf(verify).error?.code).toBe('BOOKING_PAUSED');
    });

    it('takes the storefront offline three days after the end, while staff can still read', async () => {
      const ws = await publishedWorkspace('pb-offline');
      await setSubscription(ws.tenantId, "current_period_end = now() - interval '4 days'");
      asOwner(ws);
      const app = createApp();
      expect((await request(app).get(`/api/v1/public/stores/${ws.slug}`)).status).toBe(404);
      expect((await request(app).get('/api/v1/storefront')).status).toBe(200);
    });

    it('locks the workspace 30 days after an ended trial: only billing and subscribing remain', async () => {
      const ws = await publishedWorkspace('pb-locked');
      await setSubscription(ws.tenantId, "status = 'trialing', trial_ends_at = now() - interval '31 days', current_period_end = now() - interval '31 days'");
      asOwner(ws);
      const app = createApp();
      const read = await request(app).get('/api/v1/storefront');
      expect(read.status).toBe(403);
      expect(bodyOf(read).error?.code).toBe('SUBSCRIPTION_LOCKED');
      expect((await request(app).get('/api/v1/actor-context')).status).toBe(200);
      const billing = await request(app).get('/api/v1/billing');
      expect(billing.status).toBe(200);
      expect(bodyOf(billing).data).toMatchObject({ can_pay: true, access: { level: 'locked', reason: 'trial_ended' } });
      expect((await request(app).get(`/api/v1/public/stores/${ws.slug}`)).status).toBe(404);
    });

    it('lets an operator extension keep an old lapse view-only with the storefront up', async () => {
      const ws = await publishedWorkspace('pb-extension');
      await setSubscription(ws.tenantId, "status = 'trialing', trial_ends_at = now() - interval '40 days', current_period_end = now() - interval '40 days', grace_ends_at = now() + interval '5 days'");
      asOwner(ws);
      const app = createApp();
      expect((await request(app).get('/api/v1/storefront')).status).toBe(200);
      const store = await request(app).get(`/api/v1/public/stores/${ws.slug}`);
      expect(store.status).toBe(200);
      expect(bodyOf(store).data).toMatchObject({ booking_open: false });
    });
  });

  describe('proof of payment', () => {
    async function payableWorkspace(label: string) {
      const ws = await createStorefrontWorkspace(label);
      await setSubscription(ws.tenantId, "status = 'trialing', trial_ends_at = now() - interval '2 days', current_period_end = now() - interval '2 days'");
      const method = await admin.query<{ id: string }>(
        `INSERT INTO platform_payment_method (label, account_name, account_number, qr_image, qr_mime)
         VALUES ('GCash', 'Drezivo', '09171234567', $1, 'image/png') RETURNING id`,
        [PNG],
      );
      const proof = async () => onlyRow((await admin.query<{ id: string }>(
        `INSERT INTO file_object (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status, is_private, upload_expires_at, frozen_at)
         VALUES ($1, 'subscription_payment_proof', $2, $3, 'image/png', 256, 'accepted', true, now() + interval '1 day', now()) RETURNING id`,
        [ws.tenantId, `test/proof/${randomUUID()}.png`, `v-${randomUUID()}`],
      )).rows).id;
      return { ws, methodId: onlyRow(method.rows).id, proof };
    }

    it('records one payment for concurrent double-fire of the same key and replays it', async () => {
      const { ws, methodId, proof } = await payableWorkspace('pb-pay-race');
      asOwner(ws);
      const app = createApp();
      const body = { payment_method_id: methodId, reference: 'GC-778899', proof_file_id: await proof() };
      const send = () => request(app).post('/api/v1/billing/payments').set('Idempotency-Key', 'pb-pay-race-1').send(body);

      const responses = await Promise.all([send(), send(), send()]);
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses.filter((status) => status === 201).length).toBeGreaterThanOrEqual(1);
      expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
      const replay = await send();
      expect(replay.status).toBe(201);
      expect(bodyOf(replay).data).toMatchObject({ payment: { status: 'pending', reference: 'GC-778899' }, access: { pending_payment: true } });
      const rows = await admin.query<{ n: number; amount: number }>(
        'SELECT count(*)::int AS n, max(amount_minor) AS amount FROM subscription_payment WHERE tenant_id = $1',
        [ws.tenantId],
      );
      // The amount is the plan price from the server, never from the request.
      expect(rows.rows[0]).toEqual({ n: 1, amount: 30000 });
    });

    it('allows one pending proof at a time and refuses a method or file it does not recognize', async () => {
      const { ws, methodId, proof } = await payableWorkspace('pb-pay-one');
      asOwner(ws);
      const app = createApp();
      const first = await request(app).post('/api/v1/billing/payments').set('Idempotency-Key', 'pb-pay-one-1')
        .send({ payment_method_id: methodId, reference: 'GC-1', proof_file_id: await proof() });
      expect(first.status).toBe(201);
      const second = await request(app).post('/api/v1/billing/payments').set('Idempotency-Key', 'pb-pay-one-2')
        .send({ payment_method_id: methodId, reference: 'GC-2', proof_file_id: await proof() });
      expect(second.status).toBe(409);
      expect(bodyOf(second).error?.code).toBe('PAYMENT_ALREADY_PENDING');

      await admin.query("UPDATE subscription_payment SET status = 'failed' WHERE tenant_id = $1", [ws.tenantId]);
      const unknownMethod = await request(app).post('/api/v1/billing/payments').set('Idempotency-Key', 'pb-pay-one-3')
        .send({ payment_method_id: randomUUID(), reference: 'GC-3', proof_file_id: await proof() });
      expect(unknownMethod.status).toBe(422);
      const foreignFile = await request(app).post('/api/v1/billing/payments').set('Idempotency-Key', 'pb-pay-one-4')
        .send({ payment_method_id: methodId, reference: 'GC-4', proof_file_id: randomUUID() });
      expect(foreignFile.status).toBe(422);
    });

    it('lets only the owner pay, and serves the QR image with its checked type', async () => {
      const { ws, methodId, proof } = await payableWorkspace('pb-pay-owner');
      clerk.getAuth.mockReturnValue({ userId: ws.frontDesk.principalId, orgId: ws.clerkOrgId });
      const app = createApp();
      const desk = await request(app).post('/api/v1/billing/payments').set('Idempotency-Key', 'pb-pay-owner-1')
        .send({ payment_method_id: methodId, reference: 'GC-1', proof_file_id: await proof() });
      expect(desk.status).toBe(403);
      asOwner(ws);
      const qr = await request(createApp()).get(`/api/v1/billing/payment-methods/${methodId}/qr`);
      expect(qr.status).toBe(200);
      expect(qr.headers['content-type']).toBe('image/png');
      expect(qr.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe("a business's own payment methods", () => {
    const methodBody = (name: string) => ({
      name,
      rail: 'manual_transfer',
      storefront_enabled: false,
      destination: { account_name: 'Luna Rentals', account_number: '001234567890', instructions: 'Send the deposit.' },
      qr_file_id: null,
      presentation: 'details',
      material_file_id: null,
    });

    it('allows five active online methods even when two adds race for the last slot', async () => {
      const ws = await createStorefrontWorkspace('pb-methods');
      asOwner(ws);
      const app = createApp();
      const online = await admin.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM payment_method WHERE tenant_id = $1 AND active AND rail <> 'cash'",
        [ws.tenantId],
      );
      for (let index = onlyRow(online.rows).n; index < 4; index += 1) {
        const added = await request(app).post('/api/v1/payment-methods').set('Idempotency-Key', `pb-methods-seed-${index}`).send(methodBody(`Bank ${index}`));
        expect(added.status).toBe(201);
      }
      const race = await Promise.all([
        request(app).post('/api/v1/payment-methods').set('Idempotency-Key', 'pb-methods-race-a').send(methodBody('Race A')),
        request(app).post('/api/v1/payment-methods').set('Idempotency-Key', 'pb-methods-race-b').send(methodBody('Race B')),
      ]);
      expect(race.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(race.map((response) => bodyOf(response).error?.code).filter(Boolean)).toEqual(['PAYMENT_METHOD_LIMIT']);
      const after = await admin.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM payment_method WHERE tenant_id = $1 AND active AND rail <> 'cash'",
        [ws.tenantId],
      );
      expect(onlyRow(after.rows).n).toBe(5);
    });

    it('creates once per key, and removing archives the method without deleting it', async () => {
      const ws = await createStorefrontWorkspace('pb-methods-archive');
      asOwner(ws);
      const app = createApp();
      const send = () => request(app).post('/api/v1/payment-methods').set('Idempotency-Key', 'pb-archive-create').send(methodBody('BDO'));
      const [first, second] = await Promise.all([send(), send()]);
      expect([first.status, second.status].filter((status) => status === 201).length).toBeGreaterThanOrEqual(1);
      const created = await admin.query<{ id: string; version: number }>(
        "SELECT id, version FROM payment_method WHERE tenant_id = $1 AND name = 'BDO'",
        [ws.tenantId],
      );
      expect(created.rows).toHaveLength(1);

      const archived = await request(app).post(`/api/v1/payment-methods/${onlyRow(created.rows).id}/archive`)
        .set('Idempotency-Key', 'pb-archive-remove').send({ version: onlyRow(created.rows).version });
      expect(archived.status).toBe(200);
      const row = await admin.query<{ active: boolean; storefront_enabled: boolean }>(
        'SELECT active, storefront_enabled FROM payment_method WHERE id = $1',
        [onlyRow(created.rows).id],
      );
      expect(row.rows[0]).toEqual({ active: false, storefront_enabled: false });
    });
  });
});
