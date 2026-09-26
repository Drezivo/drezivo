import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CustomerDetailsForm } from '@/components/booking/customer-details-form';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, ...imageProps } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imageProps} alt={String(imageProps.alt ?? '')} />;
  },
}));

const DEFAULT_PROPS = {
  storeSlug: 'luxe-rentals',
  itemId: 'product-1',
  reservationId: 'reservation-1',
  itemName: 'Black Gown',
  itemCategory: 'Gown',
  itemImageUrl: '/black-gown.jpg',
  selectedSize: 'M',
  pickupDate: '2026-09-10',
  returnDate: '2026-09-13',
  rentalUnitLabel: '3 days',
  rentalFeeDecimal: '3500.00',
  securityDepositDecimal: '5000.00',
  totalDecimal: '8500.00',
};

describe('CustomerDetailsForm', () => {
  it('renders the supported customer, fulfillment, rental, payment, and summary sections', () => {
    const view = render(<CustomerDetailsForm {...DEFAULT_PROPS} />);

    expect(view.getByRole('heading', { name: 'Reservation Details' })).toBeTruthy();
    expect(view.getByText('Your Information')).toBeTruthy();
    expect(view.getByText('Pickup / Delivery Method')).toBeTruthy();
    expect(view.getByText('Rental Dates')).toBeTruthy();
    expect(view.getByText('Payment Method')).toBeTruthy();
    expect(view.getByText('Summary')).toBeTruthy();
    expect(view.getByText('₱8,500.00')).toBeTruthy();
  });

  it('omits add-ons, penalties, discounts, verification, and receipt controls', () => {
    const view = render(<CustomerDetailsForm {...DEFAULT_PROPS} />);

    expect(view.queryByText(/Add-ons & Penalties/i)).toBeNull();
    expect(view.queryByText(/Additional Accessories/i)).toBeNull();
    expect(view.queryByText(/Discount/i)).toBeNull();
    expect(view.queryByText(/Verification Required/i)).toBeNull();
    expect(view.queryByText(/Upload ID/i)).toBeNull();
    expect(view.queryByText(/Payment Receipt/i)).toBeNull();
  });
});
