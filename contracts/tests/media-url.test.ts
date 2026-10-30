import { describe, expect, it } from 'vitest';

import { mediaUrl } from '../src/common/media.js';

const fileId = 'f364c473-ccb9-4ff5-aece-76bac163e3af';
const branchId = 'ee275186-8b37-4f90-ae64-e110aebccc5a';

describe('mediaUrl', () => {
  it('accepts absolute API-host public, preview, staff, guest and PDF media routes', () => {
    expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/media/public/stores/drezivo/files/${fileId}?w=960`).success).toBe(true);
    expect(mediaUrl.safeParse(`https://api-preview.drezivo.shop/api/v1/public/stores/drezivo/media/${fileId}?w=320`).success).toBe(true);
    expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/v1/guest/reservations/${fileId}/media/${fileId}`).success).toBe(true);
    expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/private-documents/staff/${fileId}?branch_id=${branchId}`).success).toBe(true);
  });

  it('accepts branch-scoped staff media routes with supported widths', () => {
    for (const width of [320, 960, 1600]) {
      expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/v1/files/media/staff/${fileId}?branch_id=${branchId}&w=${width}`).success).toBe(
        true,
      );
    }
  });

  it('accepts the local API origin over HTTP', () => {
    expect(mediaUrl.safeParse(`http://localhost:4000/api/media/public/stores/drezivo/files/${fileId}`).success).toBe(true);
  });

  it('rejects old web proxy paths, R2 URLs, insecure remote origins and unsupported variants', () => {
    expect(mediaUrl.safeParse(`https://web.drezivo.shop/api/media/public/drezivo/${fileId}`).success).toBe(false);
    expect(mediaUrl.safeParse(`https://bucket.r2.cloudflarestorage.com/${fileId}`).success).toBe(false);
    expect(mediaUrl.safeParse(`http://api.drezivo.shop/api/media/public/stores/drezivo/files/${fileId}`).success).toBe(false);
    expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/media/public/stores/drezivo/files/${fileId}?w=400`).success).toBe(false);
    expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/media/public/stores/drezivo/files/${fileId}?w=960&other=true`).success).toBe(false);
    expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/v1/files/media/staff/${fileId}`).success).toBe(false);
    expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/v1/files/media/staff/${fileId}?branch_id=${branchId}&w=400`).success).toBe(false);
    expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/v1/guest/reservations/${fileId}/media/${fileId}?grant=value`).success).toBe(false);
  });

  it('rejects URLs with embedded credentials or fragments', () => {
    expect(mediaUrl.safeParse(`https://name:value@api.drezivo.shop/api/media/public/stores/drezivo/files/${fileId}`).success).toBe(false);
    expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/media/public/stores/drezivo/files/${fileId}#image`).success).toBe(false);
  });

  it('keeps grant values out of URL query strings', () => {
    for (const query of ['?grant=value', '?access_token=value', '?media_access=value']) {
      expect(mediaUrl.safeParse(`https://api.drezivo.shop/api/v1/public/stores/drezivo/media/${fileId}${query}`).success).toBe(false);
    }
  });
});
