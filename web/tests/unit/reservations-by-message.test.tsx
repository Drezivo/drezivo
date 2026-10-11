import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productId, productVariantId, type ItemDetail, type PublicStorefront } from '@drezivo/contracts';

import { HowItWorks } from '@/components/store/home-sections';
import { ItemView } from '@/components/store/item-view';
import { PreviewProvider } from '@/components/store/preview-context';

const { getAvailability } = vi.hoisted(() => ({ getAvailability: vi.fn() }));

vi.mock('@/lib/storefront-api', () => ({ getAvailability }));
vi.mock('@/components/store/booking/booking-drawer', () => ({ BookingDrawer: () => null }));

const item: ItemDetail = {
  product_id: productId.parse('00000000-0000-4000-8000-000000000101'),
  name: 'Amara',
  description: null,
  category: 'Ball Gowns',
  subcategory: null,
  image_urls: [],
  variants: [{
    variant_id: productVariantId.parse('00000000-0000-4000-8000-000000000102'),
    size_label: null,
    color_label: null,
    rental_price_minor: '350000',
    security_deposit_minor: '300000',
    pricing_mode: 'daily',
    included_duration_minutes: 1440,
    extra_day_price_minor: '0',
    measurement: { mode: 'none' },
  }],
};

function storeWith(overrides: Partial<PublicStorefront>): PublicStorefront {
  return {
    slug: 'gigis-rental',
    name: "Gigi's Rental",
    payment_methods: [{ id: '00000000-0000-4000-8000-000000000103', name: 'GCash', rail: 'manual_qr' }],
    booking_open: true,
    reservations_open: true,
    fitting: { enabled: false },
    fulfillment: { pickup: true, delivery: false, delivery_fee_minor: '0' },
    checkout: { handover_time: '10:00', max_rental_days: 30 },
    content: { sections: { how_it_works: true } },
    contact: {
      phone: '0917 123 4567',
      email: 'hello@gigis.test',
      address: null,
      instagram_url: 'https://instagram.com/gigis',
      facebook_url: 'https://facebook.com/gigis',
      tiktok_url: null,
    },
    policy: { format: 'text', rental: '', deposit: '', cancellation: '', damage: '' },
    ...overrides,
  } as unknown as PublicStorefront;
}

function renderItem(store: PublicStorefront, preview = false, selectedItem = item) {
  return render(
    <PreviewProvider preview={preview}>
      <ItemView store={store} item={selectedItem} />
    </PreviewProvider>,
  );
}

describe('reservations by message', () => {
  beforeEach(() => {
    getAvailability.mockReset();
    getAvailability.mockResolvedValue({ days: [] });
  });

  it('offers an availability sheet and keeps shop contacts when the owner takes reservations by message', async () => {
    renderItem(storeWith({ reservations_open: false }));

    expect(screen.queryByRole('button', { name: 'Choose rental dates' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check availability' }));
    expect(await screen.findByRole('dialog', { name: 'Amara' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Check availability' })).toBeTruthy();
    await waitFor(() => expect(getAvailability).toHaveBeenCalledWith(
      'gigis-rental',
      item.variants[0]?.variant_id,
      expect.any(String),
      expect.any(String),
    ));
    expect(screen.queryByText('Your details')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByText(/This shop takes reservations by message/)).toBeTruthy();
    const contacts = screen.getByRole('list', { name: 'Contact the shop' });
    const links = [...contacts.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual([
      ['Facebook', 'https://facebook.com/gigis'],
      ['Instagram', 'https://instagram.com/gigis'],
      ['0917 123 4567', 'tel:09171234567'],
      ['hello@gigis.test', 'mailto:hello@gigis.test'],
    ]);
  });

  it('requires a size choice before opening availability for a sized style', () => {
    const sizedItem: ItemDetail = {
      ...item,
      variants: [
        { ...item.variants[0]!, variant_id: productVariantId.parse('00000000-0000-4000-8000-000000000202'), size_label: 'S' },
        { ...item.variants[0]!, variant_id: productVariantId.parse('00000000-0000-4000-8000-000000000203'), size_label: 'M' },
      ],
    };
    renderItem(storeWith({ reservations_open: false }), false, sizedItem);

    expect(screen.getByRole('button', { name: 'Choose a size to check availability' }).hasAttribute('disabled')).toBe(true);
  });

  it('does not show the checker in preview or while booking is paused for billing', () => {
    const { rerender } = renderItem(storeWith({ reservations_open: false }), true);
    expect(screen.queryByRole('button', { name: 'Check availability' })).toBeNull();

    rerender(
      <PreviewProvider preview={false}>
        <ItemView store={storeWith({ booking_open: false, reservations_open: false })} item={item} />
      </PreviewProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Check availability' })).toBeNull();
    expect(screen.getByText(/Online booking is paused for now/)).toBeTruthy();
  });

  it('keeps online booking when reservations are open', () => {
    renderItem(storeWith({}));

    expect(screen.getByRole('button', { name: 'Choose rental dates' })).toBeTruthy();
    expect(screen.queryByText(/takes reservations by message/)).toBeNull();
  });

  it('keeps the paused-booking message when the shop is view-only for billing', () => {
    renderItem(storeWith({ booking_open: false, reservations_open: false }));

    expect(screen.getByText(/Online booking is paused for now/)).toBeTruthy();
    expect(screen.queryByText(/takes reservations by message/)).toBeNull();
  });

  it('falls back to booking_open when an older API omits reservations_open', () => {
    const store = storeWith({});
    delete (store as { reservations_open?: boolean }).reservations_open;
    renderItem(store);

    expect(screen.getByRole('button', { name: 'Choose rental dates' })).toBeTruthy();
  });

  it('describes messaging the shop in How renting works instead of paying online', () => {
    render(<HowItWorks store={storeWith({ reservations_open: false })} />);

    expect(screen.getByText('Message the shop')).toBeTruthy();
    expect(screen.queryByText('Pay and send your receipt')).toBeNull();
  });
});
