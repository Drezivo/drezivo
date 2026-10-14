import { describe, expect, it } from 'vitest';

import { mediaImageSrcSet } from '../../src/lib/media-image-srcset';

describe('public media image srcset', () => {
  it('offers the known private derivative widths and preserves route context', () => {
    expect(mediaImageSrcSet('/api/media/public/shop-name/file-id?w=960')).toBe(
      '/api/media/public/shop-name/file-id?w=320 320w, /api/media/public/shop-name/file-id?w=960 960w, /api/media/public/shop-name/file-id?w=1600 1600w',
    );
  });

  it('does not rewrite remote, blob, or non-media URLs', () => {
    expect(mediaImageSrcSet('https://images.example.test/photo.jpg')).toBeUndefined();
    expect(mediaImageSrcSet('blob:https://drezivo.example/preview')).toBeUndefined();
    expect(mediaImageSrcSet('/api/v1/files/photo')).toBeUndefined();
    expect(mediaImageSrcSet(null)).toBeUndefined();
  });
});
