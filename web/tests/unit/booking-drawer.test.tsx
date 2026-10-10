import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogueVariant, ItemDetail, PublicStorefront } from '@drezivo/contracts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/lib/storefront-api', () => ({
  createReservation: vi.fn(),
  StorefrontApiError: class StorefrontApiError extends Error {},
}));
vi.mock('@/components/store/motion/scroll', () => ({ lockPageScroll: () => () => undefined }));
vi.mock('@/components/store/booking/availability-calendar', () => ({
  AvailabilityCalendar: ({ onChange }: { onChange: (range: { start: string; end: string }) => void }) => (
    <button type="button" onClick={() => onChange({ start: '2026-10-11', end: '2026-10-12' })}>Set test dates</button>
  ),
}));

import { BookingDrawer } from '@/components/store/booking/booking-drawer';

const item = {
  product_id: 'product-test',
  name: 'Amara',
  image_urls: [],
} as unknown as ItemDetail;

const variant = {
  variant_id: 'variant-test',
  size_label: null,
  rental_price_minor: '30000',
  security_deposit_minor: '50000',
  pricing_mode: 'daily',
  included_duration_minutes: 1440,
  extra_day_price_minor: '0',
} as unknown as CatalogueVariant;

const store = {
  slug: 'test-shop',
  name: 'Test Shop',
  timezone: 'Asia/Manila',
  contact: { facebook_url: null, instagram_url: null },
  checkout: {
    handover_time: '10:00',
    max_rental_days: 14,
    requirements: { phone: 'hidden', social_handle: 'hidden', event_date: 'hidden' },
  },
  fulfillment: { delivery: false, delivery_fee_minor: '0' },
  payment_methods: [{ id: 'payment-test', name: 'GCash' }],
  policy: { version: 1 },
} as unknown as PublicStorefront;

function openDetails(requirements = store.checkout.requirements) {
  const configuredStore = { ...store, checkout: { ...store.checkout, requirements } } as PublicStorefront;
  render(<BookingDrawer store={configuredStore} item={item} variant={variant} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Set test dates' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('reservation details validation', () => {
  it('shows an invalid email beside the field, focuses it into view, and clears it when corrected', async () => {
    openDetails();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'QA Test' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'qa213@invalid' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '12 Test Street' } });

    const email = screen.getByLabelText('Email address');
    const scrollIntoView = vi.fn();
    Object.assign(email, { scrollIntoView });
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));

    expect(await screen.findByText('Enter a valid email address.')).not.toBeNull();
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toBe('booking-email-error');
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });

    fireEvent.change(email, { target: { value: 'still@invalid' } });
    expect(screen.queryByText('Enter a valid email address.')).not.toBeNull();
    fireEvent.change(email, { target: { value: 'qa213@example.com' } });
    expect(screen.queryByText('Enter a valid email address.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    expect(await screen.findByRole('heading', { name: 'Review your request' })).not.toBeNull();
  });

  it('marks every invalid visible customer field and associates each message accessibly', async () => {
    openDetails({ phone: 'required', social_handle: 'required', event_date: 'required' });
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));

    const invalidFields = [
      ['Full name', 'booking-full_name-error'],
      ['Email address', 'booking-email-error'],
      ['Mobile number', 'booking-phone-error'],
      ['Address', 'booking-address-error'],
      ['Instagram or Facebook', 'booking-social_handle-error'],
      ['Event date', 'booking-event_date-error'],
    ] as const;
    expect(invalidFields.map(([label, errorId]) => {
      const input = screen.getByLabelText(label);
      return [input.getAttribute('aria-invalid'), input.getAttribute('aria-describedby'), errorId];
    })).toEqual(invalidFields.map(([, errorId]) => ['true', errorId, errorId]));
    expect(await screen.findByText('Enter your full name.')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'QA Test' } });
    expect(screen.queryByText('Enter your full name.')).toBeNull();
  });
});
