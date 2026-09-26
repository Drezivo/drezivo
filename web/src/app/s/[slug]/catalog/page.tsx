import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CatalogItemCard } from '@/components/storefront/catalog-item-card';
import { publicApiClient } from '@/lib/api-client';

type StoreProjection = NonNullable<Awaited<ReturnType<typeof publicApiClient.getStore>>>;
type CatalogItemSummary = Awaited<ReturnType<typeof publicApiClient.getCatalog>>['items'][number];

interface CatalogPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string;
    category?: string;
    size?: string;
    page?: string;
  }>;
}

/** Server-rendered tenant catalogue matching the approved storefront reference. */
export default async function CatalogPage({ params, searchParams }: CatalogPageProps) {
  const { slug } = await params;
  const filters = await searchParams;
  const store = await publicApiClient.getStore(slug);

  if (!store) {
    notFound();
  }

  const catalog = await publicApiClient.getCatalog(slug, {
    q: filters.q,
    category: filters.category,
    size: filters.size,
    page: filters.page,
  });
  const sizeOptions = getSizeOptions(catalog.items, filters.size);
  const totalPages = Math.max(1, Math.ceil(catalog.total / catalog.pageSize));
  const paginationPages = getPaginationPages(catalog.page, totalPages);

  function buildFilterHref(next: Partial<typeof filters>) {
    const merged = { ...filters, ...next, page: undefined };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) query.set(key, value);
    }
    const serialized = query.toString();
    return `/s/${slug}/catalog${serialized ? `?${serialized}` : ''}`;
  }

  function buildPageHref(page: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value && key !== 'page') query.set(key, value);
    }
    query.set('page', String(page));
    return `/s/${slug}/catalog?${query.toString()}`;
  }

  return (
    <>
      <section className="relative overflow-hidden bg-storefront-hero">
        <div className="mx-auto grid min-h-52 max-w-7xl lg:grid-cols-2">
          <div className="relative z-10 flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-20">
            <p className="text-xs font-semibold uppercase tracking-widest text-storefront-brand">
              Our Collection
            </p>
            <h1 className="mt-3 font-display text-4xl font-semibold text-storefront-brand sm:text-5xl">
              Clothing Catalog
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-storefront-ink">
              Browse the complete collection of rental dresses, gowns, and formal wear from{' '}
              {store.displayName}.
            </p>
          </div>

          <div className="relative min-h-52 bg-storefront-soft">
            {store.coverImageUrl ? (
              <Image
                src={store.coverImageUrl}
                alt=""
                fill
                priority
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover object-center"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-r from-storefront-hero via-storefront-hero/40 to-transparent lg:-left-20" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-8 sm:px-10 lg:px-20">
        <div className="grid gap-7 lg:grid-cols-4 xl:grid-cols-5">
          <aside className="self-start overflow-hidden rounded-md border border-storefront-line bg-storefront-paper shadow-storefront-card lg:col-span-1">
            <form
              method="get"
              action={`/s/${slug}/catalog`}
              className="border-b border-storefront-line p-3"
            >
              <input type="hidden" name="category" value={filters.category ?? ''} />
              <input type="hidden" name="size" value={filters.size ?? ''} />
              <label htmlFor="catalog-search" className="sr-only">
                Search clothing
              </label>
              <div className="relative">
                <SearchIcon />
                <input
                  id="catalog-search"
                  type="search"
                  name="q"
                  defaultValue={filters.q}
                  placeholder="Search clothing..."
                  className="min-h-11 w-full rounded-md border border-storefront-line bg-storefront-paper py-2 pl-9 pr-3 text-sm text-storefront-ink placeholder:text-storefront-muted focus:border-storefront-brand"
                />
              </div>
            </form>

            <FilterSection title="Categories">
              <ul className="space-y-1 text-sm">
                <li>
                  <FilterLink
                    href={buildFilterHref({ category: undefined })}
                    isActive={!filters.category}
                    label="All"
                    count={catalog.total}
                  />
                </li>
                {catalog.categories.map((category: StoreProjection['categories'][number]) => (
                  <li key={category.id}>
                    <FilterLink
                      href={buildFilterHref({ category: category.id })}
                      isActive={filters.category === category.id}
                      label={category.name}
                      count={category.count}
                    />
                  </li>
                ))}
              </ul>
            </FilterSection>

            {sizeOptions.length > 0 ? (
              <FilterSection title="Size" className="border-t border-storefront-line">
                <ul className="space-y-2.5 text-sm">
                  {sizeOptions.map((size) => {
                    const isActive = filters.size === size;
                    return (
                      <li key={size}>
                        <Link
                          href={buildFilterHref({ size: isActive ? undefined : size })}
                          className="flex min-h-7 items-center gap-2 text-storefront-muted transition hover:text-storefront-brand"
                        >
                          <span
                            aria-hidden="true"
                            className={`grid h-4 w-4 place-items-center rounded-sm border text-xs ${
                              isActive
                                ? 'border-storefront-brand bg-storefront-brand text-storefront-paper'
                                : 'border-storefront-line bg-storefront-paper'
                            }`}
                          >
                            {isActive ? '✓' : ''}
                          </span>
                          <span className={isActive ? 'font-semibold text-storefront-brand' : ''}>
                            {size}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </FilterSection>
            ) : null}
          </aside>

          <div className="min-w-0 lg:col-span-3 xl:col-span-4">
            <div className="mb-5 flex min-h-11 items-center justify-between gap-4">
              <p className="text-sm font-semibold text-storefront-ink">
                {catalog.total} {catalog.total === 1 ? 'item' : 'items'}
              </p>

              {(filters.q || filters.category || filters.size) && (
                <Link
                  href={`/s/${slug}/catalog`}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-storefront-brand hover:underline"
                >
                  Clear filters
                </Link>
              )}
            </div>

            {catalog.items.length > 0 ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {catalog.items.map((item: CatalogItemSummary) => (
                  <CatalogItemCard key={item.id} storeSlug={slug} item={item} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-storefront-line bg-storefront-paper px-8 py-16 text-center">
                <h2 className="font-display text-xl font-semibold text-storefront-ink">
                  No clothing found
                </h2>
                <p className="mt-2 text-sm text-storefront-muted">
                  Try another search, category, or size.
                </p>
                <Link
                  href={`/s/${slug}/catalog`}
                  className="mt-5 inline-flex min-h-11 items-center rounded-md bg-storefront-brand px-5 text-sm font-semibold text-storefront-paper"
                >
                  View All Clothing
                </Link>
              </div>
            )}

            {totalPages > 1 ? (
              <nav
                aria-label="Catalog pages"
                className="mt-8 flex items-center justify-center gap-1.5 text-sm"
              >
                <PaginationArrow
                  href={catalog.page > 1 ? buildPageHref(catalog.page - 1) : undefined}
                  label="Previous page"
                  direction="previous"
                />
                {paginationPages.map((pageNumber) => (
                  <Link
                    key={pageNumber}
                    href={buildPageHref(pageNumber)}
                    aria-current={catalog.page === pageNumber ? 'page' : undefined}
                    className={`grid h-9 min-w-9 place-items-center rounded-md px-2 font-semibold transition ${
                      catalog.page === pageNumber
                        ? 'bg-storefront-brand text-storefront-paper'
                        : 'text-storefront-ink hover:bg-storefront-soft'
                    }`}
                  >
                    {pageNumber}
                  </Link>
                ))}
                <PaginationArrow
                  href={catalog.page < totalPages ? buildPageHref(catalog.page + 1) : undefined}
                  label="Next page"
                  direction="next"
                />
              </nav>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}

function FilterSection({
  title,
  className = '',
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`p-3 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold text-storefront-ink">{title}</h2>
      {children}
    </section>
  );
}

function FilterLink({
  href,
  isActive,
  label,
  count,
}: {
  href: string;
  isActive: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-8 items-center justify-between gap-3 rounded-sm px-2 transition ${
        isActive
          ? 'bg-storefront-soft font-semibold text-storefront-brand'
          : 'text-storefront-muted hover:bg-storefront-soft hover:text-storefront-brand'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {isActive ? (
          <span
            aria-hidden="true"
            className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-storefront-brand text-xs text-storefront-paper"
          >
            ✓
          </span>
        ) : null}
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-xs text-storefront-muted">{count}</span>
    </Link>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-storefront-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="6" />
      <path strokeLinecap="round" d="m16 16 4 4" />
    </svg>
  );
}

function PaginationArrow({
  href,
  label,
  direction,
}: {
  href?: string;
  label: string;
  direction: 'previous' | 'next';
}) {
  const content = direction === 'previous' ? '‹' : '›';
  const className =
    'grid h-9 w-9 place-items-center rounded-md border border-storefront-line bg-storefront-paper text-lg text-storefront-ink';

  if (!href) {
    return (
      <span aria-hidden="true" className={`${className} opacity-40`}>
        {content}
      </span>
    );
  }

  return (
    <Link href={href} aria-label={label} className={`${className} hover:bg-storefront-soft`}>
      {content}
    </Link>
  );
}

function getSizeOptions(items: CatalogItemSummary[], selectedSize?: string): string[] {
  const sizes = new Set(items.flatMap((item) => item.sizes));
  if (selectedSize) sizes.add(selectedSize);

  const commonOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL'];
  return [...sizes].sort((left, right) => {
    const leftIndex = commonOrder.indexOf(left.toUpperCase());
    const rightIndex = commonOrder.indexOf(right.toUpperCase());
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

function getPaginationPages(currentPage: number, totalPages: number): number[] {
  const visibleCount = Math.min(5, totalPages);
  const half = Math.floor(visibleCount / 2);
  const start = Math.min(Math.max(1, currentPage - half), totalPages - visibleCount + 1);
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}
