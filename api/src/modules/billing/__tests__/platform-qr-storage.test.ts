import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectStorage } from '../../../integrations/storage/object-storage.js';

const mocks = vi.hoisted(() => ({ readQr: vi.fn(), readObject: vi.fn() }));

vi.mock('../../../db/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../db/client.js')>()),
  withTenantTransaction: async (_tenant: string, _actor: string, callback: (client: never) => Promise<unknown>) => await callback({} as never),
}));
vi.mock('../billing-payments.repository.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../billing-payments.repository.js')>()),
  readActivePlatformQr: mocks.readQr,
}));

import { readPlatformQr } from '../billing-payments.service.js';

const actor = { tenantId: 'tenant', principalId: 'principal', membershipId: 'membership', role: 'owner' as const, requestId: 'request' };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const key = 'platform-files/payment-methods/method/object';
const digest = createHash('sha256').update(png).digest('hex');
const storage = { readObject: mocks.readObject } as unknown as ObjectStorage;

describe('platform payment QR storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.readObject.mockResolvedValue({ body: (async function* () { yield await Promise.resolve(png); })(), contentLength: png.length });
  });

  it('keeps legacy bytes authoritative during the transition', async () => {
    mocks.readQr.mockResolvedValue({ qr_image: png, qr_mime: 'image/png', qr_object_key: key, qr_size_bytes: png.length, qr_sha256: digest });
    await expect(readPlatformQr(actor, 'method', storage)).resolves.toEqual({ bytes: png, contentType: 'image/png' });
    expect(mocks.readObject).not.toHaveBeenCalled();
  });

  it('reads and verifies an R2-backed image', async () => {
    mocks.readQr.mockResolvedValue({ qr_image: null, qr_mime: 'image/png', qr_object_key: key, qr_size_bytes: png.length, qr_sha256: digest });
    await expect(readPlatformQr(actor, 'method', storage)).resolves.toEqual({ bytes: png, contentType: 'image/png' });
    expect(mocks.readObject).toHaveBeenCalledWith({ storageKey: key });
  });

  it('fails closed on a checksum mismatch', async () => {
    mocks.readQr.mockResolvedValue({ qr_image: null, qr_mime: 'image/png', qr_object_key: key, qr_size_bytes: png.length, qr_sha256: '0'.repeat(64) });
    await expect(readPlatformQr(actor, 'method', storage)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('fails closed when the R2 object exceeds its recorded size', async () => {
    mocks.readQr.mockResolvedValue({ qr_image: null, qr_mime: 'image/png', qr_object_key: key, qr_size_bytes: 1, qr_sha256: digest });
    await expect(readPlatformQr(actor, 'method', storage)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
