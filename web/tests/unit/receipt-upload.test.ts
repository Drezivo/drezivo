import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizeReceipt: vi.fn(),
  submitReceipt: vi.fn(),
}));

vi.mock('@/lib/storefront-api', () => ({
  authorizeReceipt: mocks.authorizeReceipt,
  submitReceipt: mocks.submitReceipt,
  StorefrontApiError: class StorefrontApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code: string,
    ) {
      super(message);
    }
  },
}));

import { uploadReceipt } from '@/lib/receipt-upload';

describe('receipt upload', () => {
  beforeEach(() => {
    mocks.authorizeReceipt.mockReset();
    mocks.submitReceipt.mockReset();
    vi.restoreAllMocks();
  });

  it('continues to server verification when a retry receives create-only 412', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mocks.authorizeReceipt.mockResolvedValue({
      file_id: '0194f6a2-9dd6-7a4c-8e9f-142f1d310002',
      upload_url: 'https://uploads.example.test/receipt',
      required_headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
      expires_at: '2026-09-30T06:00:00.000Z',
    });
    mocks.submitReceipt.mockResolvedValue({ id: 'reservation-id' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 412 }));

    await uploadReceipt('reservation-id', file, 'receipt-intent');

    expect(mocks.submitReceipt).toHaveBeenCalledWith(
      'reservation-id',
      '0194f6a2-9dd6-7a4c-8e9f-142f1d310002',
      'receipt-intent',
    );
  });
});
