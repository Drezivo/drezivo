import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CatalogItemCard } from '@/components/storefront/catalog-item-card';

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

describe('CatalogItemCard', () => {
  it('links the catalogue card to the tenant item detail route', () => {
    const view = render(<CatalogItemCard storeSlug="luxe-rentals" item={ITEM} />);

    expect(view.getByRole('link', { name: /Blush Elegance Gown/i }).getAttribute('href')).toBe(
      '/s/luxe-rentals/items/product-1',
    );
  });

  it('renders server-provided price, sizes, and availability', () => {
    const view = render(<CatalogItemCard storeSlug="luxe-rentals" item={ITEM} />);

    expect(view.getByText('₱3,500.00 / 3 days')).toBeTruthy();
    expect(view.getByText('M')).toBeTruthy();
    expect(view.getAllByText('Available').length).toBeGreaterThan(0);
  });
});
