import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ReservationConfirmationDetails } from '@/components/booking/reservation-confirmation-details';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, ...imageProps } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imageProps} alt={String(imageProps.alt ?? '')} />;
  },
}));

type ConfirmationProps = ComponentProps<typeof ReservationConfirmationDetails>;

const STORE = {
  slug: 'luxe-rentals',
  displayName: 'LuxeRentals',
  contactEmail: 'hello@example.test',
  contactPhone: '+63 900 000 0000',
} as ConfirmationProps['store'];

const SUMMARY = {
  referenceNumber: 'RV-2026-10482',
  status: 'pending_confirmation',
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
    status: 'under_review',
    reference: 'PAY-10482',
  },
  pricing: {
    rentalFeeDecimal: '3500.00',
    securityDepositDecimal: '5000.00',
    totalDecimal: '8500.00',
  },
} as ConfirmationProps['summary'];

describe('ReservationConfirmationDetails', () => {
  it('renders the submitted reservation summary without unsupported completion claims', () => {
    const view = render(<ReservationConfirmationDetails store={STORE} summary={SUMMARY} />);

    expect(view.getByRole('heading', { name: 'Reservation Received' })).toBeTruthy();
    expect(view.getByText('Reservation #RV-2026-10482')).toBeTruthy();
    expect(view.getByText('Pending Confirmation')).toBeTruthy();
    expect(view.getByText('Under Review')).toBeTruthy();
    expect(view.getByText('₱8,500')).toBeTruthy();
    expect(view.queryByText(/email has been sent/i)).toBeNull();
    expect(view.queryByText(/paid/i)).toBeNull();
  });

  it('omits add-ons and discounts from the current confirmation surface', () => {
    const view = render(<ReservationConfirmationDetails store={STORE} summary={SUMMARY} />);

    expect(view.queryByText(/add-ons/i)).toBeNull();
    expect(view.queryByText(/discount/i)).toBeNull();
    expect(view.getByRole('link', { name: 'Contact Business →' }).getAttribute('href')).toBe(
      'mailto:hello@example.test',
    );
  });
});
