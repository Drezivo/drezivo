import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoldDateSelector } from '@/components/booking/hold-date-selector';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { unavailableDates: ['2026-09-11'] } }),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, ...imageProps } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imageProps} alt={String(imageProps.alt ?? '')} />;
  },
}));

type Item = ComponentProps<typeof HoldDateSelector>['item'];

const ITEM = {
  id: 'product-1',
  variantId: 'variant-1',
  categoryId: 'gowns',
  name: 'Black Gown',
  categoryName: 'Gown',
  primaryImageUrl: '/black-gown.jpg',
  availabilityStatus: 'available',
  description: 'Formal black gown',
  images: ['/black-gown.jpg'],
  sizes: ['S', 'M', 'L'],
  measurements: [],
  priceDecimal: '3500.00',
  securityDepositDecimal: '5000.00',
  rentalUnitLabel: '3 days',
  rentalDurationDays: 3,
} as Item;

describe('HoldDateSelector calendar states', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 1, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
    push.mockReset();
  });

  it('uses gold only for selected dates and red for unavailable dates', () => {
    const view = render(<HoldDateSelector storeSlug="luxe-rentals" item={ITEM} size="M" />);

    const selectedStart = view.getByRole('button', { name: 'Sep 10, 2026' });
    const unavailable = view.getByRole('button', { name: 'Sep 11, 2026, not available' });
    const neutral = view.getByRole('button', { name: 'Sep 20, 2026' });

    expect(neutral.className).toContain('bg-transparent');
    expect(unavailable.className).toContain('bg-storefront-unavailable');

    selectedStart.click();

    expect(view.getByRole('button', { name: 'Sep 10, 2026, selected' }).className).toContain(
      'bg-storefront-selected',
    );
  });

  it('labels the legend as Selected instead of Available', () => {
    const view = render(<HoldDateSelector storeSlug="luxe-rentals" item={ITEM} size="M" />);

    expect(view.getByText('Selected')).toBeTruthy();
    expect(view.queryByText('Available')).toBeNull();
    expect(view.getByText('Not Available')).toBeTruthy();
  });
});
