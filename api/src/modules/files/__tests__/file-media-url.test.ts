import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/index.js', () => ({
  config: { MEDIA_PUBLIC_ORIGIN: 'http://localhost:3000', STAFF_APP_URL: 'http://localhost:3000' },
}));
import { guestRenterStepsMediaUrl, publicStorefrontMediaUrl, staffFileMediaUrl } from '../file-media-url.js';

describe('storefront media URLs', () => {
  it('routes public and preview images to API media endpoints', () => {
    expect(publicStorefrontMediaUrl('shop', '0194f6a2-9dd6-7a4c-8e9f-142f1d310001', true)).toBe(
      'http://localhost:3000/api/v1/public/stores/shop/media/0194f6a2-9dd6-7a4c-8e9f-142f1d310001?w=960',
    );
    expect(publicStorefrontMediaUrl('shop', '0194f6a2-9dd6-7a4c-8e9f-142f1d310001')).toBe(
      'http://localhost:3000/api/media/public/stores/shop/files/0194f6a2-9dd6-7a4c-8e9f-142f1d310001?w=960',
    );
  });

  it('routes staff images and guest payment-step images directly to the API', () => {
    expect(staffFileMediaUrl('0194f6a2-9dd6-7a4c-8e9f-142f1d310001', '0194f6a2-9dd6-7a4c-8e9f-142f1d310002')).toBe(
      'http://localhost:3000/api/v1/files/media/staff/0194f6a2-9dd6-7a4c-8e9f-142f1d310001?branch_id=0194f6a2-9dd6-7a4c-8e9f-142f1d310002&w=960',
    );
    expect(guestRenterStepsMediaUrl('0194f6a2-9dd6-7a4c-8e9f-142f1d310002', '0194f6a2-9dd6-7a4c-8e9f-142f1d310001')).toBe(
      'http://localhost:3000/api/v1/guest/reservations/0194f6a2-9dd6-7a4c-8e9f-142f1d310002/media/0194f6a2-9dd6-7a4c-8e9f-142f1d310001',
    );
  });
});
