import { describe, expect, it } from 'vitest';

import {
  paymentMethodSettingsItem,
  updatePaymentMethodSettingsRequest,
} from '../src/storefront/payment-methods';

const paymentMethodId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';

describe('payment method settings contracts', () => {
  it('models staff/storefront visibility separately', () => {
    expect(
      paymentMethodSettingsItem.safeParse({
        id: paymentMethodId,
        name: 'GCash',
        rail: 'manual_qr',
        active: true,
        storefront_enabled: true,
        storefront_ready: true,
        version: 2,
        destination: {
          account_name: 'Luna Rentals',
          account_number: '09171234567',
          instructions: 'Send the deposit and keep your receipt.',
        },
        qr_file_id: fileId,
        presentation: 'details',
        material: null,
      }).success,
    ).toBe(true);
  });

  it('requires a complete strict update payload', () => {
    expect(
      updatePaymentMethodSettingsRequest.safeParse({
        version: 1,
        active: true,
        storefront_enabled: false,
        destination: { account_name: null, account_number: null, instructions: null },
        qr_file_id: null,
      }).success,
    ).toBe(true);
    expect(
      updatePaymentMethodSettingsRequest.safeParse({
        version: 1,
        active: true,
        storefront_enabled: false,
        destination: { account_name: null, account_number: null, instructions: null },
        qr_file_id: null,
        tenant_id: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(false);
  });
});
