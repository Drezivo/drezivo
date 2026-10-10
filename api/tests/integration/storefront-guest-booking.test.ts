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
  ensureAppRoleLogin,
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
  const { openSealedEmail } = await import('../../src/modules/notifications/email-notifications.js');
  const { addDays, localDate } = await import('../../src/modules/storefront/storefront.service.js');
  const { weekdayOf } = await import('../../src/modules/storefront/shop-closures.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
  const { getReservationDetail, getReservationPaymentReceipts } = await import('../../src/modules/reservations/reservations.service.js');
  const { defaultStorefrontDocument, guestFittingRequest, guestReservationRequest } = await import('@drezivo/contracts');
  const admin = new pg.Pool({ connectionString: adminUrl, max: 3 });

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
  });
  afterEach(async () => {
    turnstileState.outcome = 'skipped';
    uploads.clear();
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await admin.end();
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

  /** Pickup 3 days from now at the store's handover time, for `days` days. */
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

  it('lets only one of two guests win the last garment for overlapping dates', async () => {
    const ws = await liveStore('gv-race');
    const results = await Promise.all([
      booking.createReservation(ws.slug, { requestId: 'ra', idempotencyKey: 'race-a' }, holdRequest(ws, 'a@example.test')),
      booking.createReservation(ws.slug, { requestId: 'rb', idempotencyKey: 'race-b' }, holdRequest(ws, 'b@example.test', { requested_interval: interval(2, 4) })),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it('enforces the shop checkout rules and online-only payment on the server', async () => {
    const ws = await liveStore('gv-rules', (doc) => {
      doc.checkout.requirements.social_handle = 'hidden';
      doc.checkout.max_rental_days = 3;
    });
    const attempt = (key: string, overrides: Record<string, unknown>) =>
      booking.createReservation(ws.slug, { requestId: key, idempotencyKey: key }, holdRequest(ws, 'ana@example.test', overrides));

    expect((await attempt('rule-social', { customer: { full_name: 'Ana Reyes', phone: null, address: '12 Mabini St', social_handle: '@ana' } })).status).toBe(422);
    expect((await attempt('rule-time', { requested_interval: { start: interval(3).start.replace('T10:00', 'T15:00'), end: interval(3).end.replace('T10:00', 'T15:00') } })).status).toBe(422);
    expect((await attempt('rule-long', { requested_interval: interval(5) })).status).toBe(422);
    expect((await attempt('rule-notice', { requested_interval: interval(2, 0) })).status).toBe(422);

    const cash = await admin.query<Record<string, unknown>>(`INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot, active, storefront_enabled) VALUES ($1, 'Cash', 'cash', '{}', true, false) RETURNING id`, [ws.tenantId]);
    expect((await attempt('rule-cash', { payment_method_id: cash.rows[0]?.['id'] })).status).toBe(422);
    expect(guestReservationRequest.safeParse({ ...holdRequest(ws, 'ana@example.test'), verification_token: 'x'.repeat(43) }).success).toBe(false);
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

  it('books several pieces in one request, lists them for the renter and the owner, and refuses a piece with no free size', async () => {
    const ws = await liveStore('gv-multi');
    const business = await settingsService.getBusiness(ws.owner);
    await settingsService.updateBusiness(ws.owner, 'biz', { version: business.version, business_name: 'Luna Gown Rentals', business_email: 'owner@luna.test', business_phone: null, business_address: null });

    const created = await booking.createReservation(ws.slug, { requestId: 'm1', idempotencyKey: 'multi-hold' }, holdRequest(ws, 'ana@example.test', { additional_variant_ids: [ws.variantIds.l] }));
    expect(created.status).toBe(201);
    if (!created.body.success) throw new Error('multi hold failed');
    const { reservation } = created.body.data;
    // Four rental days each: M 1,800 + 500 and L 1,900 + 500; a 2,000 deposit per piece; pickup.
    expect(reservation.money).toEqual({ rental_total_minor: '470000', security_required_minor: '400000', delivery_total_minor: '0', due_now_minor: '870000' });
    expect(reservation.items).toEqual([
      { name: 'Emerald Gown', size_label: 'M' },
      { name: 'Emerald Gown', size_label: 'L' },
    ]);

    const capability = guestTokenFor(reservation.id);
    const upload = await booking.authorizeReceiptUpload(reservation.id, capability, { content_type: 'image/png', byte_size: PNG.length, sha256: pngSha });
    await booking.submitReceipt(reservation.id, capability, { requestId: 'm2', idempotencyKey: 'multi-receipt' }, upload.file_id);
    const emails = await admin.query<Record<string, unknown>>(`SELECT payload FROM outbox_event WHERE tenant_id = $1 AND dedupe_key LIKE 'reservation-email:%:new_request:business'`, [ws.tenantId]);
    expect(openSealedEmail(emails.rows[0]?.['payload'] as Record<string, unknown>).text).toContain('Item: Emerald Gown, Emerald Gown');

    // The shop has one M piece, and it is now held: a second request for M twice is refused whole.
    const twice = booking.createReservation(ws.slug, { requestId: 'm3', idempotencyKey: 'multi-twice' }, holdRequest(ws, 'ben@example.test', { requested_interval: interval(3, 10), additional_variant_ids: [ws.variantIds.m] }));
    const refused = await twice;
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ success: false, error: { code: 'CAPACITY_CONFLICT', message: 'Emerald Gown is no longer available for those dates.' } });
    const holds = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM reservation WHERE tenant_id = $1`, [ws.tenantId]);
    expect(holds.rows[0]?.n).toBe(1);
  });

  it('lets a renter ask for delivery when the shop has not set it up, charges no fee, and tells the owner to arrange it', async () => {
    const ws = await liveStore('gv-deliver', undefined, { ...policy, delivery: { enabled: false, fee_minor: '0', notes: null } });
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
    expect(detail.delivery_snapshot).toEqual({ fulfillment_method: 'delivery', fee_minor: '0', terms: 'to_arrange' });

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
      expect.objectContaining({ file_id: upload.file_id, content_type: 'image/png', url: `https://files.test/${newReceiptKey}`, evidence_status: 'under_review' }),
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

});
