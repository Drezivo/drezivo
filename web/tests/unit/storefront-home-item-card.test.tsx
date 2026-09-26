import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StorefrontHomeItemCard } from '@/components/storefront/storefront-home-item-card';

const ITEM = {
  id: 'product-1',
  name: 'Blush Elegance Gown',
  categoryName: 'Gown',
  primaryImageUrl: '/test-dress.jpg',
  availabilityStatus: 'available',
  priceDecimal: '3500.00',
  rentalUnitLabel: '3 days',
  sizes: ['S', 'M', 'L'],
} as const;

describe('StorefrontHomeItemCard', () => {
  it('links the compact card to the tenant item detail page', () => {
    const view = render(<StorefrontHomeItemCard storeSlug="luxe-rentals" item={ITEM} />);

    expect(view.getByRole('link', { name: /Blush Elegance Gown/i }).getAttribute('href')).toBe(
      '/s/luxe-rentals/items/product-1',
    );
  });

  it('renders the server-provided rental amount and unit', () => {
    const view = render(<StorefrontHomeItemCard storeSlug="luxe-rentals" item={ITEM} />);

    expect(view.getByText('₱3,500.00 / 3 days')).toBeTruthy();
  });

  it('does not expose operational availability labels on the homepage card', () => {
    const view = render(<StorefrontHomeItemCard storeSlug="luxe-rentals" item={ITEM} />);

    expect(view.queryByText('Available')).toBeNull();
  });
});
