import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { catalogueQuery } from '@drezivo/contracts';

import { CatalogControls } from '@/components/store/catalog-controls';
import { ProductGrid } from '@/components/store/product-card';
import { readCatalogue, readStore } from '@/lib/storefront-preview';

export const metadata: Metadata = { title: 'Collection' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CatalogPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const { slug } = await params;
  const raw = await searchParams;
  const store = await readStore(slug);
  if (!store) notFound();

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  // Invalid filters from a hand-edited URL fall back to the defaults instead of erroring.
  const parsed = catalogueQuery.safeParse({
    search: first(raw['search']),
    category: first(raw['category']),
    subcategory: first(raw['subcategory']),
    size: first(raw['size']),
    sort: first(raw['sort']),
    page: first(raw['page']),
  });
  const query = parsed.success ? parsed.data : catalogueQuery.parse({});
  const result = await readCatalogue(slug, {
    search: query.search,
    category: query.category,
    subcategory: query.subcategory,
    size: query.size,
    sort: query.sort,
    page: String(query.page),
    page_size: String(query.page_size),
  });
  const pages = Math.max(1, Math.ceil(result.total / result.page_size));
  const category = store.categories.find((entry) => entry.id === query.category);
  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    for (const key of ['search', 'category', 'subcategory', 'size', 'sort'] as const) {
      const value = first(raw[key]);
      if (value) next.set(key, value);
    }
    if (page > 1) next.set('page', String(page));
    return `/s/${slug}/catalog${next.toString() ? `?${next.toString()}` : ''}`;
  };

  return (
    <div className="mx-auto max-w-7xl px-5 pb-8 pt-12 sm:px-8 sm:pt-16">
      <header className="mb-10">
        <h1 className="font-sf-display text-5xl font-light sm:text-6xl">{category?.name ?? 'The collection'}</h1>
        <p className="mt-3 text-sf-muted" aria-live="polite">
          {result.total === 1 ? '1 piece' : `${result.total} pieces`}
          {query.search ? ` matching “${query.search}”` : ''}
        </p>
      </header>

      <Suspense>
        <CatalogControls categories={store.categories} sizes={result.sizes} subcategories={result.subcategories ?? []} />
      </Suspense>

      <div className="mt-10">
        {result.items.length > 0 ? (
          <ProductGrid slug={slug} items={result.items} priorityCount={4} />
        ) : (
          <div className="border border-sf-line px-6 py-16 text-center">
            <p className="font-sf-display text-2xl">Nothing matches those filters.</p>
            <Link href={`/s/${slug}/catalog`} className="mt-4 inline-block text-sm underline underline-offset-4">
              Clear filters
            </Link>
          </div>
        )}
      </div>

      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-14 flex items-center justify-center gap-2 text-sm">
          {Array.from({ length: pages }, (_, index) => index + 1).map((page) => (
            <Link
              key={page}
              href={pageHref(page)}
              aria-current={page === query.page ? 'page' : undefined}
              className={`flex h-10 min-w-10 items-center justify-center border px-3 tabular-nums ${page === query.page ? 'border-sf-ink' : 'border-transparent text-sf-muted hover:text-sf-ink'}`}
            >
              {page}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
