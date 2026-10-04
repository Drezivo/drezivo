import { describe, expect, it } from 'vitest';

import {
  businessInformation,
  catalogueQuery,
  catalogueResponse,
  defaultStorefrontDocument,
  DEFAULT_NOTIFICATION_PREFERENCES,
  itemDetail,
  MAX_CLOTHING_PHOTOS,
  STOREFRONT_SLUG_MAX_LENGTH,
  notificationPreferences,
  publicAvailabilityQuery,
  storefrontDocument,
  storefrontPolicyRules,
  storefrontSlug,
} from '../src';

const productId = '00000000-0000-4000-8000-000000000001';

describe('catalogue storefront contract', () => {
  it('caps product detail image URLs at five photos', () => {
    const imageUrls = Array.from({ length: MAX_CLOTHING_PHOTOS + 1 }, (_, index) =>
      `https://cdn.example.test/catalogue/${index + 1}.webp`,
    );
    const base = {
      product_id: productId,
      name: 'Photo Gown',
      description: null,
      category: 'Gowns',
      variants: [
        {
          variant_id: '00000000-0000-4000-8000-000000000002',
          size_label: 'M',
          color_label: null,
          rental_price_minor: '30000',
          security_deposit_minor: '50000',
          pricing_mode: 'daily' as const,
          included_duration_minutes: 1440,
          extra_day_price_minor: '0',
          measurement: { mode: 'none' as const },
        },
      ],
    };

    expect(itemDetail.safeParse({ ...base, image_urls: imageUrls.slice(0, MAX_CLOTHING_PHOTOS) }).success).toBe(true);
    expect(itemDetail.safeParse({ ...base, image_urls: imageUrls }).success).toBe(false);
  });

  it('bounds catalogue paging and rejects unknown filters', () => {
    expect(catalogueQuery.parse({})).toMatchObject({ page: 1, page_size: 24, sort: 'featured' });
    expect(catalogueQuery.safeParse({ page_size: '49' }).success).toBe(false);
    expect(catalogueQuery.safeParse({ tenant_id: 'x' }).success).toBe(false);
  });

  it('accepts a trimmed single subcategory filter and returns public facet values', () => {
    expect(catalogueQuery.parse({ subcategory: '  mini ' }).subcategory).toBe('mini');
    expect(catalogueQuery.safeParse({ subcategory: 'x'.repeat(121) }).success).toBe(false);
    expect(catalogueQuery.safeParse({ subcategories: ['LONG'] }).success).toBe(false);
    expect(
      catalogueResponse.safeParse({
        items: [{
          product_id: productId,
          name: 'Tea Dress',
          category: 'Dresses',
          subcategory: 'MINI',
          image_url: null,
          price_from_minor: '30000',
          pricing_mode: 'daily',
          included_duration_minutes: 1440,
          sizes: ['S'],
        }],
        total: 1,
        page: 1,
        page_size: 24,
        sizes: ['S'],
        subcategories: ['MINI'],
      }).success,
    ).toBe(true);
  });

  it('keeps availability windows bounded and ordered', () => {
    const variant_id = '00000000-0000-4000-8000-000000000002';
    expect(publicAvailabilityQuery.safeParse({ variant_id, from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(publicAvailabilityQuery.safeParse({ variant_id, from: '2026-10-31', to: '2026-10-01' }).success).toBe(false);
    expect(publicAvailabilityQuery.safeParse({ variant_id, from: '2026-10-01', to: '2027-01-31' }).success).toBe(false);
  });
});

describe('storefront CMS contract', () => {
  const valid = defaultStorefrontDocument('Luna Gown Rentals');

  it('accepts the default document for a new storefront', () => {
    expect(storefrontDocument.safeParse(valid).success).toBe(true);
  });

  it('rejects control characters and line breaks in single-line text', () => {
    const withNull = { ...valid, branding: { ...valid.branding, display_name: 'Luna\u0000' } };
    const withBreak = { ...valid, content: { ...valid.content, hero: { ...valid.content.hero, heading: 'One\nTwo' } } };
    expect(storefrontDocument.safeParse(withNull).success).toBe(false);
    expect(storefrontDocument.safeParse(withBreak).success).toBe(false);
  });

  it('allows line breaks in long-form text', () => {
    const multi = { ...valid, branding: { ...valid.branding, description: 'Line one\nLine two' } };
    expect(storefrontDocument.safeParse(multi).success).toBe(true);
  });

  it('accepts social handles and canonical profile URLs, storing normalized handles', () => {
    const withHandle = { ...valid, contact: { ...valid.contact, instagram: '@luna.gowns' } };
    expect(storefrontDocument.parse(withHandle).contact.instagram).toBe('luna.gowns');

    const withProfileUrls = {
      ...valid,
      contact: {
        ...valid.contact,
        instagram: 'https://www.instagram.com/luna.gowns/',
        facebook: 'https://facebook.com/luna.rentals',
        tiktok: 'https://www.tiktok.com/@luna.gowns/',
      },
    };
    expect(storefrontDocument.parse(withProfileUrls).contact).toMatchObject({
      instagram: 'luna.gowns',
      facebook: 'luna.rentals',
      tiktok: 'luna.gowns',
    });
  });

  it.each([
    ['a wrong-platform host', { ...valid.contact, instagram: 'https://facebook.com/luna' }],
    ['a non-HTTPS URL', { ...valid.contact, instagram: 'http://instagram.com/luna' }],
    ['an Instagram URL with an explicit port', { ...valid.contact, instagram: 'https://instagram.com:443/luna' }],
    ['an Instagram share path', { ...valid.contact, instagram: 'https://instagram.com/share/luna' }],
    ['a Facebook URL with a query', { ...valid.contact, facebook: 'https://facebook.com/luna?ref=profile' }],
    ['a TikTok URL without the profile marker', { ...valid.contact, tiktok: 'https://tiktok.com/luna' }],
    ['an unrelated URL', { ...valid.contact, instagram: 'https://example.com/luna' }],
    ['a script URL', { ...valid.contact, instagram: 'javascript:alert(1)' }],
  ])('rejects %s', (_description, contact) => {
    expect(storefrontDocument.safeParse({ ...valid, contact }).success).toBe(false);
  });

  it('fails closed on unknown themes, keys, and repeated featured items', () => {
    expect(storefrontDocument.safeParse({ ...valid, branding: { ...valid.branding, theme: 'neon' } }).success).toBe(false);
    expect(storefrontDocument.safeParse({ ...valid, css: 'body{}' }).success).toBe(false);
    const repeated = { ...valid, content: { ...valid.content, featured_product_ids: [productId, productId] } };
    expect(storefrontDocument.safeParse(repeated).success).toBe(false);
  });

  it('normalizes slugs and refuses reserved or malformed ones', () => {
    expect(storefrontSlug.parse('Luna-Gowns')).toBe('luna-gowns');
    expect(storefrontSlug.safeParse('admin').success).toBe(false);
    expect(storefrontSlug.safeParse('a--b').success).toBe(false);
    expect(storefrontSlug.safeParse('-luna').success).toBe(false);
    expect(storefrontSlug.safeParse('lu').success).toBe(false);
    expect(storefrontSlug.safeParse('a'.repeat(STOREFRONT_SLUG_MAX_LENGTH)).success).toBe(true);
    expect(storefrontSlug.safeParse('a'.repeat(STOREFRONT_SLUG_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('keeps delivery fees within integer minor units', () => {
    const rules = {
      rental: 'Three-day rental.',
      deposit: 'Refundable deposit.',
      cancellation: 'Cancel 48 hours before pickup.',
      damage: null,
      delivery: { enabled: true, fee_minor: '15000', notes: null },
      privacy_notice: 'We only use your details for this rental.',
    };
    expect(storefrontPolicyRules.safeParse(rules).success).toBe(true);
    expect(storefrontPolicyRules.safeParse({ ...rules, delivery: { ...rules.delivery, fee_minor: '-1' } }).success).toBe(false);
    expect(storefrontPolicyRules.safeParse({ ...rules, delivery: { ...rules.delivery, fee_minor: '99999999999' } }).success).toBe(false);
  });

  describe('rental terms as text or images', () => {
    const typed = {
      rental: 'Three-day rental.',
      deposit: 'Refundable deposit.',
      cancellation: 'Cancel 48 hours before pickup.',
      damage: null,
      delivery: { enabled: false, fee_minor: '0', notes: null },
      privacy_notice: 'We only use your details for this rental.',
    };
    const page = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

    it('reads a version saved before formats existed as typed text', () => {
      expect(storefrontPolicyRules.parse(typed)).toMatchObject({ format: 'text', image_file_ids: [] });
    });

    it('requires every typed term when the terms are text', () => {
      const result = storefrontPolicyRules.safeParse({ ...typed, deposit: '' });
      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues.map((issue) => issue.path.join('.'))).toEqual(['deposit']);
    });

    it('accepts image terms without typed terms, but needs at least one page', () => {
      const images = { ...typed, format: 'images', rental: '', deposit: '', cancellation: '' };
      expect(storefrontPolicyRules.safeParse({ ...images, image_file_ids: [page(1), page(2)] }).success).toBe(true);
      const none = storefrontPolicyRules.safeParse({ ...images, image_file_ids: [] });
      expect(!none.success && none.error.issues.map((issue) => issue.path.join('.'))).toEqual(['image_file_ids']);
    });

    it('refuses repeated pages, more than six pages, and unknown formats', () => {
      const images = { ...typed, format: 'images' };
      expect(storefrontPolicyRules.safeParse({ ...images, image_file_ids: [page(1), page(1)] }).success).toBe(false);
      expect(storefrontPolicyRules.safeParse({ ...images, image_file_ids: [1, 2, 3, 4, 5, 6, 7].map(page) }).success).toBe(false);
      expect(storefrontPolicyRules.safeParse({ ...typed, format: 'pdf' }).success).toBe(false);
    });

    it('still requires a typed privacy notice when the terms are images', () => {
      expect(storefrontPolicyRules.safeParse({ ...typed, format: 'images', image_file_ids: [page(1)], privacy_notice: '' }).success).toBe(false);
    });
  });
});

describe('business settings contract', () => {
  it('validates business information strictly', () => {
    const info = { business_name: 'Luna Gown Rentals', business_email: 'Hello@Luna.test', business_phone: '09171234567', business_address: null };
    expect(businessInformation.parse(info).business_email).toBe('hello@luna.test');
    expect(businessInformation.parse({ ...info, business_phone: '+63 917 123 4567' }).business_phone).toBe('09171234567');
    expect(businessInformation.safeParse({ ...info, currency: 'USD' }).success).toBe(false);
    expect(businessInformation.safeParse({ ...info, business_phone: 'call me' }).success).toBe(false);
  });

  it('ships defaults that satisfy the notification schema', () => {
    expect(notificationPreferences.safeParse(DEFAULT_NOTIFICATION_PREFERENCES).success).toBe(true);
  });
});
