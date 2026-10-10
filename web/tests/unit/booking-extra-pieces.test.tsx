import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogueVariant, ItemDetail, PublicStorefront } from '@drezivo/contracts';

const api = vi.hoisted(() => ({
  createReservation: vi.fn(),
  getAvailability: vi.fn(),
  getCatalogue: vi.fn(),
  getItem: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/lib/storefront-api', () => ({ ...api, StorefrontApiError: class StorefrontApiError extends Error {} }));
vi.mock('@/components/store/motion/scroll', () => ({ lockPageScroll: () => () => undefined }));
vi.mock('@/components/store/booking/availability-calendar', () => ({
  AvailabilityCalendar: ({ onChange }: { onChange: (range: { start: string; end: string }) => void }) => (
    <button type="button" onClick={() => onChange({ start: '2026-10-11', end: '2026-10-12' })}>Set test dates</button>
  ),
}));

import { BookingDrawer } from '@/components/store/booking/booking-drawer';
import { extraPiecesReadiness, type ExtraPiece } from '@/components/store/booking/extra-pieces';
import { formatMinor } from '@/lib/storefront-format';

const amara = { product_id: 'product-amara', name: 'Amara', image_urls: [] } as unknown as ItemDetail;
const amaraVariant = {
  variant_id: 'variant-amara',
  size_label: null,
  rental_price_minor: '30000',
  security_deposit_minor: '50000',
  pricing_mode: 'daily',
  included_duration_minutes: 1440,
  extra_day_price_minor: '0',
} as unknown as CatalogueVariant;
const celestineVariant = (size: string) =>
  ({ ...amaraVariant, variant_id: `variant-celestine-${size}`, size_label: size, rental_price_minor: '55000', security_deposit_minor: '50000' }) as unknown as CatalogueVariant;
const celestine = {
  product_id: 'product-celestine',
  name: 'Celestine',
  image_urls: [],
  variants: [celestineVariant('S'), celestineVariant('M')],
} as unknown as ItemDetail;

const store = {
  slug: 'casa-alondra',
  name: 'Casa Alondra',
  timezone: 'Asia/Manila',
  contact: { facebook_url: null, instagram_url: null },
  checkout: { handover_time: '10:00', max_rental_days: 14, requirements: { phone: 'hidden', social_handle: 'hidden', event_date: 'hidden' } },
  fulfillment: { delivery: false, delivery_fee_minor: '0' },
  payment_methods: [{ id: 'payment-test', name: 'GCash' }],
  policy: { version: 1 },
} as unknown as PublicStorefront;

function days(state: 'available' | 'reserved') {
  return { variant_id: 'variant-celestine-M', days: [{ date: '2026-10-11', state: 'available' }, { date: '2026-10-12', state }] };
}

async function addCelestineInM() {
  render(<BookingDrawer store={store} item={amara} variant={amaraVariant} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Set test dates' }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add another piece' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add Celestine' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'M' }));
}

describe('booking several pieces from the storefront', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCatalogue.mockResolvedValue({
      items: [{ product_id: 'product-celestine', name: 'Celestine', image_url: null, price_from_minor: '55000' }],
      total: 1,
      page: 1,
      page_size: 12,
      sizes: [],
    });
    api.getItem.mockResolvedValue(celestine);
  });

  it('adds a piece in another size, checks it for the dates, and sends both in one request', async () => {
    api.getAvailability.mockResolvedValue(days('available'));
    api.createReservation.mockReturnValue(new Promise(() => undefined));
    await addCelestineInM();

    expect(await screen.findByText('Free for your dates.')).not.toBeNull();
    expect(api.getAvailability).toHaveBeenCalledWith('casa-alondra', 'variant-celestine-M', '2026-10-11', '2026-10-12');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Bea Santiago' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'bea@example.com' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '12 Mabini St, Quezon City' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));

    expect(await screen.findByText('Celestine · M')).not.toBeNull();
    // Two days of each gown plus both deposits: 600 + 1,100 + 500 + 500.
    expect(screen.getByText(formatMinor('270000'))).not.toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Hold my size and pay' }));

    await waitFor(() => expect(api.createReservation).toHaveBeenCalledTimes(1));
    expect(api.createReservation.mock.calls[0]?.[1]).toMatchObject({
      variant_id: 'variant-amara',
      additional_variant_ids: ['variant-celestine-M'],
    });
  });

  it('keeps Continue off while an added piece is not free for the dates', async () => {
    api.getAvailability.mockResolvedValue(days('reserved'));
    await addCelestineInM();

    expect(await screen.findByText('Not free for your dates. Remove it or choose another size.')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Celestine' }));
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('extraPiecesReadiness', () => {
  const range = { start: '2026-10-11', end: '2026-10-12' };
  const piece = (overrides: Partial<ExtraPiece>): ExtraPiece => ({
    key: 'p1',
    productId: 'product-celestine',
    name: 'Celestine',
    imageUrl: null,
    item: celestine,
    variant: celestineVariant('M'),
    free: true,
    checkedFor: '2026-10-11|2026-10-12',
    error: null,
    ...overrides,
  });

  it('is ready when every piece was seen free for the current dates', () => {
    expect(extraPiecesReadiness([], range)).toEqual({ ready: true, problem: null });
    expect(extraPiecesReadiness([piece({})], range)).toEqual({ ready: true, problem: null });
  });

  it('waits for a size and a check of the current dates, and refuses a piece that is not free', () => {
    expect(extraPiecesReadiness([piece({ variant: null })], range).problem).toBe('Choose a size for Celestine.');
    expect(extraPiecesReadiness([piece({ checkedFor: '2026-10-01|2026-10-02' })], range).problem).toBe('Checking Celestine for your dates…');
    expect(extraPiecesReadiness([piece({ free: false })], range).ready).toBe(false);
  });
});
