import { afterEach, describe, expect, it, vi } from 'vitest';

import { authorizeReceipt, createReservation, getGuestReservation, requestFitting, submitReceipt } from '@/lib/storefront-api';

describe('guest reservation cookie transport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses credentialed API requests only for reservation-scoped cookie flows', async () => {
    process.env.NEXT_PUBLIC_API_ORIGIN = 'https://api.example.test';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const request = { email: 'guest@example.test' } as never;

    await expect(createReservation('shop', request, 'reservation-intent')).rejects.toThrow();
    await expect(getGuestReservation('reservation-id')).rejects.toThrow();
    await expect(authorizeReceipt('reservation-id', {} as never)).rejects.toThrow();
    await expect(submitReceipt('reservation-id', 'file-id', 'receipt-intent')).rejects.toThrow();
    await expect(requestFitting('shop', {} as never, 'fitting-intent')).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.map(([, init]) => init?.credentials)).toEqual([
      'include', 'include', 'include', 'include', undefined,
    ]);
  });
});
