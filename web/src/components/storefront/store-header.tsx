import Link from 'next/link';

import type { publicApiClient } from '@/lib/api-client';
import { StorefrontBrand } from './storefront-brand';

type PublicStoreProjection = NonNullable<Awaited<ReturnType<typeof publicApiClient.getStore>>>;

/** Header for a published tenant storefront. */
export function StoreHeader({ store }: { store: PublicStoreProjection }) {
  const basePath = `/s/${store.slug}`;

  return (
    <header className="sticky top-0 z-40 border-b border-storefront-line bg-storefront-paper/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-6 px-4 sm:px-10 lg:px-20">
        <StorefrontBrand href={basePath} name={store.displayName} />

        <nav aria-label="Storefront navigation" className="hidden items-center gap-8 lg:flex">
          <StorefrontNavLink href={basePath}>Home</StorefrontNavLink>
          <StorefrontNavLink href={`${basePath}/catalog`}>Catalog</StorefrontNavLink>
          <StorefrontNavLink href={`${basePath}#categories`}>Categories</StorefrontNavLink>
          <StorefrontNavLink href={`${basePath}#about`}>About</StorefrontNavLink>
          <StorefrontNavLink href={`${basePath}/policies`}>Rental Info</StorefrontNavLink>
          <StorefrontNavLink href={`${basePath}#contact`}>Contact</StorefrontNavLink>
        </nav>

        <div className="flex items-center gap-2 lg:hidden">
          <Link
            href={`${basePath}/catalog`}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-storefront-ink hover:bg-storefront-soft"
          >
            Catalog
          </Link>
          <Link
            href={`${basePath}/policies`}
            className="hidden min-h-11 items-center rounded-md px-3 text-sm font-medium text-storefront-ink hover:bg-storefront-soft sm:inline-flex"
          >
            Rental Info
          </Link>
        </div>
      </div>
    </header>
  );
}

function StorefrontNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center border-b-2 border-transparent px-1 text-sm font-medium text-storefront-ink transition hover:border-storefront-brand hover:text-storefront-brand"
    >
      {children}
    </Link>
  );
}
