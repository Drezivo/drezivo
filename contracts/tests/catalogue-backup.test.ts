import { describe, expect, it } from 'vitest';

import { uploadAuthorizationRequest } from '../src/files/uploads';

describe('branch inventory backup contract', () => {
  it('allows a bounded ZIP only for the catalogue backup purpose', () => {
    const base64Sha256 = Buffer.alloc(32, 4).toString('base64');
    expect(uploadAuthorizationRequest.safeParse({
      purpose: 'catalogue_backup',
      content_type: 'application/zip',
      byte_size: 12 * 1024 * 1024,
      sha256: base64Sha256,
    }).success).toBe(true);
    expect(uploadAuthorizationRequest.safeParse({
      purpose: 'catalogue_image',
      content_type: 'application/zip',
      byte_size: 12 * 1024 * 1024,
      sha256: base64Sha256,
    }).success).toBe(false);
    expect(uploadAuthorizationRequest.safeParse({
      purpose: 'catalogue_backup',
      content_type: 'image/png',
      byte_size: 1,
      sha256: base64Sha256,
    }).success).toBe(false);
  });
});
