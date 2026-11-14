import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAvailability, getCatalogue, getFittingSlots, getItem, getStore } from '@/lib/storefront-api';

describe('storefront data cache boundaries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never lets Next cache public, preview, or live booking reads', async () => {
    process.env.NEXT_PUBLIC_API_ORIGIN = 'https://api.example.test';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const reads = [
      getStore('shop'),
      getStore('shop', 'preview'),
      getCatalogue('shop', {}),
      getCatalogue('shop', {}, 'preview'),
      getItem('shop', 'item'),
      getAvailability('shop', 'variant', '2026-12-01', '2026-12-02'),
      getFittingSlots('shop', '2026-12-01'),
    ];
    await Promise.all(reads.map((read) => expect(read).rejects.toThrow()));
    expect(fetchMock).toHaveBeenCalledTimes(reads.length);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options?.cache).toBe('no-store');
      expect(options).not.toHaveProperty('next');
    }
  });
});
