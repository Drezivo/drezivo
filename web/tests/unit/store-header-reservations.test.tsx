import { render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { PublicStorefront } from '@drezivo/contracts';

vi.mock('next/navigation', () => ({ usePathname: () => '/s/gigis-rental/item/amara' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { StoreHeader } from '@/components/store/store-header';

const baseStore = {
  slug: 'gigis-rental',
  name: "Gigi's Rental",
  content: { announcement: null, sections: { about: false }, about: { body: null } },
  fitting: { enabled: false },
} as unknown as PublicStorefront;

describe('storefront header reservation action', () => {
  it('shows Reserve when online reservations are open', () => {
    render(<StoreHeader store={{ ...baseStore, booking_open: true, reservations_open: true }} />);

    expect(screen.getByRole('link', { name: 'Reserve' }).getAttribute('href')).toBe('/s/gigis-rental/catalog');
  });

  it('hides Reserve when the owner switches reservations off', () => {
    render(<StoreHeader store={{ ...baseStore, booking_open: true, reservations_open: false }} />);

    expect(screen.queryByRole('link', { name: 'Reserve' })).toBeNull();
  });

  it('uses booking_open when an older storefront response omits reservations_open', () => {
    const legacyOpen = { ...baseStore, booking_open: true } as PublicStorefront;
    const { unmount } = render(<StoreHeader store={legacyOpen} />);
    expect(screen.getByRole('link', { name: 'Reserve' })).toBeTruthy();
    unmount();

    const legacyClosed = { ...baseStore, booking_open: false } as PublicStorefront;
    render(<StoreHeader store={legacyClosed} />);
    expect(screen.queryByRole('link', { name: 'Reserve' })).toBeNull();
  });
});
