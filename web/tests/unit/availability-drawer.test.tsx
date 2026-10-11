import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { productId, productVariantId, type ItemDetail, type PublicStorefront } from '@drezivo/contracts';

const { getAvailability } = vi.hoisted(() => ({ getAvailability: vi.fn() }));
vi.mock('@/lib/storefront-api', () => ({ getAvailability }));
vi.mock('@/lib/storefront-format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storefront-format')>();
  return { ...actual, dateIn: () => '2026-10-01' };
});

import { AvailabilityDrawer } from '@/components/store/booking/availability-drawer';

const item: ItemDetail = {
  product_id: productId.parse('00000000-0000-4000-8000-000000000101'),
  name: 'Amara',
  description: null,
  category: 'Ball Gowns',
  subcategory: null,
  image_urls: [],
  variants: [{
    variant_id: productVariantId.parse('00000000-0000-4000-8000-000000000102'),
    size_label: 'M',
    color_label: null,
    rental_price_minor: '350000',
    security_deposit_minor: '300000',
    pricing_mode: 'daily',
    included_duration_minutes: 1440,
    extra_day_price_minor: '0',
    measurement: { mode: 'none' },
  }],
};

const variant = item.variants[0]!;
const store = {
  slug: 'gigis-rental',
  timezone: 'Asia/Manila',
  checkout: { handover_time: '10:00', max_rental_days: 30 },
  contact: { facebook_url: null, instagram_url: null },
} as unknown as PublicStorefront;

function availabilityDays(from: string, to: string, unavailable: ReadonlySet<string> = new Set()) {
  const days = [];
  let date = from;
  while (date <= to) {
    days.push({ date, state: unavailable.has(date) ? 'reserved' : 'available' });
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  return days;
}

describe('availability-only drawer', () => {
  it('checks only this variant, shows the chosen date range, and exposes no booking action', async () => {
    getAvailability.mockReset();
    getAvailability.mockImplementation(async (_slug: string, _variant: string, from: string, to: string) => ({ days: availabilityDays(from, to) }));
    const onClose = vi.fn();
    render(<AvailabilityDrawer store={store} item={item} variant={variant} onClose={onClose} />);

    await screen.findByRole('dialog', { name: 'Amara' });
    await waitFor(() => expect(getAvailability).toHaveBeenCalledWith(
      'gigis-rental', variant.variant_id, expect.any(String), expect.any(String),
    ));
    fireEvent.click(screen.getAllByRole('button', { name: /October 15, available/ })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: /October 17, available/ })[0]!);

    expect(screen.getByText(/Available for Oct 15, 2026 → Oct 17, 2026 · 3 days/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reserve|continue|payment/i })).toBeNull();
    expect(screen.queryByText('Your details')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps availability fail-closed when the public availability request fails', async () => {
    getAvailability.mockReset();
    getAvailability.mockRejectedValue(new Error('network unavailable'));
    render(<AvailabilityDrawer store={store} item={item} variant={variant} onClose={() => undefined} />);

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load availability. Try again in a moment.');
    await waitFor(() => expect((screen.getAllByRole('button', { name: /October 15, unavailable/ })[0] as HTMLButtonElement).disabled).toBe(true));
  });
});
