import pg from 'pg';
import type { RequestHandler } from 'express';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildAppRoleDatabaseUrl, buildWorkerRoleDatabaseUrl, ensureAppRoleLogin, ensureWorkerRoleLogin, migrateTestDatabase, requireTestDatabaseUrl } from './helpers/test-db.js';

vi.mock('../../src/middleware/auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/middleware/auth.js')>()),
  clerkContext: ((_req, _res, next) => next()) satisfies RequestHandler,
}));

const adminUrl = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = buildAppRoleDatabaseUrl(adminUrl);

describe('platform payment QR object lifecycle', async () => {
  const { closePool, withGlobalTransaction } = await import('../../src/db/client.js');
  const { objectStorage } = await import('../../src/integrations/storage/s3-compatible-object-storage.js');
  const { writePlatformMethod, readOperatorPlatformQr } = await import('../../src/modules/internal-operator/platform-payment-methods.service.js');
  const { migratePlatformQrs } = await import('../../src/modules/billing/platform-qr-migration.js');
  const { retryFailedPlatformQrCleanup, sweepPlatformQrObject } = await import('../../src/modules/billing/platform-qr-cleanup.js');
  const { createApp } = await import('../../src/app.js');
  const { createPlatformPaymentAssertionVerifier } = await import('../../src/modules/internal-operator/platform-payment-assertion.js');
  const admin = new pg.Pool({ connectionString: adminUrl });
  const worker = new pg.Pool({ connectionString: buildWorkerRoleDatabaseUrl(adminUrl) });
  const objects = new Map<string, Buffer>();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fields = { label: 'QR test', account_name: null, account_number: null, instructions: null, sort_order: 0, reason: 'Test migration' };
  const context = (key: string) => ({ subject: 'test-operator', requestId: 'test-request', idempotencyKey: key });
  const image = { data_base64: png.toString('base64') };

  beforeAll(async () => {
    await migrateTestDatabase(adminUrl);
    await ensureAppRoleLogin(adminUrl);
    await ensureWorkerRoleLogin(adminUrl);
    await admin.query('TRUNCATE platform_payment_method_change, platform_payment_method, platform_payment_qr_object CASCADE');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    objects.clear();
    await admin.query('TRUNCATE platform_payment_method_change, platform_payment_method, platform_payment_qr_object CASCADE');
  });
  afterAll(async () => { await worker.end(); await admin.end(); await closePool(); });

  function mockStorage(): void {
    vi.spyOn(objectStorage, 'putObject').mockImplementation(async ({ storageKey, body }) => { await Promise.resolve(); objects.set(storageKey, Buffer.from(body)); });
    vi.spyOn(objectStorage, 'readObject').mockImplementation(async ({ storageKey }) => {
      await Promise.resolve();
      const value = objects.get(storageKey);
      return value ? { body: (async function* () { yield await Promise.resolve(value); })(), contentLength: value.length } : null;
    });
    vi.spyOn(objectStorage, 'deleteObject').mockImplementation(async (storageKey) => { await Promise.resolve(); objects.delete(storageKey); });
  }

  it('stores a new QR in R2, serves it, and replays the same intent once', async () => {
    mockStorage();
    const first = await writePlatformMethod(null, { ...fields, qr: image }, context('create-intent-00001'));
    const retry = await writePlatformMethod(null, { ...fields, qr: image }, context('create-intent-00001'));
    expect(first.changed).toBe(true);
    expect(retry).toMatchObject({ changed: false, replayed: true, method: { id: first.method.id } });
    const row = await admin.query<{ qr_image: Buffer | null; qr_object_key: string }>('SELECT qr_image, qr_object_key FROM platform_payment_method WHERE id=$1', [first.method.id]);
    expect(row.rows[0]?.qr_image).toBeNull();
    expect(row.rows[0]?.qr_object_key).toMatch(/^platform-files\/payment-methods\//);
    expect(await readOperatorPlatformQr(first.method.id, 'test-operator')).toEqual({ method_id: first.method.id, data_base64: image.data_base64, mime: 'image/png' });
    await sweepPlatformQrObject(objectStorage, worker);
    expect(objects.has(row.rows[0]?.qr_object_key ?? '')).toBe(true);
  });

  it('restricts cleanup queue writes and worker access to payment data', async () => {
    await expect(withGlobalTransaction('regular-user', async (client) => await client.query(
      "INSERT INTO platform_payment_qr_object (storage_key,state) VALUES ('platform-files/payment-methods/test/object','uploading')",
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(worker.query('SELECT label FROM platform_payment_method')).rejects.toMatchObject({ code: '42501' });
  });

  it('preserves the previous QR if an upload fails after writing an object', async () => {
    mockStorage();
    const first = await writePlatformMethod(null, { ...fields, qr: image }, context('create-intent-00002'));
    const old = await admin.query<{ qr_object_key: string }>('SELECT qr_object_key FROM platform_payment_method WHERE id=$1', [first.method.id]);
    vi.spyOn(objectStorage, 'putObject').mockImplementationOnce(async ({ storageKey, body }) => { await Promise.resolve(); objects.set(storageKey, Buffer.from(body)); throw new Error('synthetic upload failure'); });
    await expect(writePlatformMethod(first.method.id, { ...fields, version: first.method.version, qr: image }, context('update-intent-00002'))).rejects.toThrow();
    const row = await admin.query<{ qr_object_key: string; version: number }>('SELECT qr_object_key, version FROM platform_payment_method WHERE id=$1', [first.method.id]);
    expect(row.rows[0]).toEqual({ qr_object_key: old.rows[0]?.qr_object_key, version: first.method.version });
    await admin.query("UPDATE platform_payment_qr_object SET available_at=now() WHERE state='uploading'");
    await sweepPlatformQrObject(objectStorage, worker);
    expect(objects.size).toBe(1);
    expect(objects.has(old.rows[0]?.qr_object_key ?? '')).toBe(true);
  });

  it('reclaims an upload if the database transaction fails after R2 accepts it', async () => {
    mockStorage();
    await expect(writePlatformMethod(null, { ...fields, reason: 'x', qr: image }, context('create-intent-00005'))).rejects.toThrow();
    const methods = await admin.query<{ count: number }>('SELECT count(*)::int AS count FROM platform_payment_method');
    expect(methods.rows[0]?.count).toBe(0);
    expect(objects.size).toBe(1);
    await admin.query("UPDATE platform_payment_qr_object SET available_at=now() WHERE state='uploading'");
    await sweepPlatformQrObject(objectStorage, worker);
    expect(objects.size).toBe(0);
  });

  it('copies legacy bytes, verifies them, and finalizes only verified records', async () => {
    mockStorage();
    const row = await admin.query<{ id: string }>("INSERT INTO platform_payment_method (label,qr_image,qr_mime) VALUES ('Legacy QR',$1,'image/png') RETURNING id", [png]);
    expect(await migratePlatformQrs('copy')).toEqual({ scanned: 1, changed: 1 });
    const copied = await admin.query<{ qr_image: Buffer | null; qr_object_key: string }>('SELECT qr_image,qr_object_key FROM platform_payment_method WHERE id=$1', [row.rows[0]?.id]);
    expect(copied.rows[0]?.qr_image?.equals(png)).toBe(true);
    expect(objects.has(copied.rows[0]?.qr_object_key ?? '')).toBe(true);
    expect(await migratePlatformQrs('copy')).toEqual({ scanned: 1, changed: 0 });
    expect(await migratePlatformQrs('finalize')).toEqual({ scanned: 1, changed: 1 });
    const final = await admin.query<{ qr_image: Buffer | null }>('SELECT qr_image FROM platform_payment_method WHERE id=$1', [row.rows[0]?.id]);
    expect(final.rows[0]?.qr_image).toBeNull();
    expect(await migratePlatformQrs('finalize')).toEqual({ scanned: 0, changed: 0 });
  });

  it('serializes concurrent duplicate replacements and retries cleanup safely', async () => {
    mockStorage();
    const first = await writePlatformMethod(null, { ...fields, qr: image }, context('create-intent-00003'));
    const previous = await admin.query<{ qr_object_key: string }>('SELECT qr_object_key FROM platform_payment_method WHERE id=$1', [first.method.id]);
    const input = { ...fields, version: first.method.version, qr: image };
    const results = await Promise.all([
      writePlatformMethod(first.method.id, input, context('update-intent-00003')),
      writePlatformMethod(first.method.id, input, context('update-intent-00003')),
    ]);
    expect(results.filter((value) => value.changed)).toHaveLength(1);
    expect(results.filter((value) => value.replayed)).toHaveLength(1);
    const current = await admin.query<{ qr_object_key: string }>('SELECT qr_object_key FROM platform_payment_method WHERE id=$1', [first.method.id]);
    vi.spyOn(objectStorage, 'deleteObject').mockRejectedValueOnce(new Error('synthetic delete failure'));
    await expect(sweepPlatformQrObject(objectStorage, worker)).rejects.toThrow();
    await admin.query("UPDATE platform_payment_qr_object SET available_at=now() WHERE state='delete_pending'");
    await sweepPlatformQrObject(objectStorage, worker);
    await sweepPlatformQrObject(objectStorage, worker);
    expect(objects.has(previous.rows[0]?.qr_object_key ?? '')).toBe(false);
    expect(objects.has(current.rows[0]?.qr_object_key ?? '')).toBe(true);
  });

  it('dead-letters repeated cleanup failures and permits a safe operator retry', async () => {
    mockStorage();
    const first = await writePlatformMethod(null, { ...fields, qr: image }, context('create-intent-00006'));
    const prior = await admin.query<{ qr_object_key: string }>('SELECT qr_object_key FROM platform_payment_method WHERE id=$1', [first.method.id]);
    await writePlatformMethod(first.method.id, { ...fields, version: first.method.version, qr: null }, context('remove-intent-00006'));
    await admin.query("UPDATE platform_payment_qr_object SET attempts=9, available_at=now() WHERE state='delete_pending'");
    vi.spyOn(objectStorage, 'deleteObject').mockRejectedValueOnce(new Error('synthetic storage outage'));
    await expect(sweepPlatformQrObject(objectStorage, worker)).rejects.toThrow();
    const failed = await admin.query<{ state: string; attempts: number }>('SELECT state,attempts FROM platform_payment_qr_object WHERE storage_key=$1', [prior.rows[0]?.qr_object_key]);
    expect(failed.rows[0]).toEqual({ state: 'failed', attempts: 10 });
    expect(objects.has(prior.rows[0]?.qr_object_key ?? '')).toBe(true);
    expect(await retryFailedPlatformQrCleanup()).toBe(1);
    await sweepPlatformQrObject(objectStorage, worker);
    expect(objects.has(prior.rows[0]?.qr_object_key ?? '')).toBe(false);
  });

  it('does not finalize a legacy image when its R2 copy is unavailable', async () => {
    mockStorage();
    const row = await admin.query<{ id: string }>("INSERT INTO platform_payment_method (label,qr_image,qr_mime) VALUES ('Legacy QR',$1,'image/png') RETURNING id", [png]);
    await migratePlatformQrs('copy');
    objects.clear();
    await expect(migratePlatformQrs('finalize')).rejects.toThrow();
    const result = await admin.query<{ qr_image: Buffer }>('SELECT qr_image FROM platform_payment_method WHERE id=$1', [row.rows[0]?.id]);
    expect(result.rows[0]?.qr_image.equals(png)).toBe(true);
    expect(await migratePlatformQrs('copy')).toEqual({ scanned: 1, changed: 1 });
    expect(await migratePlatformQrs('finalize')).toEqual({ scanned: 1, changed: 1 });
  });

  it('accepts JPEG and WebP, rejects invalid images, and removes a QR with cleanup', async () => {
    mockStorage();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = Buffer.from('RIFF0000WEBP', 'ascii');
    const first = await writePlatformMethod(null, { ...fields, qr: { data_base64: jpeg.toString('base64') } }, context('create-intent-00004'));
    expect(await readOperatorPlatformQr(first.method.id, 'test-operator')).toMatchObject({ mime: 'image/jpeg' });
    const second = await writePlatformMethod(first.method.id, { ...fields, version: first.method.version, qr: { data_base64: webp.toString('base64') } }, context('update-intent-00004'));
    expect(await readOperatorPlatformQr(first.method.id, 'test-operator')).toMatchObject({ mime: 'image/webp' });
    await expect(writePlatformMethod(first.method.id, { ...fields, version: second.method.version, qr: { data_base64: Buffer.from('invalid').toString('base64') } }, context('update-intent-00005'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const removed = await writePlatformMethod(first.method.id, { ...fields, version: second.method.version, qr: null }, context('update-intent-00006'));
    expect(removed.method.has_qr).toBe(false);
    await sweepPlatformQrObject(objectStorage, worker);
    await sweepPlatformQrObject(objectStorage, worker);
    expect(objects.size).toBe(0);
  });

  it('enforces signed, body-bound internal commands and accepts a full-size image', async () => {
    mockStorage();
    const auth = 'local-service';
    const secret = 'local-assertion';
    const app = createApp({ internalOperator: { verifyPlatformPaymentAssertion: createPlatformPaymentAssertionVerifier({ serviceAuth: auth, assertionSecret: secret }) } });
    const endpoint = '/internal/operator/v1/platform-payment-methods';
    const payload = { ...fields, qr: { data_base64: Buffer.concat([png, Buffer.alloc(512 * 1024 - png.length)]).toString('base64') } };
    const signed = (body: unknown, method = 'POST', signedPath = endpoint, signedKey: string | null = 'signed-intent-0001'): string => {
      const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
      const issued = Math.floor(Date.now() / 1000);
      const header = encode({ alg: 'HS256', typ: 'JWT' });
      const claims = encode({ iss: 'drezivo-operator-api', aud: 'drezivo-business-api', sub: 'test-operator', org_id: 'org', role: 'platform_owner',
        permission: method === 'GET' ? 'tenant.admin.read' : 'tenant.admin.manage', method, path: signedPath, request_id: 'test-request', idempotency_key: signedKey,
        body_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), iat: issued, exp: issued + 60, jti: randomUUID() });
      return `${header}.${claims}.${createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url')}`;
    };
    const denied = await request(app).post(endpoint).set('Authorization', auth).set('X-Request-ID', 'test-request').set('Idempotency-Key', 'signed-intent-0001').set('X-Drezivo-Operator-Assertion', signed(fields)).send(payload);
    expect(denied.status).toBe(401);
    const result = await request(app).post(endpoint).set('Authorization', auth).set('X-Request-ID', 'test-request').set('Idempotency-Key', 'signed-intent-0001').set('X-Drezivo-Operator-Assertion', signed(payload)).send(payload);
    expect(result.status).toBe(200);
    const responseBody: unknown = result.body;
    expect(responseBody).toMatchObject({ data: { method: { has_qr: true } } });
    expect(JSON.stringify(responseBody)).not.toContain('platform-files/');
    const created = responseBody as { data: { method: { id: string } } };
    const qrPath = `${endpoint}/${created.data.method.id}/qr`;
    const qr = await request(app).get(qrPath).set('Authorization', auth).set('X-Request-ID', 'test-request').set('X-Drezivo-Operator-Assertion', signed({}, 'GET', qrPath, null));
    expect(qr.status).toBe(200);
    const qrBody: unknown = qr.body;
    expect(qrBody).toMatchObject({ data: { mime: 'image/png', data_base64: payload.qr.data_base64 } });
    expect(JSON.stringify(qrBody)).not.toContain('platform-files/');
    const oversized = { ...fields, qr: { data_base64: Buffer.alloc(512 * 1024 + 1).toString('base64') } };
    const rejected = await request(app).post(endpoint).set('Authorization', auth).set('X-Request-ID', 'test-request').set('Idempotency-Key', 'signed-intent-0001').set('X-Drezivo-Operator-Assertion', signed(oversized)).send(oversized);
    expect(rejected.status).toBe(422);
  });
});
