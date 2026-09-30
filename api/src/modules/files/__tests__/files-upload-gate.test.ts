import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionCode, UploadAuthorizationRequest } from '@drezivo/contracts';

const mocks = vi.hoisted(() => ({
  config: { OBJECT_STORAGE_UPLOADS_ENABLED: false },
  withTenantTransaction: vi.fn(),
  storage: {
    authorizeUpload: vi.fn(),
    authorizeRead: vi.fn(),
    inspectUploadedObject: vi.fn(),
    deleteObject: vi.fn(),
  },
}));

vi.mock('../../../config/index.js', () => ({ config: mocks.config }));
vi.mock('../../../db/client.js', () => ({ withTenantTransaction: mocks.withTenantTransaction }));
vi.mock('../../../integrations/storage/s3-compatible-object-storage.js', () => ({
  objectStorage: mocks.storage,
}));

import { DependencyUnavailableError } from '../../../shared/errors.js';
import { authorizeUpload } from '../files.service.js';

describe('file upload authorization gate', () => {
  beforeEach(() => {
    mocks.withTenantTransaction.mockReset();
    mocks.storage.authorizeUpload.mockReset();
  });

  it('fails closed before persistence or signing when uploads are paused', async () => {
    const request: UploadAuthorizationRequest = {
      purpose: 'catalogue_image',
      content_type: 'image/png',
      byte_size: 8,
      sha256: `${'A'.repeat(43)}=`,
    };

    await expect(
      authorizeUpload({
        tenantId: 'tenant-id',
        membershipId: 'membership-id',
        principalId: 'principal-id',
        permissionCodes: ['assets.manage'] as PermissionCode[],
        effectiveTenantStatus: 'active',
        requestId: 'request-id',
        idempotencyKey: 'intent-id',
        request,
      }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);

    expect(mocks.withTenantTransaction).not.toHaveBeenCalled();
    expect(mocks.storage.authorizeUpload).not.toHaveBeenCalled();
  });
});
