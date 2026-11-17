import { describe, expect, it } from 'vitest';
import type { ItemDetail, PublicStorefront } from '@drezivo/contracts';

import { buildGuestFlowMetadata, buildItemMetadata, buildStorefrontMetadata } from '@/lib/seo';

describe('social preview metadata', () => {
  const store = {
    slug: 'sample', name: 'Sample', tagline: null, description: null,
    cover_url: 'https://images.example.test/store.png', content: { hero: { image_url: null } },
  } as unknown as PublicStorefront;

  it('keeps storefront and item images for both social networks', () => {
    const storefront = buildStorefrontMetadata(store);
    expect(storefront.openGraph?.images).toEqual([{ url: store.cover_url }]);
    expect(storefront.twitter?.images).toEqual([store.cover_url]);
    const item = { product_id: 'item', name: 'Gown', description: null, image_urls: ['https://images.example.test/item.png'] } as unknown as ItemDetail;
    const metadata = buildItemMetadata(store, item);
    expect(metadata.openGraph?.images).toEqual([{ url: item.image_urls[0] }]);
    expect(metadata.twitter?.images).toEqual([item.image_urls[0]]);
  });

  it('keeps guest pages private and excludes inherited social previews', () => {
    const metadata = buildGuestFlowMetadata('Booking');
    expect(metadata.robots).toMatchObject({ index: false, follow: false, nocache: true });
    expect(metadata.openGraph).toBeNull();
    expect(metadata.twitter).toBeNull();
  });
});
