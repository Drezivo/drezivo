import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ReservationReview } from '@/components/booking/reservation-review';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, ...imageProps } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imageProps} alt={String(imageProps.alt ?? '')} />;
  },
}));

vi.mock('@/lib/capability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capability')>();
  return {
    ...actual,
    confirmGuestReservation: vi.fn(),
  };
});

type Summary = ComponentProps<typeof ReservationReview>['summary'];

const SUMMARY = {
  referenceNumber: 'RV-2026-10482',
  status: 'held',
  item: {
    name: 'Black Gown',
    size: 'M',
    imageUrl: '/black-gown.jpg',
  },
  pickupDate: '2026-09-10',
  returnDate: '2026-09-13',
  customer: {
    fullName: 'Maria Santos',
    phone: '+63 912 345 6789',
    email: 'maria@example.test',
  },
  pickup: {
    method: 'self_pickup',
    location: 'LuxeRentals Store',
  },
  payment: {
    status: 'awaiting_upload',
    reference: null,
  },
  pricing: {
    rentalFeeDecimal: '3500.00',
    securityDepositDecimal: '5000.00',
    addOnsDecimal: '0.00',
    discountDecimal: '0.00',
    totalDecimal: '8500.00',
  },
} as Summary;

describe('ReservationReview', () => {
  it('renders the storefront review sections and server-derived total', () => {
    const view = render(
      <ReservationReview
        storeSlug="luxe-rentals"
        itemId="product-1"
        reservationId="reservation-1"
        summary={SUMMARY}
      />,
    );

    expect(view.getByRole('heading', { name: 'Review Your Reservation' })).toBeTruthy();
    expect(view.getByText('Clothing Details')).toBeTruthy();
    expect(view.getByText('Customer Information')).toBeTruthy();
    expect(view.getByText('Pickup / Delivery')).toBeTruthy();
    expect(view.getByText('Rental Summary')).toBeTruthy();
    expect(view.getByText('₱8,500.00')).toBeTruthy();
  });

  it('omits add-ons, discounts, and SMS promises from the review surface', () => {
    const view = render(
      <ReservationReview
        storeSlug="luxe-rentals"
        itemId="product-1"
        reservationId="reservation-1"
        summary={SUMMARY}
      />,
    );

    expect(view.queryByText(/Add-ons/i)).toBeNull();
    expect(view.queryByText(/Discount/i)).toBeNull();
    expect(view.queryByText(/SMS/i)).toBeNull();
    expect(view.getByText(/reviewed by the business/i)).toBeTruthy();
  });
});
