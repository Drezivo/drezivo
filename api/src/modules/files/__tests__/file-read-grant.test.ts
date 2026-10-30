import { describe, expect, it, vi } from 'vitest';

import type { ObjectStorage } from '../../../integrations/storage/object-storage.js';
import { createMediaReadGrant, MEDIA_READ_GRANT_TTL_SECONDS } from '../file-read-grant.js';

const tenantId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310002';
const fileId = '0194f6a2-9dd6-7a4c-8e9f-142f1d310001';
const sourceKey = `tenant-files/${tenantId}/catalogue-images/${fileId}/source`;
const variantKey = `tenant-files/${tenantId}/catalogue-images/${fileId}/variants/v1/320.webp`;

function storage(overrides: Partial<ObjectStorage> = {}): ObjectStorage {
  return {
    authorizeUpload: vi.fn(() => Promise.resolve({ uploadUrl: '', requiredHeaders: {}, expiresAt: new Date() })),
    authorizeRead: vi.fn(() => Promise.resolve({
      readUrl: 'https://account.r2.cloudflarestorage.com/private/object?X-Amz-Signature=short-lived',
      expiresAt: new Date('2026-10-14T10:01:00.000Z'),
    })),
    readObject: vi.fn(() => Promise.resolve(null)),
    inspectUploadedObject: vi.fn(() => Promise.resolve(null)),
    ...overrides,
  };
}

describe('createMediaReadGrant', () => {
  it('grants the verified private WebP derivative for an accepted image width', async () => {
    const headObject = vi.fn(() => Promise.resolve({ contentType: 'image/webp', contentLength: 4321 }));
    const authorizeRead = vi.fn(() => Promise.resolve({
      readUrl: 'https://account.r2.cloudflarestorage.com/private/object?X-Amz-Signature=temporary',
      expiresAt: new Date('2026-10-14T10:01:00.000Z'),
    }));
    const objectStorage = storage({
      headObject,
      authorizeRead,
    });

    const grant = await createMediaReadGrant({
      tenantId,
      fileId,
      purpose: 'catalogue_image',
      storageKey: sourceKey,
      versionId: 'source-version',
      mimeType: 'image/jpeg',
      byteSize: 90_000,
      width: 320,
    }, objectStorage);

    expect(headObject).toHaveBeenCalledWith(variantKey);
    expect(authorizeRead).toHaveBeenCalledWith({
      storageKey: variantKey,
      versionId: null,
      expiresInSeconds: MEDIA_READ_GRANT_TTL_SECONDS,
    });
    expect(MEDIA_READ_GRANT_TTL_SECONDS).toBe(60);
    expect(grant).toMatchObject({
      tenant_id: tenantId,
      purpose: 'catalogue_image',
      content_type: 'image/webp',
      byte_size: 4321,
      expires_at: '2026-10-14T10:01:00.000Z',
    });
    expect(grant.read_url).toContain('X-Amz-Signature=temporary');
  });

  it('falls back to the accepted source if its derivative is absent or invalid', async () => {
    const authorizeRead = vi.fn().mockResolvedValue({
      readUrl: 'https://account.r2.cloudflarestorage.com/private/source?X-Amz-Signature=temporary',
      expiresAt: new Date('2026-10-14T10:01:00.000Z'),
    });
    const objectStorage = storage({
      headObject: vi.fn().mockResolvedValue({ contentType: 'image/png', contentLength: 12 }),
      authorizeRead,
    });

    const grant = await createMediaReadGrant({
      tenantId,
      fileId,
      purpose: 'catalogue_image',
      storageKey: sourceKey,
      versionId: 'source-version',
      mimeType: 'image/jpeg',
      byteSize: 90_000,
      width: 320,
    }, objectStorage);

    expect(authorizeRead).toHaveBeenCalledWith({
      storageKey: sourceKey,
      versionId: 'source-version',
      expiresInSeconds: 60,
    });
    expect(grant).toMatchObject({ content_type: 'image/jpeg', byte_size: 90_000 });
  });

  it('never looks up derivatives for private receipt evidence', async () => {
    const headObject = vi.fn();
    const authorizeRead = vi.fn().mockResolvedValue({
      readUrl: 'https://account.r2.cloudflarestorage.com/private/receipt?X-Amz-Signature=temporary',
      expiresAt: new Date('2026-10-14T10:01:00.000Z'),
    });
    const objectStorage = storage({ headObject, authorizeRead });

    const grant = await createMediaReadGrant({
      tenantId,
      fileId,
      purpose: 'payment_receipt',
      storageKey: `tenant-files/${tenantId}/payment-receipts/${fileId}/source`,
      versionId: 'receipt-version',
      mimeType: 'image/png',
      byteSize: 2048,
      width: 320,
    }, objectStorage);

    expect(headObject).not.toHaveBeenCalled();
    expect(authorizeRead).toHaveBeenCalledWith({
      storageKey: `tenant-files/${tenantId}/payment-receipts/${fileId}/source`,
      versionId: 'receipt-version',
      expiresInSeconds: 60,
    });
    expect(grant.content_type).toBe('image/png');
  });
});
