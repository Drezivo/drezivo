import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productId, productVariantId, type CatalogueCard, type ItemDetail, type PublicStorefront } from '@drezivo/contracts';

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/s/test-shop/catalog',
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { CatalogControls } from '@/components/store/catalog-controls';
import { ItemView } from '@/components/store/item-view';
import { ProductCard } from '@/components/store/product-card';
import { PreviewProvider } from '@/components/store/preview-context';

const card: CatalogueCard = {
  product_id: productId.parse('00000000-0000-4000-8000-000000000001'),
  name: 'Tea Dress',
  category: 'Dresses',
  subcategory: 'MINI',
  image_url: null,
  price_from_minor: '30000',
  pricing_mode: 'daily',
  included_duration_minutes: 1440,
  sizes: ['S', 'M'],
};

const item: ItemDetail = {
  product_id: card.product_id,
  name: card.name,
  description: null,
  category: 'Dresses',
  subcategory: 'MINI',
  image_urls: [],
  variants: [{
    variant_id: productVariantId.parse('00000000-0000-4000-8000-000000000002'),
    size_label: null,
    color_label: null,
    rental_price_minor: '30000',
    security_deposit_minor: '0',
    pricing_mode: 'daily',
    included_duration_minutes: 1440,
    extra_day_price_minor: '0',
    measurement: { mode: 'none' },
  }],
};

const store = {
  slug: 'test-shop',
  name: 'Test Shop',
  payment_methods: [],
  booking_open: false,
  fitting: { enabled: false },
} as unknown as PublicStorefront;

describe('storefront product subcategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = '';
  });

  it('shows the subcategory on product cards and item details', () => {
    const { rerender } = render(<ProductCard slug="test-shop" item={card} />);
    expect(screen.getByText(/Dresses — MINI — S · M/).textContent).toContain('Dresses — MINI — S · M');

    rerender(
      <PreviewProvider preview={false}>
        <ItemView store={store} item={item} />
      </PreviewProvider>,
    );
    expect(screen.getByText('Dresses · MINI').textContent).toBe('Dresses · MINI');
  });

  it('shows a nonblank product description below the name and keeps the remaining information tabs', () => {
    const description = 'An elegant dress.\nLightweight satin.';
    render(
      <PreviewProvider preview={false}>
        <ItemView store={store} item={{ ...item, description }} />
      </PreviewProvider>,
    );

    const name = screen.getByRole('heading', { name: item.name });
    const descriptionText = screen.getByText(/An elegant dress\./);
    expect(name.nextElementSibling).toBe(descriptionText);
    expect(descriptionText.textContent).toBe(description);
    expect(descriptionText.classList.contains('whitespace-pre-line')).toBe(true);
    expect(screen.queryByRole('tab', { name: 'Details' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Measurements' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'Rental info' })).not.toBeNull();
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['whitespace-only', ' \n\t '],
  ])('omits the description block for a %s description', (_label, description) => {
    render(
      <PreviewProvider preview={false}>
        <ItemView store={store} item={{ ...item, description }} />
      </PreviewProvider>,
    );

    const name = screen.getByRole('heading', { name: item.name });
    expect(name.nextElementSibling?.textContent?.trim().startsWith('₱300')).toBe(true);
  });

  it('filters by the published subcategory options and preserves other URL filters', () => {
    navigation.search = 'search=lace&category=00000000-0000-4000-8000-000000000009&size=M&page=3';
    render(<CatalogControls categories={[]} sizes={['M']} subcategories={['LONG', 'MINI']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Subcategory' }), { target: { value: 'MINI' } });

    const [href] = navigation.push.mock.calls[0] as [string];
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('subcategory')).toBe('MINI');
    expect(params.get('search')).toBe('lace');
    expect(params.get('category')).toBe('00000000-0000-4000-8000-000000000009');
    expect(params.get('size')).toBe('M');
    expect(params.has('page')).toBe(false);
  });

  it('clears only the subcategory filter and preserves the other filters', () => {
    navigation.search = 'subcategory=MINI&sort=newest&size=S';
    render(<CatalogControls categories={[]} sizes={['S']} subcategories={['MINI']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter · MINI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear subcategory filter' }));

    const [href] = navigation.push.mock.calls[0] as [string];
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.has('subcategory')).toBe(false);
    expect(params.get('sort')).toBe('newest');
    expect(params.get('size')).toBe('S');
  });
});
