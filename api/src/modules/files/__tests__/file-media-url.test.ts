import { describe, expect, it } from 'vitest';
import { publicStorefrontMediaUrl } from '../file-media-url.js';

describe('storefront media URLs', () => {
  it('keeps preview images under the store-scoped preview cookie path', () => {
    expect(publicStorefrontMediaUrl('shop', '0194f6a2-9dd6-7a4c-8e9f-142f1d310001', true)).toBe(
      '/s/shop/media/preview/0194f6a2-9dd6-7a4c-8e9f-142f1d310001?w=960',
    );
  });
});
