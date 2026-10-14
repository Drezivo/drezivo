import { describe, expect, it } from 'vitest';

import {
  paymentMethodSettingsItem,
  paymentMethodSettingsList,
  updatePaymentRenterStepsRequest,
  updatePaymentMethodSettingsRequest,
} from '../src/storefront/payment-methods';
import { paymentInstructions } from '../src/reservations/hold';

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

  it('requires one shared renter-steps setting on the settings response', () => {
    expect(paymentMethodSettingsList.safeParse({
      items: [],
      renter_steps: { version: 1, text: null, image: null, legacy_conflicts: [] },
    }).success).toBe(true);
    expect(paymentMethodSettingsList.safeParse({ items: [] }).success).toBe(false);
  });

  it('allows shared renter steps as text or one image, but not both', () => {
    expect(updatePaymentRenterStepsRequest.safeParse({ version: 1, text: 'Pay, then send a receipt.', image_file_id: null }).success).toBe(true);
    expect(updatePaymentRenterStepsRequest.safeParse({ version: 1, text: null, image_file_id: fileId }).success).toBe(true);
    expect(updatePaymentRenterStepsRequest.safeParse({ version: 1, text: 'Pay, then send a receipt.', image_file_id: fileId }).success).toBe(false);
  });

  it('keeps the reservation renter-steps snapshot to one format', () => {
    expect(paymentInstructions.safeParse({
      method_name: 'GCash',
      rail: 'manual_qr',
      renter_steps: { text: 'Send payment, then share the receipt.' },
    }).success).toBe(true);
    expect(paymentInstructions.safeParse({
      method_name: 'GCash',
      rail: 'manual_qr',
      renter_steps: { text: null, image_url: 'https://files.example.test/steps.png', image_content_type: 'image/png' },
    }).success).toBe(true);
    expect(paymentInstructions.safeParse({
      method_name: 'GCash',
      rail: 'manual_qr',
      renter_steps: { text: 'Send payment.', image_url: 'https://files.example.test/steps.png', image_content_type: 'image/png' },
    }).success).toBe(false);
  });
});
