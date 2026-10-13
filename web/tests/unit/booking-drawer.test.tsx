import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogueVariant, ItemDetail, PublicStorefront } from '@drezivo/contracts';

import { createReservation } from '@/lib/storefront-api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/storefront-api', () => ({
  createReservation: vi.fn(),
  StorefrontApiError: class StorefrontApiError extends Error {},
}));
vi.mock('@/components/store/motion/scroll', () => ({ lockPageScroll: () => () => undefined }));
vi.mock('@/components/store/booking/payment-step', () => ({ PaymentStep: () => null }));
vi.mock('@/components/store/booking/availability-calendar', () => ({
  AvailabilityCalendar: ({
    onChange,
  }: {
    onChange: (range: { start: string; end: string }) => void;
  }) => (
    <button type="button" onClick={() => onChange({ start: '2026-11-11', end: '2026-11-12' })}>
      Set test dates
    </button>
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
    business_hours: { opens_local: '08:00', closes_local: '20:00', closed_weekdays: [] },
  },
  fulfillment: { delivery: false, delivery_fee_minor: '0' },
  payment_methods: [{ id: 'payment-test', name: 'GCash' }],
  policy: { version: 1 },
} as unknown as PublicStorefront;

function openDetails(requirements = store.checkout.requirements) {
  const configuredStore = {
    ...store,
    checkout: { ...store.checkout, requirements },
  } as PublicStorefront;
  render(<BookingDrawer store={configuredStore} item={item} variant={variant} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Set test dates' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('reservation details validation', () => {
  beforeEach(() => {
    vi.mocked(createReservation).mockReset();
    vi.mocked(createReservation).mockResolvedValue({ reservation: {} as never } as never);
  });

  it('shows an invalid email beside the field, focuses it into view, and clears it when corrected', async () => {
    openDetails();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'QA Test' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'qa213@invalid' },
    });
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
    expect(
      invalidFields.map(([label, errorId]) => {
        const input = screen.getByLabelText(label);
        return [
          input.getAttribute('aria-invalid'),
          input.getAttribute('aria-describedby'),
          errorId,
        ];
      }),
    ).toEqual(invalidFields.map(([, errorId]) => ['true', errorId, errorId]));
    expect(await screen.findByText('Enter your full name.')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'QA Test' } });
    expect(screen.queryByText('Enter your full name.')).toBeNull();
  });

  it('offers shop-hour pickup times and sends the same chosen time for pickup and return', async () => {
    openDetails();

    expect(screen.queryByRole('radio', { name: /Delivery/ })).toBeNull();
    const pickupTime = screen.getByRole('button', { name: 'Pickup time 10:00 AM' });
    expect(pickupTime.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(pickupTime);
    expect(pickupTime.getAttribute('aria-expanded')).toBe('true');
    const timeGrid = screen.getByRole('group', { name: 'Available pickup times' });
    const timeOptions = within(timeGrid).getAllByRole('button');
    expect(timeGrid.querySelector('.grid-cols-2')).not.toBeNull();
    expect(timeOptions.slice(0, 4).map((option) => option.getAttribute('aria-label'))).toEqual([
      '8:00 AM',
      '8:30 AM',
      '9:00 AM',
      '9:30 AM',
    ]);
    expect(timeOptions.at(-1)?.getAttribute('aria-label')).toBe('7:30 PM');
    expect(screen.getByRole('button', { name: '10:00 AM' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '11:30 AM' }));
    expect(pickupTime.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(pickupTime);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'qa@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'QA Customer' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '12 Test Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));

    expect(await screen.findByText(/Nov 11, 2026 · 11:30 AM/)).not.toBeNull();
    expect(screen.getByText(/Nov 12, 2026 · 11:30 AM/)).not.toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Hold my size and pay' }));

    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(vi.mocked(createReservation).mock.calls[0]?.[1]).toMatchObject({
      requested_interval: {
        start: '2026-11-11T11:30:00+08:00',
        end: '2026-11-12T11:30:00+08:00',
      },
      fulfillment_method: 'pickup',
    });
  });

  it('supports keyboard selection and Escape dismissal for pickup times', async () => {
    const user = userEvent.setup();
    openDetails();
    const pickupTime = screen.getByRole('button', { name: 'Pickup time 10:00 AM' });

    pickupTime.focus();
    await user.keyboard('{Enter}');
    expect(pickupTime.getAttribute('aria-expanded')).toBe('true');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '8:00 AM' }));
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Pickup time 8:00 AM' }).getAttribute('aria-expanded')).toBe('false');
    const updatedTrigger = screen.getByRole('button', { name: 'Pickup time 8:00 AM' });
    updatedTrigger.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(updatedTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(updatedTrigger);
  });

  it('offers delivery only when enabled and keeps its fee separate from the rental total', async () => {
    const configuredStore = {
      ...store,
      fulfillment: { pickup: true, delivery: true, delivery_fee_minor: '15000' },
    } as PublicStorefront;
    render(
      <BookingDrawer store={configuredStore} item={item} variant={variant} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set test dates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('How would you like to receive your rental?')).not.toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Delivery · arranged with the shop' }));
    expect(screen.queryByRole('button', { name: /Pickup time/ })).toBeNull();
    expect(
      screen.getByText(
        'The shop will contact you to arrange delivery and any delivery fee. It is not part of this total.',
      ),
    ).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'qa@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'QA Customer' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '12 Test Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));

    expect(await screen.findByText('Arranged separately with the shop')).not.toBeNull();
    expect(screen.getByText('₱1,100')).not.toBeNull();
    expect(screen.queryByText('₱1,250')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Hold my size and pay' }));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(vi.mocked(createReservation).mock.calls[0]?.[1]).toMatchObject({
      requested_interval: {
        start: '2026-11-11T10:00:00+08:00',
        end: '2026-11-12T10:00:00+08:00',
      },
      fulfillment_method: 'delivery',
    });
  });
});
