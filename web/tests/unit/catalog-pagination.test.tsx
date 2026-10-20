import { render, screen, within } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CatalogPagination, pageWindow } from '@/components/store/catalog-pagination';

const hrefFor = (page: number) => `/s/gigis/catalog?page=${page}`;

describe('storefront catalog pagination', () => {
  it('shows every page for short collections and a bounded window for long ones', () => {
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 12)).toEqual([1, 2, 3, 4, 'gap', 12]);
    expect(pageWindow(6, 12)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12]);
    expect(pageWindow(12, 12)).toEqual([1, 'gap', 9, 10, 11, 12]);
    // One skipped page is shown as its number rather than "…".
    expect(pageWindow(4, 12)).toEqual([1, 2, 3, 4, 5, 'gap', 12]);
    for (let page = 1; page <= 40; page += 1) {
      expect(pageWindow(page, 40).length).toBeLessThanOrEqual(7);
    }
  });

  it('never renders one link per page for a long collection', () => {
    render(<CatalogPagination page={6} pages={12} hrefFor={hrefFor} />);
    const nav = screen.getByRole('navigation', { name: 'Pages' });

    expect(within(nav).getAllByRole('link', { name: /^Page \d+$/ })).toHaveLength(5);
    expect(within(nav).getByText('Page 6 of 12')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Previous page' })).toHaveAttribute('href', hrefFor(5));
    expect(within(nav).getByRole('link', { name: 'Next page' })).toHaveAttribute('href', hrefFor(7));
    expect(within(nav).getByRole('link', { name: 'Page 12' })).toHaveAttribute('href', hrefFor(12));
  });

  it('has no Previous on the first page, no Next on the last, and nothing for one page', () => {
    const { rerender } = render(<CatalogPagination page={1} pages={3} hrefFor={hrefFor} />);
    expect(screen.queryByRole('link', { name: 'Previous page' })).toBeNull();
    rerender(<CatalogPagination page={3} pages={3} hrefFor={hrefFor} />);
    expect(screen.queryByRole('link', { name: 'Next page' })).toBeNull();
    rerender(<CatalogPagination page={1} pages={1} hrefFor={hrefFor} />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
