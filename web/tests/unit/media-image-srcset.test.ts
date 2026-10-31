import { afterEach, describe, expect, it, vi } from 'vitest';

import { mediaImageSrcSet } from '../../src/lib/media-image-srcset';

describe('public media image srcset', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('offers the known private derivative widths and preserves route context', () => {
    vi.stubEnv('NEXT_PUBLIC_API_ORIGIN', 'https://api.example.test');
    expect(mediaImageSrcSet('https://api.example.test/api/media/public/stores/shop-name/files/0194f6a2-9dd6-7a4c-8e9f-142f1d310001?w=960')).toBe(
      'https://api.example.test/api/media/public/stores/shop-name/files/0194f6a2-9dd6-7a4c-8e9f-142f1d310001?w=320 320w, https://api.example.test/api/media/public/stores/shop-name/files/0194f6a2-9dd6-7a4c-8e9f-142f1d310001?w=960 960w, https://api.example.test/api/media/public/stores/shop-name/files/0194f6a2-9dd6-7a4c-8e9f-142f1d310001?w=1600 1600w',
    );
  });

  it('does not rewrite remote, blob, or non-media URLs', () => {
    expect(mediaImageSrcSet('https://images.example.test/photo.jpg')).toBeUndefined();
    expect(mediaImageSrcSet('blob:https://drezivo.example/preview')).toBeUndefined();
    expect(mediaImageSrcSet('/api/v1/files/photo')).toBeUndefined();
    expect(mediaImageSrcSet(null)).toBeUndefined();
  });

  it('does not rewrite the obsolete preview proxy route', () => {
    expect(mediaImageSrcSet('/s/shop/media/preview/0194f6a2-9dd6-7a4c-8e9f-142f1d310001?w=960')).toBeUndefined();
  });
});
