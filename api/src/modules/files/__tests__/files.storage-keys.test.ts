import { describe, expect, it } from 'vitest';

import {
  guestReceiptStorageKey,
  isGuestReceiptStorageKey,
  staffUploadStorageKey,
} from '../files.storage-keys.js';

describe('purpose-based storage keys', () => {
  it.each([
    ['catalogue_image', 'catalogue-images'],
    ['payment_receipt', 'payment-receipts'],
    ['measurement_guide', 'workspace-assets'],
    ['storefront_asset', 'workspace-assets'],
    ['payment_method_material', 'workspace-assets'],
    ['subscription_payment_proof', 'billing-evidence'],
  ] as const)(
    'places %s uploads in the %s folder under the tenant UUID',
    (purpose, folder) => {
      expect(staffUploadStorageKey('tenant-uuid', purpose, 'file-uuid')).toBe(
        `tenant-files/tenant-uuid/${folder}/file-uuid/source`,
      );
    },
  );

  it('keeps guest receipts reservation-scoped and accepts the legacy key for that exact file', () => {
    const tenantId = 'tenant-uuid';
    const reservationId = 'reservation-uuid';
    const fileId = 'file-uuid';
    const currentKey = guestReceiptStorageKey(tenantId, reservationId, fileId);
    const legacyKey = `tenant-files/${tenantId}/guest-receipts/${reservationId}/${fileId}`;

    expect(currentKey).toBe(
      `tenant-files/${tenantId}/payment-receipts/${reservationId}/${fileId}/source`,
    );
    expect(isGuestReceiptStorageKey(currentKey, tenantId, reservationId, fileId)).toBe(true);
    expect(isGuestReceiptStorageKey(legacyKey, tenantId, reservationId, fileId)).toBe(true);
    expect(isGuestReceiptStorageKey(legacyKey, tenantId, 'other-reservation', fileId)).toBe(false);
    expect(isGuestReceiptStorageKey(legacyKey, 'other-tenant', reservationId, fileId)).toBe(false);
    expect(isGuestReceiptStorageKey(legacyKey, tenantId, reservationId, 'other-file')).toBe(false);
  });
});
