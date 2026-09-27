import { describe, expect, it } from 'vitest';

import { itemDetail, MAX_CLOTHING_PHOTOS } from '../src';

const productId = '00000000-0000-4000-8000-000000000001';

describe('catalogue storefront contract', () => {
  it('caps product detail image URLs at five photos', () => {
    const imageUrls = Array.from({ length: MAX_CLOTHING_PHOTOS + 1 }, (_, index) =>
      `https://cdn.example.test/catalogue/${index + 1}.webp`,
    );
    const base = {
      product_id: productId,
      name: 'Photo Gown',
      description: '',
      category: 'Gowns',
      variants: [
        {
          variant_id: '00000000-0000-4000-8000-000000000002',
          sku: 'GOWN-M',
          size_label: 'M',
          color_label: null,
          measurements: {},
          measurement_unit: 'cm' as const,
          rental_price_minor: '30000',
          security_deposit_minor: '50000',
          currency: 'PHP' as const,
          pricing_mode: 'daily' as const,
          included_duration_minutes: 1440,
          extra_day_price_minor: '0',
        },
      ],
    };

    expect(itemDetail.safeParse({ ...base, image_urls: imageUrls.slice(0, MAX_CLOTHING_PHOTOS) }).success).toBe(true);
    expect(itemDetail.safeParse({ ...base, image_urls: imageUrls }).success).toBe(false);
  });
});
