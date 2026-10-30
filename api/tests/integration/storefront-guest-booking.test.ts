import { createHash } from 'node:crypto';

import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Guest booking against a real PostgreSQL with RLS: unverified contact emails, holds with double-fire and capacity races, checkout
 * rules, guest capability isolation, receipt submission, fitting requests, and notification prefs.
 */
import '../../src/config/load-env.js';
import {
  buildAppRoleDatabaseUrl,
  buildWorkerRoleDatabaseUrl,
  ensureAppRoleLogin,
  ensureWorkerRoleLogin,
  migrateTestDatabase,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './helpers/test-db.js';

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  getAuth: () => ({ userId: null, orgId: null }),
}));

const turnstileState = vi.hoisted<{ outcome: 'passed' | 'failed' | 'skipped' }>(() => ({ outcome: 'skipped' }));
vi.mock('../../src/integrations/turnstile/turnstile.js', () => ({
  turnstileVerifier: { verify: vi.fn(() => Promise.resolve(turnstileState.outcome)) },
}));

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const PNG_SHA = createHash('sha256').update(PNG).digest('base64');

describe('storefront guest booking', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool } = await import('../../src/db/client.js');
  const { storefrontCmsService: cms } = await import('../../src/modules/storefront-cms/storefront-cms.service.js');
  const { settingsService } = await import('../../src/modules/settings/settings.service.js');
  const { GuestBookingService } = await import('../../src/modules/guest-booking/guest-booking.service.js');
  const { guestTokenFor } = await import('../../src/shared/guest-token.js');
  const { verifyFileMediaGrant } = await import('../../src/modules/files/media-access-grants.js');
  const { serializeGuestAccessCookie } = await import('../../src/modules/guest-booking/guest-access-cookie.js');
  const { openSealedEmail } = await import('../../src/modules/notifications/email-notifications.js');
  const { addDays, localDate } = await import('../../src/modules/storefront/storefront.service.js');
  const { weekdayOf } = await import('../../src/modules/storefront/shop-closures.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
  const { cancelReservation, completeStaffReservation, getReservationDetail, getReservationPaymentReceipts } = await import('../../src/modules/reservations/reservations.service.js');
  const { prepareFileObjectCleanup } = await import('../../src/modules/files/file-object-cleanup.repository.js');
  const { defaultStorefrontDocument, guestFittingRequest, guestReservationRequest } = await import('@drezivo/contracts');
  const admin = new pg.Pool({ connectionString: adminUrl, max: 3 });
  const worker = new pg.Pool({ connectionString: buildWorkerRoleDatabaseUrl(adminUrl), max: 2 });

  const uploads = new Map<string, { contentType: string; byteSize: number; sha256: string }>();
  const storage = {
    authorizeUpload: (input: { storageKey: string; contentType: string; expiresInSeconds: number }) => {
      uploads.set(input.storageKey, { contentType: input.contentType, byteSize: PNG.length, sha256: PNG_SHA });
      return Promise.resolve({
        uploadUrl: `https://uploads.test/${input.storageKey}`,
        requiredHeaders: { 'Content-Type': input.contentType, 'If-None-Match': '*' },
        expiresAt: new Date(Date.now() + 600_000),
      });
    },
    authorizeRead: (input: { storageKey: string }) => Promise.resolve({ readUrl: `https://files.test/${input.storageKey}`, expiresAt: new Date(Date.now() + 3_600_000) }),
    readObject: () => Promise.resolve(null),
    inspectUploadedObject: (key: string) => {
      const found = uploads.get(key);
      return Promise.resolve(found ? { ...found, versionId: null, prefix: PNG } : null);
    },
  };
  const booking = new GuestBookingService(storage);
  const pngSha = createHash('sha256').update(PNG).digest('base64');

  const policy = {
    format: 'text' as const,
    image_file_ids: [],
    rental: 'Three-day rentals.',
    deposit: 'Refundable deposit.',
    cancellation: 'Cancel 48 hours ahead.',
    damage: null,
    delivery: { enabled: true, fee_minor: '15000', notes: null },
    privacy_notice: 'Used only for this rental.',
  };

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await ensureWorkerRoleLogin(adminUrl);
  });
  afterEach(async () => {
    turnstileState.outcome = 'skipped';
    uploads.clear();
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await admin.end();
    await worker.end();
    await closePool();
  });

  async function liveStore(
    label: string,
    tweak: (doc: ReturnType<typeof defaultStorefrontDocument>) => void = () => undefined,
    rules: typeof policy = policy,
  ) {
    const ws = await createStorefrontWorkspace(label);
    const document = defaultStorefrontDocument('Luna Gown Rentals');
    document.contact.email = 'hello@luna.test';
    document.checkout.requirements.phone = 'optional';
    tweak(document);
    await cms.updateDocument(ws.owner, `${label}-doc`, { version: 1, document });
    await cms.publishPolicy(ws.owner, `${label}-pol`, { expected_version: 1, rules });
    const published = await cms.publish(ws.owner, `${label}-pub`, 2);
    expect(published.status).toBe(200);
    // New branches close on Sundays; the rolling test dates must not depend on today's weekday.
    await setClosedWeekdays(ws, []);
    return ws;
  }

  async function setClosedWeekdays(ws: { tenantId: string; branchId: string }, weekdays: string[]) {
    await admin.query(
      `UPDATE branch
          SET operating_hours = jsonb_set(operating_hours, '{closed_weekdays}', $3::jsonb)
        WHERE tenant_id = $1 AND id = $2`,
      [ws.tenantId, ws.branchId, JSON.stringify(weekdays)],
    );
  }

  /** Pickup 3 days from now at the store's default handover time, for `days` days. */
  function interval(days: number, offset = 3): { start: string; end: string } {
    const pickup = addDays(localDate(new Date(), 'Asia/Manila'), offset);
    return { start: `${pickup}T10:00:00+08:00`, end: `${addDays(pickup, days)}T10:00:00+08:00` };
  }

  function holdRequest(ws: { variantIds: { m: string }; paymentMethodId: string }, email: string, overrides: Record<string, unknown> = {}) {
    return guestReservationRequest.parse({
      email,
      customer: { full_name: 'Ana Reyes', phone: '09171234567', address: '12 Mabini St, Quezon City', social_handle: null },
      variant_id: ws.variantIds.m,
      requested_interval: interval(3),
      event_date: null,
      fulfillment_method: 'pickup' as const,
      payment_method_id: ws.paymentMethodId,
      ...overrides,
    });
  }

  it('creates one hold per key without email verification, returns no capability, and isolates cookie access', async () => {
    const ws = await liveStore('gv-hold');
    const body = holdRequest(ws, 'ana@example.test');

    const first = await booking.createReservation(ws.slug, { requestId: 'r1', idempotencyKey: 'hold-0001' }, body);
    expect(first.status).toBe(201);
    if (!first.body.success) throw new Error('expected success');
    const created = first.body.data;
    expect(created.reservation).toMatchObject({ status: 'held', item_name: 'Emerald Gown', size_label: 'M', receipt_submitted: false });
    // interval(3) spans four rental dates (the pickup date is Day 1), so one extra day is charged.
    expect(created.reservation.money).toEqual({ rental_total_minor: '230000', security_required_minor: '200000', delivery_total_minor: '0', due_now_minor: '430000' });
    expect(created.reservation.payment_instructions?.destination_note).toContain('Account number: 001234567890');
    expect(created).not.toHaveProperty('guest_token');
    expect(Date.parse(created.access_expires_at)).toBeGreaterThan(Date.now());
    const token = guestTokenFor(created.reservation.id);

    const replay = await booking.createReservation(ws.slug, { requestId: 'r2', idempotencyKey: 'hold-0001' }, body);
    expect(replay).toEqual({ ...first, body: { ...first.body, request_id: 'r1' } });
    const stored = await admin.query<Record<string, unknown>>('SELECT safe_response::text AS body FROM idempotency_record WHERE tenant_id = $1', [ws.tenantId]);
    expect(stored.rows.map((row) => String(row['body'])).join('')).not.toContain(token);
    const holds = await admin.query<Record<string, unknown>>(`SELECT count(*)::int AS n FROM reservation WHERE tenant_id = $1`, [ws.tenantId]);
    expect(holds.rows[0]?.['n']).toBe(1);

    const app = createApp();
    const createdByApi = await request(app)
      .post(`/api/v1/public/stores/${ws.slug}/holds`)
      .set('Idempotency-Key', 'hold-0001')
      .send(body);
    expect(createdByApi.status).toBe(201);
    expect(createdByApi.text).not.toContain('guest_token');
    const cookie = createdByApi.headers['set-cookie']?.[0];
    expect(cookie).toBeDefined();
    if (!cookie) throw new Error('expected a reservation access cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toMatch(/(?:^|;\s*)Domain=/i);
    expect(cookie).toContain(`Path=/api/v1/guest/reservations/${created.reservation.id}`);
    const cookiePair = cookie.split(';', 1)[0];
    if (!cookiePair) throw new Error('expected a cookie name and value');
    const view = await request(app).get(`/api/v1/guest/reservations/${created.reservation.id}`).set('Cookie', cookiePair);
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect((await request(app).get(`/api/v1/guest/reservations/${created.reservation.id}`)).status).toBe(404);
    const other = await request(app).get(`/api/v1/guest/reservations/${created.reservation.id}`).set('Authorization', `Bearer ${token}`);
    expect(other.status).toBe(404);

    const audit = await admin.query<Record<string, unknown>>(`SELECT actor_kind FROM audit_event WHERE tenant_id = $1 AND action = 'reservation.created'`, [ws.tenantId]);
    expect(audit.rows).toEqual([{ actor_kind: 'guest' }]);
  });

  it('snapshots shared renter text on a new hold and keeps it after the setting changes', async () => {
    const ws = await liveStore('gv-shared-renter-text');
    await admin.query(
      `INSERT INTO tenant_settings (tenant_id, renter_steps_text, renter_steps_version)
       VALUES ($1, $2, 2)
       ON CONFLICT (tenant_id) DO UPDATE
         SET renter_steps_text = EXCLUDED.renter_steps_text,
             renter_steps_file_id = NULL,
             renter_steps_version = EXCLUDED.renter_steps_version`,
      [ws.tenantId, 'Pay the listed amount, then send your receipt.'],
    );

    const created = await booking.createReservation(
      ws.slug,
      { requestId: 'shared-renter-text', idempotencyKey: 'shared-renter-text-1' },
      holdRequest(ws, 'ana@example.test'),
    );
    if (!created.body.success) throw new Error('hold failed');
    const reservation = created.body.data.reservation;
    expect(reservation.payment_instructions?.renter_steps).toEqual({
      text: 'Pay the listed amount, then send your receipt.',
    });

    await admin.query(
      `UPDATE tenant_settings
          SET renter_steps_text = 'New steps for future renters.', renter_steps_version = renter_steps_version + 1
        WHERE tenant_id = $1`,
      [ws.tenantId],
    );
    const reread = await booking.getReservation(reservation.id, guestTokenFor(reservation.id));
    expect(reread.payment_instructions?.renter_steps).toEqual({
      text: 'Pay the listed amount, then send your receipt.',
    });
  });

  it('returns a reservation-scoped API image URL and retains its file snapshot for cleanup', async () => {
    const ws = await liveStore('gv-shared-renter-image');
    const inserted = await admin.query<{ id: string }>(
      `INSERT INTO file_object
         (tenant_id, purpose, storage_key, version_id, mime_type, byte_size, lifecycle_status,
          is_private, upload_expires_at, frozen_at)
       VALUES ($1, 'payment_method_material', $2, 'shared-renter-steps-v1', 'image/png', 512,
               'accepted', true, now(), now())
       RETURNING id`,
      [ws.tenantId, `tenant-files/${ws.tenantId}/shared-renter-steps/source`],
    );
    const fileId = inserted.rows[0]?.id;
    if (!fileId) throw new Error('expected accepted shared renter image');
    await admin.query(
      `INSERT INTO tenant_settings (tenant_id, renter_steps_file_id, renter_steps_version)
       VALUES ($1, $2, 2)
       ON CONFLICT (tenant_id) DO UPDATE
         SET renter_steps_text = NULL,
             renter_steps_file_id = EXCLUDED.renter_steps_file_id,
             renter_steps_version = EXCLUDED.renter_steps_version`,
      [ws.tenantId, fileId],
    );

    const created = await booking.createReservation(
      ws.slug,
      { requestId: 'shared-renter-image', idempotencyKey: 'shared-renter-image-1' },
      holdRequest(ws, 'ana@example.test'),
    );
    if (!created.body.success) throw new Error('hold failed');
    const accessExpiresAt = (created.body as { data: { access_expires_at: string } }).data.access_expires_at;
    const reservation = created.body.data.reservation;
    expect(reservation.payment_instructions?.renter_steps).toMatchObject({
      text: null,
      image_content_type: 'image/png',
    });
    expect(reservation.payment_instructions?.renter_steps?.image_url).toBe(
      `https://files.test/api/v1/guest/reservations/${reservation.id}/media/${fileId}`,
    );

    const cookie = serializeGuestAccessCookie(
      reservation.id,
      guestTokenFor(reservation.id),
      new Date(accessExpiresAt),
    ).split(';', 1)[0];
    if (!cookie) throw new Error('expected the scoped guest access cookie');
    const app = createApp();
    const grantResponse = await request(app)
      .post(`/api/v1/guest/reservations/${reservation.id}/media/${fileId}/grant`)
      .set('Cookie', cookie);
    expect(grantResponse.status).toBe(200);
    expect(grantResponse.headers['cache-control']).toBe('no-store');
    const grantResponseBody = grantResponse.body as { data: { media_grant: string; expires_at: string } };
    const grant = grantResponseBody.data;
    expect(verifyFileMediaGrant(grant.media_grant, {
      purpose: 'guest',
      resourceId: reservation.id,
      fileId,
    })).toMatchObject({ tenantId: ws.tenantId, resourceId: reservation.id, fileId, purpose: 'guest' });
    expect(Date.parse(grant.expires_at)).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    expect((await request(app)
      .post(`/api/v1/guest/reservations/${reservation.id}/media/00000000-0000-4000-8000-000000000001/grant`)
      .set('Cookie', cookie)).status).toBe(404);

    await admin.query(
      `UPDATE tenant_settings
          SET renter_steps_file_id = NULL, renter_steps_version = renter_steps_version + 1
        WHERE tenant_id = $1`,
      [ws.tenantId],
    );
    const cancelled = await cancelReservation(
      { ...ws.owner, requestId: 'cancel-shared-image', idempotencyKey: 'cancel-shared-image-1' },
      reservation.id,
      { version: 1 },
    );
    expect(cancelled.body).toMatchObject({ success: true, data: { reservation: { status: 'cancelled' } } });
    const afterCancel = await booking.getReservation(reservation.id, guestTokenFor(reservation.id));
    expect(afterCancel.payment_instructions).toBeNull();
    const snapshot = await admin.query<{ file_id: string | null }>(
      'SELECT renter_steps_file_id_snapshot AS file_id FROM reservation WHERE tenant_id = $1 AND id = $2',
      [ws.tenantId, reservation.id],
    );
    expect(snapshot.rows[0]?.file_id).toBe(fileId);

    await expect(withWorkerTransaction(ws.tenantId, (client) =>
      prepareFileObjectCleanup(client, ws.tenantId, fileId),
    )).rejects.toMatchObject({ name: 'DeferredOutboxError' });
  });

  it('rejects guest reservation submissions when Turnstile fails before writing customer or hold data', async () => {
    const ws = await liveStore('gv-turnstile');
    turnstileState.outcome = 'failed';
    const response = await request(createApp())
      .post(`/api/v1/public/stores/${ws.slug}/holds`)
      .set('Idempotency-Key', 'turnstile-failed')
      .send(holdRequest(ws, 'ana@example.test', { turnstile_token: 'synthetic-challenge' }));
    expect(response.status).toBe(403);
    const counts = await admin.query<{ customers: number; holds: number }>(
      `SELECT (SELECT count(*)::int FROM customer WHERE tenant_id = $1) AS customers,
              (SELECT count(*)::int FROM reservation WHERE tenant_id = $1) AS holds`,
      [ws.tenantId],
    );
    expect(counts.rows[0]).toEqual({ customers: 0, holds: 0 });
  });

  it('does not let staff complete an online booking that is still waiting for the renter to pay', async () => {
    const ws = await liveStore('gv-held-online');
    const created = await booking.createReservation(ws.slug, { requestId: 'held-online', idempotencyKey: 'held-online-1' }, holdRequest(ws, 'ana@example.test'));
    if (!created.body.success) throw new Error('hold failed');
    const { reservation } = created.body.data;
    const detail = await getReservationDetail(ws.owner, reservation.id);
    expect(detail.booking_channel).toBe('online');

    await expect(
      completeStaffReservation(
        { ...ws.owner, idempotencyKey: 'held-online-complete' },
        reservation.id,
        { version: detail.version, terms_accepted: true },
      ),
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_RESERVATION_TRANSITION' });
    expect((await getReservationDetail(ws.owner, reservation.id)).status).toBe('held');
  });

  it('lets only one of two guests win the last garment for overlapping dates', async () => {
    const ws = await liveStore('gv-race');
    const results = await Promise.all([
      booking.createReservation(ws.slug, { requestId: 'ra', idempotencyKey: 'race-a' }, holdRequest(ws, 'a@example.test')),
      booking.createReservation(ws.slug, { requestId: 'rb', idempotencyKey: 'race-b' }, holdRequest(ws, 'b@example.test', { requested_interval: interval(2, 4) })),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it('keeps the storefront browsable but refuses online reservations when the owner takes them by message', async () => {
    const ws = await liveStore('gv-by-message', (doc) => {
      doc.checkout.reservation_requests = false;
      doc.checkout.fitting_requests = true;
    });
    await admin.query<Record<string, unknown>>(`INSERT INTO fitting_settings (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency) VALUES ($1, $2, true, 1, 60, 0, 'PHP')`, [ws.tenantId, ws.branchId]);

    const store = await request(createApp()).get(`/api/v1/public/stores/${ws.slug}`);
    expect(store.status).toBe(200);
    expect((store.body as { data: unknown }).data).toMatchObject({ booking_open: true, reservations_open: false, fitting: { enabled: true } });

    const refused = await booking.createReservation(ws.slug, { requestId: 'msg-1', idempotencyKey: 'by-message-1' }, holdRequest(ws, 'ana@example.test'));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ success: false, error: { code: 'BOOKING_PAUSED' } });
    const written = await admin.query<{ reservations: number; customers: number }>(
      'SELECT (SELECT count(*)::int FROM reservation WHERE tenant_id = $1) AS reservations, (SELECT count(*)::int FROM customer WHERE tenant_id = $1) AS customers',
      [ws.tenantId],
    );
    expect(written.rows[0]).toEqual({ reservations: 0, customers: 0 });

    // Turning reservations back on reopens booking for a new request.
    const settings = await cms.get(ws.owner);
    const saved = await cms.updateDocument(ws.owner, 'by-message-reopen', {
      version: settings.version,
      document: { ...settings.document, checkout: { ...settings.document.checkout, reservation_requests: true } },
    });
    expect(saved.status).toBe(200);
    const reopened = await request(createApp()).get(`/api/v1/public/stores/${ws.slug}`);
    expect((reopened.body as { data: { reservations_open: boolean } }).data.reservations_open).toBe(true);
    expect((await booking.createReservation(ws.slug, { requestId: 'msg-2', idempotencyKey: 'by-message-2' }, holdRequest(ws, 'ana@example.test'))).status).toBe(201);
  });

  it('enforces the shop checkout rules and online-only payment on the server', async () => {
    const ws = await liveStore('gv-rules', (doc) => {
      doc.checkout.requirements.social_handle = 'hidden';
      doc.checkout.max_rental_days = 3;
    });
    const attempt = (key: string, overrides: Record<string, unknown>) =>
      booking.createReservation(ws.slug, { requestId: key, idempotencyKey: key }, holdRequest(ws, 'ana@example.test', overrides));

    expect((await attempt('rule-social', { customer: { full_name: 'Ana Reyes', phone: null, address: '12 Mabini St', social_handle: '@ana' } })).status).toBe(422);
    expect((await attempt('rule-time-closed', { requested_interval: { start: interval(2).start.replace('T10:00', 'T20:00'), end: interval(2).end.replace('T10:00', 'T20:00') } })).status).toBe(422);
    expect((await attempt('rule-time-minute', { requested_interval: { start: interval(2).start.replace('T10:00', 'T15:15'), end: interval(2).end.replace('T10:00', 'T15:15') } })).status).toBe(422);
    expect((await attempt('rule-long', { requested_interval: interval(5) })).status).toBe(422);
    expect((await attempt('rule-notice', { requested_interval: interval(2, 0) })).status).toBe(422);

    const cash = await admin.query<Record<string, unknown>>(`INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot, active, storefront_enabled) VALUES ($1, 'Cash', 'cash', '{}', true, false) RETURNING id`, [ws.tenantId]);
    expect((await attempt('rule-cash', { payment_method_id: cash.rows[0]?.['id'] })).status).toBe(422);
    expect(guestReservationRequest.safeParse({ ...holdRequest(ws, 'ana@example.test'), verification_token: 'x'.repeat(43) }).success).toBe(false);
  });

  it('accepts a pickup time during shop hours and keeps the same time for return', async () => {
    const ws = await liveStore('gv-pickup-time');
    const selected = interval(2);
    const result = await booking.createReservation(
      ws.slug,
      { requestId: 'pickup-time', idempotencyKey: 'pickup-time' },
      holdRequest(ws, 'ana@example.test', {
        requested_interval: {
          start: selected.start.replace('T10:00', 'T15:30'),
          end: selected.end.replace('T10:00', 'T15:30'),
        },
      }),
    );
    expect(result.status).toBe(201);
    if (!result.body.success) throw new Error('hold failed');
    expect(result.body.data.reservation.pickup_at).toBe(new Date(selected.start.replace('T10:00', 'T15:30')).toISOString());
    expect(result.body.data.reservation.due_at).toBe(new Date(selected.end.replace('T10:00', 'T15:30')).toISOString());
  });

  describe('business hours', () => {
    const pickupDate = () => addDays(localDate(new Date(), 'Asia/Manila'), 3);
    const capitalized = (weekday: string) => `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`;

    async function attempt(label: string, closedWeekdays: string[], days = 3) {
      const ws = await liveStore(label);
      await setClosedWeekdays(ws, closedWeekdays);
      const result = await booking.createReservation(ws.slug, { requestId: label, idempotencyKey: label }, holdRequest(ws, 'ana@example.test', { requested_interval: interval(days) }));
      const holds = await admin.query<Record<string, unknown>>('SELECT count(*)::int AS n FROM reservation WHERE tenant_id = $1', [ws.tenantId]);
      return { ws, result, holds: holds.rows[0]?.['n'] };
    }

    it('refuses a pickup on a closed weekday and creates nothing', async () => {
      const weekday = weekdayOf(pickupDate());
      const { result, holds } = await attempt('bh-pickup', [weekday]);
      expect(result.status).toBe(422);
      expect(!result.body.success && result.body.error.message).toBe(`The shop is closed on ${capitalized(weekday)}s. Choose another pickup date.`);
      expect(holds).toBe(0);
    });

    it('refuses a return on a closed weekday and creates nothing', async () => {
      const weekday = weekdayOf(addDays(pickupDate(), 3));
      const { result, holds } = await attempt('bh-return', [weekday]);
      expect(result.status).toBe(422);
      expect(!result.body.success && result.body.error.message).toBe(`The shop is closed on ${capitalized(weekday)}s. Choose another return date.`);
      expect(holds).toBe(0);
    });

    it('refuses pickup or return on a special closure date, without revealing its reason', async () => {
      const ws = await liveStore('bh-special');
      await admin.query(`INSERT INTO branch_closure (tenant_id, branch_id, local_date, reason) VALUES ($1, $2, $3, 'Owner funeral')`, [ws.tenantId, ws.branchId, addDays(pickupDate(), 3)]);
      const result = await booking.createReservation(ws.slug, { requestId: 'bh-special', idempotencyKey: 'bh-special' }, holdRequest(ws, 'ana@example.test'));
      expect(result.status).toBe(422);
      const message = !result.body.success ? result.body.error.message : '';
      expect(message).toContain('Choose another return date.');
      expect(message).not.toContain('funeral');
    });

    it('accepts open pickup and return days, even when a closed day falls in between', async () => {
      const middle = weekdayOf(addDays(pickupDate(), 1));
      const { result, holds } = await attempt('bh-open', [middle]);
      expect(result.status).toBe(201);
      expect(holds).toBe(1);
    });

    it('accepts any day when the shop has no closed weekdays', async () => {
      const { result } = await attempt('bh-none', []);
      expect(result.status).toBe(201);
    });
  });

  it('never lets a storefront renter book a pickup in the past', async () => {
    const ws = await liveStore('gv-past', (doc) => {
      doc.checkout.min_notice_days = 0;
    });
    const result = await booking.createReservation(ws.slug, { requestId: 'past', idempotencyKey: 'guest-past-1' }, holdRequest(ws, 'ana@example.test', { requested_interval: interval(2, -3) }));
    expect(result.status).toBe(422);
    const holds = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM reservation WHERE tenant_id = $1', [ws.tenantId]);
    expect(holds.rows[0]?.n).toBe(0);
  });

  it('rejects delivery requests when the shop has not enabled delivery', async () => {
    const ws = await liveStore('gv-deliver-disabled', undefined, { ...policy, delivery: { enabled: false, fee_minor: '0', notes: null } });
    const created = await booking.createReservation(ws.slug, { requestId: 'd-disabled', idempotencyKey: 'deliver-disabled' }, holdRequest(ws, 'ana@example.test', { fulfillment_method: 'delivery' }));
    expect(created.status).toBe(422);
    expect(created.body).toMatchObject({ success: false, error: { message: 'This shop does not offer delivery.' } });
    const holds = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM reservation WHERE tenant_id = $1', [ws.tenantId]);
    expect(holds.rows[0]?.n).toBe(0);
  });

  it('lets a renter request enabled delivery while leaving its location-dependent fee unset and uncharged', async () => {
    const ws = await liveStore('gv-deliver');
    const business = await settingsService.getBusiness(ws.owner);
    await settingsService.updateBusiness(ws.owner, 'biz', { version: business.version, business_name: 'Luna Gown Rentals', business_email: 'owner@luna.test', business_phone: null, business_address: null });

    const created = await booking.createReservation(ws.slug, { requestId: 'd1', idempotencyKey: 'deliver-hold' }, holdRequest(ws, 'ana@example.test', { fulfillment_method: 'delivery' }));
    expect(created.status).toBe(201);
    if (!created.body.success) throw new Error('hold failed');
    const { reservation } = created.body.data;
    expect(reservation.money).toMatchObject({ delivery_total_minor: '0', due_now_minor: '430000' });

    const capability = guestTokenFor(reservation.id);
    const upload = await booking.authorizeReceiptUpload(reservation.id, capability, { content_type: 'image/png', byte_size: PNG.length, sha256: pngSha });
    const submitted = await booking.submitReceipt(reservation.id, capability, { requestId: 'd2', idempotencyKey: 'deliver-receipt' }, upload.file_id);
    expect(submitted.status).toBe(200);

    const detail = await getReservationDetail(ws.owner, reservation.id);
    expect(detail.delivery_snapshot).toEqual({ fulfillment_method: 'delivery', terms: 'to_arrange' });

    const emails = await admin.query<Record<string, unknown>>(`SELECT payload FROM outbox_event WHERE tenant_id = $1 AND dedupe_key LIKE 'reservation-email:%:new_request:business'`, [ws.tenantId]);
    expect(emails.rows).toHaveLength(1);
    const email = openSealedEmail(emails.rows[0]?.['payload'] as Record<string, unknown>);
    expect(email.subject).toBe(`New rental request ${reservation.reference_code} · Delivery requested`);
    expect(email.text).toContain('The renter asked for delivery. Contact them from the reservation in Drezivo to arrange it');
    expect(email.text).toContain('Handover: Delivery');
    // Renter contact details stay in the app, never in the owner email.
    expect(email.text).not.toContain('09171234567');
    expect(email.text).not.toContain('Mabini');
  });

  it('moves the hold to review with a receipt but emails only the business, not the guest', async () => {
    const ws = await liveStore('gv-receipt');
    const business = await settingsService.getBusiness(ws.owner);
    await settingsService.updateBusiness(ws.owner, 'biz', { version: business.version, business_name: 'Luna Gown Rentals', business_email: 'owner@luna.test', business_phone: null, business_address: null });
    const created = await booking.createReservation(ws.slug, { requestId: 'h', idempotencyKey: 'hold' }, holdRequest(ws, 'ana@example.test'));
    if (!created.body.success) throw new Error('hold failed');
    const { reservation } = created.body.data;
    const capability = guestTokenFor(reservation.id);
    const noEmailsBeforeReceipt = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM outbox_event WHERE tenant_id = $1 AND event_type = 'notification.email'`, [ws.tenantId]);
    expect(noEmailsBeforeReceipt.rows[0]?.n).toBe(0);

    const upload = await booking.authorizeReceiptUpload(reservation.id, capability, { content_type: 'image/png', byte_size: PNG.length, sha256: pngSha });
    const newReceiptKey = `tenant-files/${ws.tenantId}/payment-receipts/${reservation.id}/${upload.file_id}/source`;
    expect(upload.upload_url).toContain(newReceiptKey);
    expect(uploads.has(newReceiptKey)).toBe(true);

    const submitted = await booking.submitReceipt(reservation.id, capability, { requestId: 's', idempotencyKey: 'receipt-1' }, upload.file_id);
    expect(submitted.status).toBe(200);
    expect(submitted.body.success && submitted.body.data).toMatchObject({ status: 'pending_confirmation', receipt_submitted: true, hold_expires_at: null });

    const again = await booking.submitReceipt(reservation.id, capability, { requestId: 's2', idempotencyKey: 'receipt-2' }, upload.file_id);
    expect(again.status).toBe(409);

    // The owner sees an online booking and can open the renter's receipt before verifying it.
    const verifier = { ...ws.owner, permissionCodes: [...ws.owner.permissionCodes, 'evidence.verify' as const] };
    expect((await getReservationDetail(verifier, reservation.id)).booking_channel).toBe('online');
    const proof = await getReservationPaymentReceipts(verifier, reservation.id, storage);
    expect(proof.receipts).toEqual([
      expect.objectContaining({
        file_id: upload.file_id,
        content_type: 'image/png',
        url: `http://localhost:3000/api/v1/files/media/staff/${upload.file_id}?branch_id=${ws.branchId}&w=960`,
        evidence_status: 'under_review',
      }),
    ]);
    // Receipts are private evidence: staff without verification permission cannot read them.
    await expect(getReservationPaymentReceipts(ws.owner, reservation.id, storage)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const emails = await admin.query<Record<string, unknown>>(`SELECT dedupe_key, payload FROM outbox_event WHERE tenant_id = $1 AND event_type = 'notification.email' AND dedupe_key LIKE 'reservation-email:%' ORDER BY dedupe_key`, [ws.tenantId]);
    const opened = emails.rows.map((row) => ({ key: String(row['dedupe_key']), ...openSealedEmail(row['payload'] as Record<string, unknown>) }));
    expect(opened.map((email) => [email.key.split(':').slice(2).join(':'), email.to])).toEqual([
      ['new_request:business', 'owner@luna.test'],
    ]);
    const plaintext = await admin.query<Record<string, unknown>>(`SELECT payload::text AS p FROM outbox_event WHERE tenant_id = $1`, [ws.tenantId]);
    expect(plaintext.rows.map((row) => String(row['p'])).join('')).not.toContain('ana@example.test');

    // A receipt uploaded for a different booking can never be attached to this one.
    const second = await booking.createReservation(ws.slug, { requestId: 'h2', idempotencyKey: 'hold-2' }, holdRequest(ws, 'ben@example.test', { variant_id: ws.variantIds.l }));
    if (!second.body.success) throw new Error('second hold failed');
    const secondCapability = guestTokenFor(second.body.data.reservation.id);
    const foreign = booking.submitReceipt(second.body.data.reservation.id, secondCapability, { requestId: 'x', idempotencyKey: 'receipt-x' }, upload.file_id);
    await expect(foreign).rejects.toMatchObject({ status: 422 });

    const legacyUpload = await booking.authorizeReceiptUpload(
      second.body.data.reservation.id,
      secondCapability,
      { content_type: 'image/png', byte_size: PNG.length, sha256: pngSha },
    );
    const legacyReceiptKey = `tenant-files/${ws.tenantId}/guest-receipts/${second.body.data.reservation.id}/${legacyUpload.file_id}`;
    const currentReceiptKey = `tenant-files/${ws.tenantId}/payment-receipts/${second.body.data.reservation.id}/${legacyUpload.file_id}/source`;
    const uploadedBytes = uploads.get(currentReceiptKey);
    if (!uploadedBytes) throw new Error('Expected the new guest receipt object to exist.');
    uploads.set(legacyReceiptKey, uploadedBytes);
    const rekeyed = await admin.query(
      `UPDATE file_object
          SET storage_key = $1
        WHERE tenant_id = $2 AND id = $3 AND purpose = 'payment_receipt'`,
      [legacyReceiptKey, ws.tenantId, legacyUpload.file_id],
    );
    expect(rekeyed.rowCount).toBe(1);

    const legacySubmission = await booking.submitReceipt(
      second.body.data.reservation.id,
      secondCapability,
      { requestId: 'legacy-submit', idempotencyKey: 'legacy-receipt-submit' },
      legacyUpload.file_id,
    );
    expect(legacySubmission.status).toBe(200);
  });

  it('accepts fitting requests without email verification and sends only the owner notification', async () => {
    const ws = await liveStore('gv-fit', (doc) => {
      doc.checkout.fitting_requests = true;
    });
    const date = addDays(localDate(new Date(), 'Asia/Manila'), 3);
    await admin.query<Record<string, unknown>>(`INSERT INTO fitting_settings (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency) VALUES ($1, $2, true, 1, 60, 0, 'PHP')`, [ws.tenantId, ws.branchId]);
    await admin.query<Record<string, unknown>>(
      `UPDATE branch
          SET operating_hours = '{"opens_local":"10:00","closes_local":"12:00","closed_weekdays":[]}'::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [ws.tenantId, ws.branchId],
    );

    const fittingRequest = (email: string) => guestFittingRequest.parse({
      email,
      customer: { full_name: 'Ana Reyes', phone: '09171234567', address: null, social_handle: null },
      start_at: `${date}T10:00:00+08:00`,
      variant_ids: [ws.variantIds.m],
      note: 'Need it for a debut.',
    });
    const results = await Promise.all([
      booking.requestFitting(ws.slug, { requestId: 'fa', idempotencyKey: 'fit-a' }, fittingRequest('a@example.test')),
      booking.requestFitting(ws.slug, { requestId: 'fb', idempotencyKey: 'fit-b' }, fittingRequest('b@example.test')),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const rows = await admin.query<Record<string, unknown>>(`SELECT booking_channel, status, internal_note FROM fitting_appointment WHERE tenant_id = $1`, [ws.tenantId]);
    expect(rows.rows).toEqual([{ booking_channel: 'storefront', status: 'pending', internal_note: 'Customer note: Need it for a debut.' }]);
    const lines = await admin.query<Record<string, unknown>>(`SELECT garment_guaranteed FROM fitting_line WHERE tenant_id = $1`, [ws.tenantId]);
    expect(lines.rows).toEqual([{ garment_guaranteed: false }]);
    const guestMail = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM outbox_event WHERE tenant_id = $1 AND event_type = 'notification.email' AND dedupe_key LIKE '%:customer'`, [ws.tenantId]);
    expect(guestMail.rows[0]?.n).toBe(0);
    const ownerMail = await admin.query<{ dedupe_key: string }>(`SELECT dedupe_key FROM outbox_event WHERE tenant_id = $1 AND event_type = 'notification.email'`, [ws.tenantId]);
    expect(ownerMail.rows).toHaveLength(1);
    expect(ownerMail.rows[0]?.dedupe_key).toMatch(/^fitting-email:.+:business$/);
  });

  it('rejects fitting submissions when Turnstile fails before writing customer or appointment data', async () => {
    const ws = await liveStore('gv-fit-turnstile', (doc) => {
      doc.checkout.fitting_requests = true;
    });
    turnstileState.outcome = 'failed';
    const date = addDays(localDate(new Date(), 'Asia/Manila'), 3);
    await admin.query(
      `INSERT INTO fitting_settings (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency)
       VALUES ($1, $2, true, 1, 60, 0, 'PHP')`,
      [ws.tenantId, ws.branchId],
    );
    await admin.query(
      `UPDATE branch
          SET operating_hours = '{"opens_local":"10:00","closes_local":"12:00","closed_weekdays":[]}'::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [ws.tenantId, ws.branchId],
    );
    const response = await request(createApp())
      .post(`/api/v1/public/stores/${ws.slug}/fittings`)
      .set('Idempotency-Key', 'fit-turnstile-failed')
      .send(guestFittingRequest.parse({
        email: 'blocked-fitting@example.test',
        customer: { full_name: 'Ana Reyes', phone: '09171234567', address: null, social_handle: null },
        start_at: `${date}T10:00:00+08:00`,
        variant_ids: [ws.variantIds.m],
        note: null,
        turnstile_token: 'synthetic-challenge',
      }));

    expect(response.status).toBe(403);
    const counts = await admin.query<{ customers: number; appointments: number; lines: number }>(
      `SELECT (SELECT count(*)::int FROM customer WHERE tenant_id = $1) AS customers,
              (SELECT count(*)::int FROM fitting_appointment WHERE tenant_id = $1) AS appointments,
              (SELECT count(*)::int FROM fitting_line WHERE tenant_id = $1) AS lines`,
      [ws.tenantId],
    );
    expect(counts.rows[0]).toEqual({ customers: 0, appointments: 0, lines: 0 });
  });

  it('creates fitting lines for multiple publicly visible variants in one request', async () => {
    const ws = await liveStore('gv-fit-multi', (doc) => {
      doc.checkout.fitting_requests = true;
    });
    const date = addDays(localDate(new Date(), 'Asia/Manila'), 3);
    await admin.query(
      `INSERT INTO fitting_settings (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency)
       VALUES ($1, $2, true, 1, 60, 0, 'PHP')`,
      [ws.tenantId, ws.branchId],
    );
    await admin.query(
      `UPDATE branch
          SET operating_hours = '{"opens_local":"10:00","closes_local":"12:00","closed_weekdays":[]}'::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [ws.tenantId, ws.branchId],
    );
    const email = 'multi-fitting@example.test';
    const body = guestFittingRequest.parse({
      email,
      customer: { full_name: 'Ana Reyes', phone: '09171234567', address: null, social_handle: null },
      start_at: `${date}T10:00:00+08:00`,
      variant_ids: [ws.variantIds.m, ws.variantIds.l],
      note: null,
    });

    const result = await booking.requestFitting(ws.slug, { requestId: 'fmulti', idempotencyKey: 'fit-multi' }, body);

    expect(result.status).toBe(201);
    expect(result.body.success).toBe(true);
    const fittings = await admin.query<{ id: string }>(`SELECT id FROM fitting_appointment WHERE tenant_id = $1`, [ws.tenantId]);
    expect(fittings.rows).toHaveLength(1);
    const lines = await admin.query<{ variant_id: string; garment_guaranteed: boolean }>(
      `SELECT variant_id, garment_guaranteed FROM fitting_line WHERE tenant_id = $1 AND fitting_id = $2 ORDER BY variant_id`,
      [ws.tenantId, fittings.rows[0]?.id],
    );
    expect(lines.rows).toEqual(
      [ws.variantIds.l, ws.variantIds.m].sort().map((variant_id) => ({ variant_id, garment_guaranteed: false })),
    );
  });

  it('rejects a foreign variant before writing a guest customer, fitting, or fitting lines', async () => {
    const ws = await liveStore('gv-fit-foreign', (doc) => {
      doc.checkout.fitting_requests = true;
    });
    const other = await createStorefrontWorkspace('gv-fit-foreign-other');
    const date = addDays(localDate(new Date(), 'Asia/Manila'), 3);
    await admin.query(
      `INSERT INTO fitting_settings (tenant_id, branch_id, enabled, capacity, duration_minutes, fee_minor, currency)
       VALUES ($1, $2, true, 1, 60, 0, 'PHP')`,
      [ws.tenantId, ws.branchId],
    );
    await admin.query(
      `UPDATE branch
          SET operating_hours = '{"opens_local":"10:00","closes_local":"12:00","closed_weekdays":[]}'::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [ws.tenantId, ws.branchId],
    );
    const email = 'foreign-fitting@example.test';
    const body = guestFittingRequest.parse({
      email,
      customer: { full_name: 'Ana Reyes', phone: '09171234567', address: null, social_handle: null },
      start_at: `${date}T10:00:00+08:00`,
      variant_ids: [ws.variantIds.m, other.variantIds.m],
      note: null,
    });

    const result = await booking.requestFitting(ws.slug, { requestId: 'fforeign', idempotencyKey: 'fit-foreign' }, body);

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      success: false,
      error: { message: 'One of the pieces you chose is no longer available.' },
    });
    const customers = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM customer WHERE tenant_id = $1 AND lower(email) = $2`,
      [ws.tenantId, email],
    );
    const fittings = await admin.query<{ count: number }>(`SELECT count(*)::int AS count FROM fitting_appointment WHERE tenant_id = $1`, [ws.tenantId]);
    const lines = await admin.query<{ count: number }>(`SELECT count(*)::int AS count FROM fitting_line WHERE tenant_id = $1`, [ws.tenantId]);
    expect(customers.rows[0]?.count).toBe(0);
    expect(fittings.rows[0]?.count).toBe(0);
    expect(lines.rows[0]?.count).toBe(0);
  });

  it('reuses only a normalized email and full-name match without overwriting the saved profile', async () => {
    const ws = await liveStore('gv-customer-match');
    const created = await admin.query<{ id: string }>(
      `INSERT INTO customer (tenant_id, full_name, email, phone, address)
       VALUES ($1, 'Ana Reyes', 'ana@example.test', '09170000000', 'Saved address') RETURNING id`,
      [ws.tenantId],
    );
    const { findOrCreateGuestCustomer } = await import('../../src/modules/guest-booking/guest-booking.repository.js');
    const { withTenantTransaction } = await import('../../src/db/client.js');
    await withTenantTransaction(ws.tenantId, 'guest', (client) => findOrCreateGuestCustomer(client, ws.tenantId, ' ANA@EXAMPLE.TEST ', {
      full_name: ' ana reyes ',
      phone: '09179999999',
      address: 'New request address',
      social_handle: null,
    }));
    const saved = await admin.query<{ id: string; phone: string; address: string }>(
      `SELECT id, phone, address FROM customer WHERE tenant_id = $1 AND email = 'ana@example.test'`,
      [ws.tenantId],
    );
    expect(saved.rows).toEqual([{ id: created.rows[0]?.id, phone: '09170000000', address: 'Saved address' }]);
  });

  async function withWorkerTransaction<T>(tenantId: string, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await worker.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await client.query("SELECT set_config('app.principal_id', 'shared-renter-steps-cleanup', true)");
      await client.query("SELECT set_config('app.actor_kind', 'system', true)");
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

});
