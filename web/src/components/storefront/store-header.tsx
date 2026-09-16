import Link from 'next/link';
import type { PublicStoreProjection } from '@drezivo/contracts';

/**
 * Header for one tenant storefront. Only fields the tenant published on
 * `store` are ever rendered — never fall back to an internal/unpublished
 * field, since this component has no way to tell whether a caller
 * accidentally passed one through.
 */
export function StoreHeader({ store }: { store: PublicStoreProjection }) {
  const basePath = `/s/${store.slug}`;

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href={basePath} className="font-display text-xl font-semibold text-foreground">
          {store.displayName}
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          <Link href={basePath} className="text-sm text-muted hover:text-foreground">
            Home
          </Link>
          <Link href={`${basePath}/catalog`} className="text-sm text-muted hover:text-foreground">
            Catalog
          </Link>
          <Link href={`${basePath}/policies`} className="text-sm text-muted hover:text-foreground">
            Policies
          </Link>
        </nav>
      </div>
    </header>
  );
}
