import { render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { PublicStorefront } from '@drezivo/contracts';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { StoreFooter } from '@/components/store/store-footer';

describe('store footer social links', () => {
  it('links each platform label to the public URL from the storefront response', () => {
    const store = {
      slug: 'luna-rentals',
      name: 'Luna Rentals',
      description: null,
      contact: {
        phone: null,
        email: null,
        address: null,
        instagram_url: 'https://www.instagram.com/luna.gowns/',
        facebook_url: 'https://www.facebook.com/luna-rentals',
        tiktok_url: 'https://www.tiktok.com/@luna.gowns',
      },
      content: { sections: { about: false }, about: { body: null } },
      fitting: { enabled: false },
    } as PublicStorefront;

    render(<StoreFooter store={store} />);

    expect(screen.getByRole('link', { name: 'Instagram' }).getAttribute('href')).toBe(
      store.contact.instagram_url,
    );
    expect(screen.getByRole('link', { name: 'Facebook' }).getAttribute('href')).toBe(
      store.contact.facebook_url,
    );
    expect(screen.getByRole('link', { name: 'TikTok' }).getAttribute('href')).toBe(
      store.contact.tiktok_url,
    );
  });
});
