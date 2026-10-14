import type { PoolClient } from 'pg';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { ObjectStorage } from '../../../integrations/storage/object-storage.js';
import type { ImageVariantSourceRow } from '../../../modules/files/files.repository.js';
import { DeferredOutboxError } from '../../runner.js';
import { createFileImageVariantsHandler } from '../file-image-variants.js';

const tenantId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310002';
const fileId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310001';
const sourceKey = `tenant-files/${tenantId}/catalogue-images/${fileId}/source`;
const acceptedSource = {
  id: fileId,
  tenant_id: tenantId,
  purpose: 'catalogue_image' as const,
  storage_key: sourceKey,
  version_id: 'source-version',
  sha256: 'a'.repeat(64),
  mime_type: 'image/jpeg',
  byte_size: 12,
  lifecycle_status: 'accepted' as const,
  frozen_at: new Date('2026-10-14T10:00:00.000Z'),
};

function event(payload: Record<string, unknown> = { file_id: fileId }) {
  return {
    id: 'outbox-id',
    tenant_id: tenantId,
    dedupe_key: `file-image-variants:${fileId}`,
    event_type: 'file.image_variants.generate_requested',
    payload,
    attempts: 0,
    max_attempts: 8,
  };
}

function createTransaction(rows: Array<ImageVariantSourceRow | null>) {
  const query = vi.fn();
  for (const row of rows) query.mockResolvedValueOnce({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const client = { query } as unknown as PoolClient;
  let calls = 0;
  const transaction = async <T>(
    _tenantId: string,
    _systemKey: string,
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> => {
    calls += 1;
    return callback(client);
  };
  return { transaction, query, getCalls: () => calls };
}

function objectStorage(overrides: Partial<ObjectStorage> = {}): ObjectStorage {
  const source = Buffer.from('verified-img');
  return {
    authorizeUpload: vi.fn(() => Promise.resolve({ uploadUrl: '', requiredHeaders: {}, expiresAt: new Date() })),
    authorizeRead: vi.fn(() => Promise.resolve({ readUrl: '', expiresAt: new Date() })),
    readObject: vi.fn(() => Promise.resolve({
      body: Readable.from([source]),
      contentLength: source.byteLength,
    })),
    inspectUploadedObject: vi.fn(() => Promise.resolve(null)),
    ...overrides,
  };
}

describe('file.image_variants.generate_requested worker', () => {
  it('writes all deterministic WebP widths only after rechecking the accepted source under lock', async () => {
    const { transaction, query, getCalls } = createTransaction([acceptedSource, acceptedSource]);
    const putObject = vi.fn((input: Parameters<NonNullable<ObjectStorage['putObject']>>[0]) => Promise.resolve(input).then(() => undefined));
    const store = objectStorage({ putObject });
    const transform = vi.fn((_source: Buffer, width: 320 | 960 | 1600) => Promise.resolve(Buffer.from(`webp-${width}`)));
    const handle = createFileImageVariantsHandler(store, transaction, transform);

    await handle(event());

    expect(getCalls()).toBe(2);
    expect(query.mock.calls[1]?.[0]).toContain('FOR UPDATE');
    expect(transform.mock.calls.map((call) => call[1])).toEqual([320, 960, 1600]);
    expect(putObject.mock.calls.map(([input]) => input)).toEqual([
      {
        storageKey: `tenant-files/${tenantId}/catalogue-images/${fileId}/variants/v1/320.webp`,
        contentType: 'image/webp',
        body: Buffer.from('webp-320'),
      },
      {
        storageKey: `tenant-files/${tenantId}/catalogue-images/${fileId}/variants/v1/960.webp`,
        contentType: 'image/webp',
        body: Buffer.from('webp-960'),
      },
      {
        storageKey: `tenant-files/${tenantId}/catalogue-images/${fileId}/variants/v1/1600.webp`,
        contentType: 'image/webp',
        body: Buffer.from('webp-1600'),
      },
    ]);
  });

  it('does not write variants when the source is deleted or replaced before the locked recheck', async () => {
    const { transaction, getCalls } = createTransaction([acceptedSource, null]);
    const putObject = vi.fn();
    const store = objectStorage({ putObject });
    const transform = vi.fn((_source: Buffer, width: 320 | 960 | 1600) => Promise.resolve(Buffer.from(`webp-${width}`)));
    const handle = createFileImageVariantsHandler(store, transaction, transform);

    await handle(event());

    expect(getCalls()).toBe(2);
    expect(transform).toHaveBeenCalledTimes(3);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('does not read private evidence or create derivatives', async () => {
    const privateSource = {
      ...acceptedSource,
      purpose: 'payment_receipt' as const,
      storage_key: `tenant-files/${tenantId}/payment-receipts/${fileId}/source`,
    };
    const { transaction, getCalls } = createTransaction([privateSource]);
    const readObject = vi.fn();
    const putObject = vi.fn();
    const transform = vi.fn();
    const handle = createFileImageVariantsHandler(objectStorage({ readObject, putObject }), transaction, transform);

    await handle(event());

    expect(getCalls()).toBe(1);
    expect(readObject).not.toHaveBeenCalled();
    expect(transform).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('defers cleanly when derivative writes are unavailable', async () => {
    const { transaction } = createTransaction([acceptedSource]);
    const store = objectStorage();
    const handle = createFileImageVariantsHandler(store, transaction);

    await expect(handle(event())).rejects.toBeInstanceOf(DeferredOutboxError);
  });
});
