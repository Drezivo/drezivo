'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import type { PublicCategory } from '@drezivo/contracts';

const SORTS = [
  { value: 'featured', label: 'A to Z' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

/** Filters live in the URL so results are shareable, back-button friendly, and rendered on the server. */
export function CatalogControls({ categories, sizes, subcategories }: { categories: PublicCategory[]; sizes: string[]; subcategories: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [subcategoryFilterOpen, setSubcategoryFilterOpen] = useState(false);

  useEffect(() => setSearch(params.get('search') ?? ''), [params]);

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete('page');
    startTransition(() => router.push(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false }));
  }

  const activeCategory = params.get('category');

  return (
    <div className={`transition-opacity ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
      <nav aria-label="Categories" className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <ul className="flex gap-6 whitespace-nowrap border-b border-sf-line text-sm">
          {[{ id: null, name: 'All' }, ...categories].map((category) => {
            const active = (category.id ?? null) === activeCategory;
            return (
              <li key={category.id ?? 'all'}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => apply({ category: category.id })}
                  className={`-mb-px border-b py-3 transition-colors ${active ? 'border-sf-ink text-sf-ink' : 'border-transparent text-sf-muted hover:text-sf-ink'}`}
                >
                  {category.name}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ search: search.trim() || null });
          }}
        >
          <label htmlFor="catalog-search" className="sr-only">
            Search the collection
          </label>
          <input
            id="catalog-search"
            type="search"
            className="sf-input"
            placeholder="Search by name or style"
            maxLength={80}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </form>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-sf-muted">Size</span>
          <select className="sf-input w-auto min-w-28" value={params.get('size') ?? ''} onChange={(event) => apply({ size: event.target.value || null })}>
            <option value="">Any</option>
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-sf-muted">Sort</span>
          <select className="sf-input w-auto" value={params.get('sort') ?? 'featured'} onChange={(event) => apply({ sort: event.target.value === 'featured' ? null : event.target.value })}>
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4">
        <button
          type="button"
          aria-expanded={subcategoryFilterOpen}
          aria-controls="catalog-subcategory-filter"
          onClick={() => setSubcategoryFilterOpen((open) => !open)}
          className="sf-button min-h-10 px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
        >
          {params.get('subcategory') ? `Filter · ${params.get('subcategory')}` : 'Filter'}
        </button>
        {subcategoryFilterOpen ? (
          <div id="catalog-subcategory-filter" className="mt-3 max-w-sm border border-sf-line p-4">
            <label htmlFor="catalog-subcategory" className="flex flex-col gap-2 text-sm">
              <span className="text-sf-muted">Subcategory</span>
              <select
                id="catalog-subcategory"
                className="sf-input"
                value={params.get('subcategory') ?? ''}
                onChange={(event) => apply({ subcategory: event.target.value || null })}
              >
                <option value="">All subcategories</option>
                {subcategories.map((subcategory) => (
                  <option key={subcategory.toLocaleLowerCase()} value={subcategory}>
                    {subcategory}
                  </option>
                ))}
              </select>
            </label>
            {params.get('subcategory') ? (
              <button type="button" className="mt-3 text-sm underline underline-offset-4" onClick={() => apply({ subcategory: null })}>
                Clear subcategory filter
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
