import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectStorage } from '../../../integrations/storage/object-storage.js';

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), readObject: vi.fn(), warn: vi.fn(), transaction: vi.fn() }));
vi.mock('../../../db/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../db/client.js')>()),
  withTenantTransaction: mocks.transaction,
}));
vi.mock('../billing-payments.repository.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../billing-payments.repository.js')>()),
  readPaymentProofFile: mocks.readFile,
}));
vi.mock('../../../shared/logger.js', () => ({ logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { readPaymentProof } from '../billing-payments.service.js';

const file = { storage_key: 'private-key', version_id: null, mime_type: 'image/jpeg', byte_size: 5,
  purpose: 'subscription_payment_proof', lifecycle_status: 'accepted', is_frozen: true, has_checksum: true };
const storage = { readObject: mocks.readObject } as unknown as ObjectStorage;

describe('operator payment proof diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (_tenant: string, _actor: string, callback: (client: never) => Promise<unknown>) => await callback({} as never));
    mocks.readFile.mockResolvedValue(file);
    mocks.readObject.mockResolvedValue({ body: (async function* () { yield await Promise.resolve(new Uint8Array(5)); })(), contentLength: 5 });
  });

  it.each(['image/jpeg', 'application/pdf'])('returns an accepted %s proof within the tenant transaction', async (mime_type) => {
    mocks.readFile.mockResolvedValue({ ...file, mime_type });
    expect(await readPaymentProof('tenant', 'payment', 'operator', storage, 'req')).toMatchObject({ byteSize: 5, mimeType: mime_type });
    expect(mocks.transaction).toHaveBeenCalledWith('tenant', 'operator:operator', expect.any(Function));
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['payment_or_file_not_found', null],
    ['proof_not_accepted', { ...file, lifecycle_status: 'pending' }],
    ['proof_not_accepted', { ...file, is_frozen: false }],
    ['proof_not_accepted', { ...file, has_checksum: false }],
    ['unsupported_content_type', { ...file, mime_type: 'text/html' }],
  ])('fails closed and logs %s for metadata', async (reason, row) => {
    mocks.readFile.mockResolvedValue(row);
    expect(await readPaymentProof('tenant', 'payment', 'operator', storage, 'req')).toBeNull();
    expect(mocks.readObject).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'req', reason }), expect.any(String));
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('private-key');
  });

  it.each([['object_not_found', null], ['object_size_mismatch', { body: [], contentLength: 6 }]])('fails closed and logs %s for storage', async (reason, object) => {
    mocks.readObject.mockResolvedValue(object);
    expect(await readPaymentProof('tenant', 'payment', 'operator', storage, 'req')).toBeNull();
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'req', reason }), expect.any(String));
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('private-key');
  });
});
