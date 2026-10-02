import { createHash } from 'node:crypto';

import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Guest booking against a real PostgreSQL with RLS: email verification (codes read back from the
 * sealed outbox exactly as the worker would), holds with double-fire and capacity races, checkout
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

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const PNG_SHA = createHash('sha256').update(PNG).digest('base64');

describe('storefront guest booking', async () => {
  const { createApp } = await import('../../src/app.js');
  const { closePool, withTenantTransaction } = await import('../../src/db/client.js');
  const { storefrontCmsService: cms } = await import('../../src/modules/storefront-cms/storefront-cms.service.js');
  const { settingsService } = await import('../../src/modules/settings/settings.service.js');
  const { GuestVerificationService } = await import('../../src/modules/guest-booking/guest-verification.service.js');
  const { GuestBookingService, guestTokenFor } = await import('../../src/modules/guest-booking/guest-booking.service.js');
  const { openSealedEmail, emailNotifications } = await import('../../src/modules/notifications/email-notifications.js');
  const { addDays, localDate } = await import('../../src/modules/storefront/storefront.service.js');
  const { createStorefrontWorkspace } = await import('./helpers/storefront-fixture.js');
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
  const verification = new GuestVerificationService(emailNotifications, () => true, () => false);
  const booking = new GuestBookingService(verification, storage);
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
    uploads.clear();
    await resetTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await admin.end();
    await closePool();
  });

  async function liveStore(label: string, tweak: (doc: ReturnType<typeof defaultStorefrontDocument>) => void = () => undefined) {
    const ws = await createStorefrontWorkspace(label);
    const document = defaultStorefrontDocument('Luna Gown Rentals');
    document.contact.email = 'hello@luna.test';
    document.checkout.requirements.phone = 'optional';
    tweak(document);
    await cms.updateDocument(ws.owner, `${label}-doc`, { version: 1, document });
    await cms.publishPolicy(ws.owner, `${label}-pol`, { expected_version: 1, rules: policy });
    const published = await cms.publish(ws.owner, `${label}-pub`, 2);
    expect(published.status).toBe(200);
    return ws;
  }

  async function latestCode(tenantId: string): Promise<string> {
    const rows = await admin.query<Record<string, unknown>>(`SELECT payload FROM outbox_event WHERE tenant_id = $1 AND event_type = 'notification.email' AND dedupe_key LIKE 'guest-verification:%' ORDER BY created_at DESC LIMIT 1`, [tenantId]);
    const email = openSealedEmail((rows.rows[0]?.['payload'] ?? {}) as Record<string, unknown>);
    const code = /is (\d{6})\./.exec(email.text)?.[1];
    if (!code) throw new Error('no code in email');
    return code;
  }

  async function verified(slug: string, tenantId: string, email: string): Promise<string> {
    await verification.start(slug, email);
    return (await verification.confirm(slug, email, await latestCode(tenantId))).verification_token;
  }

  /** Pickup 3 days from now at the store's handover time, for `days` days. */
  function interval(days: number, offset = 3): { start: string; end: string } {
    const pickup = addDays(localDate(new Date(), 'Asia/Manila'), offset);
    return { start: `${pickup}T10:00:00+08:00`, end: `${addDays(pickup, days)}T10:00:00+08:00` };
  }

  function holdRequest(ws: { variantIds: { m: string }; paymentMethodId: string }, token: string, email: string, overrides: Record<string, unknown> = {}) {
    return guestReservationRequest.parse({
      verification_token: token,
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

  it('verifies email with hashed, attempt-limited, rate-limited codes', async () => {
    const ws = await liveStore('gv-codes');
    await verification.start(ws.slug, 'Ana@Example.test');
    const code = await latestCode(ws.tenantId);
    const stored = await admin.query<Record<string, unknown>>('SELECT code_hash, email_digest FROM guest_email_verification WHERE tenant_id = $1', [ws.tenantId]);
    expect(stored.rows[0]?.['code_hash']).not.toContain(code);
    expect(stored.rows[0]?.['email_digest']).not.toContain('ana');

    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(verification.confirm(ws.slug, 'ana@example.test', wrong)).rejects.toMatchObject({ status: 401 });
    }
    // Locked after five misses, even with the right code.
    await expect(verification.confirm(ws.slug, 'ana@example.test', code)).rejects.toMatchObject({ status: 401 });

    for (let i = 0; i < 6; i += 1) await verification.start(ws.slug, 'ana@example.test');
    const count = await admin.query<Record<string, unknown>>('SELECT count(*)::int AS n FROM guest_email_verification WHERE tenant_id = $1', [ws.tenantId]);
    expect(count.rows[0]?.['n']).toBe(5);

    const disabled = new GuestVerificationService(emailNotifications, () => false, () => false);
    await expect(disabled.start(ws.slug, 'x@example.test')).rejects.toMatchObject({ status: 503 });
    await expect(verification.start('no-such-store', 'x@example.test')).rejects.toMatchObject({ status: 404 });
  });

  it('in development accept-any mode sends no email and accepts any code, still per store', async () => {
    const ws = await liveStore('gv-dev');
    const devMode = new GuestVerificationService(emailNotifications, () => false, () => true);
    await devMode.start(ws.slug, 'dev@example.test');
    const sent = await admin.query<Record<string, unknown>>(`SELECT count(*)::int AS n FROM outbox_event WHERE tenant_id = $1 AND event_type = 'notification.email'`, [ws.tenantId]);
    expect(sent.rows[0]?.['n']).toBe(0);

    const { verification_token: token } = await devMode.confirm(ws.slug, 'dev@example.test', '123456');
    const hold = await new GuestBookingService(devMode, storage).createReservation(ws.slug, { requestId: 'r-dev', idempotencyKey: 'gv-dev-hold' }, holdRequest(ws, token, 'dev@example.test'));
    expect(hold.status).toBe(201);
    // Still bound to an address that asked for a code, and to a real store.
    await expect(devMode.confirm(ws.slug, 'never-asked@example.test', '123456')).rejects.toMatchObject({ status: 401 });
    await expect(devMode.start('no-such-store', 'dev@example.test')).rejects.toMatchObject({ status: 404 });
  });

  it('creates one hold per key, replays the same token, and isolates guest links', async () => {
    const ws = await liveStore('gv-hold');
    const token = await verified(ws.slug, ws.tenantId, 'ana@example.test');
    const body = holdRequest(ws, token, 'ana@example.test');

    const first = await booking.createReservation(ws.slug, { requestId: 'r1', idempotencyKey: 'hold-1' }, body);
    expect(first.status).toBe(201);
    if (!first.body.success) throw new Error('expected success');
    const created = first.body.data;
    expect(created.reservation).toMatchObject({ status: 'held', item_name: 'Emerald Gown', size_label: 'M', receipt_submitted: false });
    expect(created.reservation.money).toEqual({ rental_total_minor: '180000', security_required_minor: '200000', delivery_total_minor: '0', due_now_minor: '380000' });
    expect(created.reservation.payment_instructions?.destination_note).toContain('Account number: 001234567890');
    expect(created.guest_token).toBe(guestTokenFor(created.reservation.id));

    const replay = await booking.createReservation(ws.slug, { requestId: 'r2', idempotencyKey: 'hold-1' }, body);
    expect(replay).toEqual({ ...first, body: { ...first.body, request_id: 'r1' } });
    const stored = await admin.query<Record<string, unknown>>('SELECT safe_response::text AS body FROM idempotency_record WHERE tenant_id = $1', [ws.tenantId]);
    expect(stored.rows.map((row) => String(row['body'])).join('')).not.toContain(created.guest_token);
    const holds = await admin.query<Record<string, unknown>>(`SELECT count(*)::int AS n FROM reservation WHERE tenant_id = $1`, [ws.tenantId]);
    expect(holds.rows[0]?.['n']).toBe(1);

    const app = createApp();
    const view = await request(app).get(`/api/v1/guest/reservations/${created.reservation.id}`).set('Authorization', `Bearer ${created.guest_token}`);
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect((await request(app).get(`/api/v1/guest/reservations/${created.reservation.id}`)).status).toBe(404);
    const other = await request(app).get(`/api/v1/guest/reservations/${created.reservation.id}`).set('Authorization', `Bearer ${guestTokenFor('00000000-0000-4000-8000-000000000000')}`);
    expect(other.status).toBe(404);

    const audit = await admin.query<Record<string, unknown>>(`SELECT actor_kind FROM audit_event WHERE tenant_id = $1 AND action = 'reservation.created'`, [ws.tenantId]);
    expect(audit.rows).toEqual([{ actor_kind: 'guest' }]);
  });

  it('lets only one of two guests win the last garment for overlapping dates', async () => {
    const ws = await liveStore('gv-race');
    const [a, b] = await Promise.all([
      verified(ws.slug, ws.tenantId, 'a@example.test'),
      verified(ws.slug, ws.tenantId, 'b@example.test'),
    ]);
    const results = await Promise.all([
      booking.createReservation(ws.slug, { requestId: 'ra', idempotencyKey: 'race-a' }, holdRequest(ws, a, 'a@example.test')),
      booking.createReservation(ws.slug, { requestId: 'rb', idempotencyKey: 'race-b' }, holdRequest(ws, b, 'b@example.test', { requested_interval: interval(2, 4) })),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it('enforces the shop checkout rules and online-only payment on the server', async () => {
    const ws = await liveStore('gv-rules', (doc) => {
      doc.checkout.requirements.social_handle = 'hidden';
      doc.checkout.max_rental_days = 3;
    });
    const token = await verified(ws.slug, ws.tenantId, 'ana@example.test');
    const attempt = (key: string, overrides: Record<string, unknown>) =>
      booking.createReservation(ws.slug, { requestId: key, idempotencyKey: key }, holdRequest(ws, token, 'ana@example.test', overrides));

    expect((await attempt('rule-social', { customer: { full_name: 'Ana Reyes', phone: null, address: '12 Mabini St', social_handle: '@ana' } })).status).toBe(422);
    expect((await attempt('rule-time', { requested_interval: { start: interval(3).start.replace('T10:00', 'T15:00'), end: interval(3).end.replace('T10:00', 'T15:00') } })).status).toBe(422);
    expect((await attempt('rule-long', { requested_interval: interval(5) })).status).toBe(422);
    expect((await attempt('rule-notice', { requested_interval: interval(2, 0) })).status).toBe(422);

    const cash = await admin.query<Record<string, unknown>>(`INSERT INTO payment_method (tenant_id, name, rail, destination_snapshot, active, storefront_enabled) VALUES ($1, 'Cash', 'cash', '{}', true, false) RETURNING id`, [ws.tenantId]);
    expect((await attempt('rule-cash', { payment_method_id: cash.rows[0]?.['id'] })).status).toBe(422);
    expect((await attempt('rule-token', { verification_token: 'x'.repeat(43) })).status).toBe(401);
  });

  it('moves the hold to review when the guest submits a verified receipt, and emails per preferences', async () => {
    const ws = await liveStore('gv-receipt');
    const business = await settingsService.getBusiness(ws.owner);
    await settingsService.updateBusiness(ws.owner, 'biz', { version: business.version, business_name: 'Luna Gown Rentals', business_email: 'owner@luna.test', business_phone: null, business_address: null });
    const token = await verified(ws.slug, ws.tenantId, 'ana@example.test');
    const created = await booking.createReservation(ws.slug, { requestId: 'h', idempotencyKey: 'hold' }, holdRequest(ws, token, 'ana@example.test'));
    if (!created.body.success) throw new Error('hold failed');
    const { reservation, guest_token } = created.body.data;

    const upload = await booking.authorizeReceiptUpload(reservation.id, guest_token, { content_type: 'image/png', byte_size: PNG.length, sha256: pngSha });
    expect(upload.upload_url).toContain(`/guest-receipts/${reservation.id}/`);

    const submitted = await booking.submitReceipt(reservation.id, guest_token, { requestId: 's', idempotencyKey: 'receipt-1' }, upload.file_id);
    expect(submitted.status).toBe(200);
    expect(submitted.body.success && submitted.body.data).toMatchObject({ status: 'pending_confirmation', receipt_submitted: true, hold_expires_at: null });

    const again = await booking.submitReceipt(reservation.id, guest_token, { requestId: 's2', idempotencyKey: 'receipt-2' }, upload.file_id);
    expect(again.status).toBe(409);

    const emails = await admin.query<Record<string, unknown>>(`SELECT dedupe_key, payload FROM outbox_event WHERE tenant_id = $1 AND event_type = 'notification.email' AND dedupe_key LIKE 'reservation-email:%' ORDER BY dedupe_key`, [ws.tenantId]);
    const opened = emails.rows.map((row) => ({ key: String(row['dedupe_key']), ...openSealedEmail(row['payload'] as Record<string, unknown>) }));
    expect(opened.map((email) => [email.key.split(':').slice(2).join(':'), email.to])).toEqual([
      ['new_request:business', 'owner@luna.test'],
      ['request_received:customer', 'ana@example.test'],
    ]);
    const plaintext = await admin.query<Record<string, unknown>>(`SELECT payload::text AS p FROM outbox_event WHERE tenant_id = $1`, [ws.tenantId]);
    expect(plaintext.rows.map((row) => String(row['p'])).join('')).not.toContain('ana@example.test');

    // A receipt uploaded for a different booking can never be attached to this one.
    const token2 = await verified(ws.slug, ws.tenantId, 'ben@example.test');
    const second = await booking.createReservation(ws.slug, { requestId: 'h2', idempotencyKey: 'hold-2' }, holdRequest(ws, token2, 'ben@example.test', { variant_id: ws.variantIds.l }));
    if (!second.body.success) throw new Error('second hold failed');
    const foreign = booking.submitReceipt(second.body.data.reservation.id, second.body.data.guest_token, { requestId: 'x', idempotencyKey: 'receipt-x' }, upload.file_id);
    await expect(foreign).rejects.toMatchObject({ status: 422 });
  });

  it('turns a verified guest fitting request into a pending storefront fitting, one per slot', async () => {
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

    const fittingRequest = (token: string, email: string) => guestFittingRequest.parse({
      verification_token: token,
      email,
      customer: { full_name: 'Ana Reyes', phone: '09171234567', address: null, social_handle: null },
      start_at: `${date}T10:00:00+08:00`,
      variant_ids: [ws.variantIds.m],
      note: 'Need it for a debut.',
    });
    const a = await verified(ws.slug, ws.tenantId, 'a@example.test');
    const b = await verified(ws.slug, ws.tenantId, 'b@example.test');
    const results = await Promise.all([
      booking.requestFitting(ws.slug, { requestId: 'fa', idempotencyKey: 'fit-a' }, fittingRequest(a, 'a@example.test')),
      booking.requestFitting(ws.slug, { requestId: 'fb', idempotencyKey: 'fit-b' }, fittingRequest(b, 'b@example.test')),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const rows = await admin.query<Record<string, unknown>>(`SELECT booking_channel, status, internal_note FROM fitting_appointment WHERE tenant_id = $1`, [ws.tenantId]);
    expect(rows.rows).toEqual([{ booking_channel: 'storefront', status: 'pending', internal_note: 'Customer note: Need it for a debut.' }]);
    const lines = await admin.query<Record<string, unknown>>(`SELECT garment_guaranteed FROM fitting_line WHERE tenant_id = $1`, [ws.tenantId]);
    expect(lines.rows).toEqual([{ garment_guaranteed: false }]);
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
    const token = await verified(ws.slug, ws.tenantId, email);
    const body = guestFittingRequest.parse({
      verification_token: token,
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
    const token = await verified(ws.slug, ws.tenantId, email);
    const body = guestFittingRequest.parse({
      verification_token: token,
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

  // Pilot: NOTIFICATION_PREFERENCES_ENFORCED is false, so a stored "off" preference must not stop
  // a customer email (the Notifications tab is hidden and owners cannot switch it back on).
  it('sends customer emails even when a stored preference says off', async () => {
    const ws = await liveStore('gv-prefs');
    const current = await settingsService.getNotifications(ws.owner);
    await settingsService.updateNotifications(ws.owner, 'prefs', { version: current.version, email_enabled: true, customer: { ...current.customer, request_confirmed: false }, business: current.business });
    const token = await verified(ws.slug, ws.tenantId, 'ana@example.test');
    const created = await booking.createReservation(ws.slug, { requestId: 'h', idempotencyKey: 'hold' }, holdRequest(ws, token, 'ana@example.test'));
    if (!created.body.success) throw new Error('hold failed');
    const id = created.body.data.reservation.id;
    await withTenantTransaction(ws.tenantId, 'test', async (client) => {
      await emailNotifications.reservationEvent(client, ws.tenantId, id, 'request_confirmed');
      await emailNotifications.reservationEvent(client, ws.tenantId, id, 'request_rejected');
    });
    const sent = await admin.query<Record<string, unknown>>(`SELECT dedupe_key FROM outbox_event WHERE tenant_id = $1 AND dedupe_key LIKE 'reservation-email:%'`, [ws.tenantId]);
    expect(sent.rows.map((row) => row['dedupe_key']).sort()).toEqual([
      `reservation-email:${id}:request_confirmed:customer`,
      `reservation-email:${id}:request_rejected:customer`,
    ]);
  });
});
