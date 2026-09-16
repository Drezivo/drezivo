import Link from 'next/link';
import { publicApiClient } from '@/lib/api-client';
import { CatalogItemCard } from '@/components/storefront/catalog-item-card';

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL'];
const AVAILABILITY_OPTIONS = ['available', 'reserved', 'rented', 'unavailable'] as const;

interface CatalogPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string;
    category?: string;
    size?: string;
    availability?: string;
    page?: string;
  }>;
}

/**
 * Faceted catalog listing. Filters are plain links (server-rendered query
 * params), not client-side state — a customer can share, bookmark, or go
 * back/forward through a filtered URL, and the page works with JavaScript
 * disabled, which matters on the lower-end Android devices common on
 * Philippine mobile networks.
 */
export default async function CatalogPage({ params, searchParams }: CatalogPageProps) {
  const { slug } = await params;
  const filters = await searchParams;

  const catalog = await publicApiClient.getCatalog(slug, {
    q: filters.q,
    category: filters.category,
    size: filters.size,
    availability: filters.availability,
    page: filters.page,
  });

  function buildFilterHref(next: Partial<typeof filters>) {
    const merged = { ...filters, ...next, page: undefined };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) query.set(key, value);
    }
    const serialized = query.toString();
    return `/s/${slug}/catalog${serialized ? `?${serialized}` : ''}`;
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-sm font-medium uppercase tracking-widest text-accent">Our Collection</p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">
        Clothing Catalog
      </h1>
      <p className="mt-2 text-sm text-muted">{catalog.total} items</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-8">
          <form method="get" action={`/s/${slug}/catalog`}>
            <input type="hidden" name="category" value={filters.category ?? ''} />
            <label htmlFor="catalog-search" className="sr-only">
              Search clothing
            </label>
            <input
              id="catalog-search"
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Search clothing…"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
          </form>

          <div>
            <p className="text-sm font-medium text-foreground">Categories</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link
                  href={buildFilterHref({ category: undefined })}
                  className={!filters.category ? 'font-medium text-accent' : 'text-muted'}
                >
                  All ({catalog.total})
                </Link>
              </li>
              {catalog.categories.map((category) => (
                <li key={category.id}>
                  <Link
                    href={buildFilterHref({ category: category.id })}
                    className={
                      filters.category === category.id ? 'font-medium text-accent' : 'text-muted'
                    }
                  >
                    {category.name} ({category.count})
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">Size</p>
            <ul className="mt-3 flex flex-wrap gap-2 text-sm">
              {SIZE_OPTIONS.map((size) => (
                <li key={size}>
                  <Link
                    href={buildFilterHref({ size: filters.size === size ? undefined : size })}
                    className={`rounded border px-2.5 py-1 ${
                      filters.size === size
                        ? 'border-accent text-accent'
                        : 'border-border text-muted'
                    }`}
                  >
                    {size}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">Availability</p>
            <ul className="mt-3 space-y-2 text-sm">
              {AVAILABILITY_OPTIONS.map((availability) => (
                <li key={availability}>
                  <Link
                    href={buildFilterHref({
                      availability: filters.availability === availability ? undefined : availability,
                    })}
                    className={
                      filters.availability === availability
                        ? 'font-medium text-accent'
                        : 'capitalize text-muted'
                    }
                  >
                    {availability}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div>
          {catalog.items.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {catalog.items.map((item) => (
                <CatalogItemCard key={item.id} storeSlug={slug} item={item} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
              No items match these filters.
            </p>
          )}

          {catalog.total > catalog.pageSize ? (
            <nav
              aria-label="Catalog pages"
              className="mt-8 flex items-center justify-center gap-2 text-sm"
            >
              {Array.from(
                { length: Math.ceil(catalog.total / catalog.pageSize) },
                (_, index) => index + 1,
              ).map((pageNumber) => (
                <Link
                  key={pageNumber}
                  href={buildFilterHref({ page: String(pageNumber) })}
                  className={`rounded border px-3 py-1.5 ${
                    catalog.page === pageNumber
                      ? 'border-accent text-accent'
                      : 'border-border text-muted'
                  }`}
                >
                  {pageNumber}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </div>
    </section>
  );
}
