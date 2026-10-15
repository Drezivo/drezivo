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
  const hasSubcategories = subcategories.length > 0;

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

      <div
        className={`mt-6 grid min-w-0 gap-3 sm:grid-cols-2 ${
          hasSubcategories
            ? 'lg:grid-cols-[minmax(0,1fr)_9.5rem_12.5rem_18.5rem]'
            : 'lg:grid-cols-[minmax(0,1fr)_9.5rem_12.5rem]'
        }`}
      >
        <form
          role="search"
          className="min-w-0 sm:col-span-2 lg:col-span-1"
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
        <label className="flex min-w-0 flex-col gap-1 text-sm lg:flex-row lg:items-center lg:gap-2">
          <span className="text-sf-muted">Size</span>
          <span className="relative block min-w-0 w-full lg:w-28">
            <select
              aria-label="Size"
              className="sf-input w-full appearance-none pr-10"
              value={params.get('size') ?? ''}
              onChange={(event) => apply({ size: event.target.value || null })}
            >
              <option value="">Any</option>
              {sizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <Chevron />
          </span>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm lg:flex-row lg:items-center lg:gap-2">
          <span className="text-sf-muted">Sort</span>
          <span className="relative block min-w-0 w-full lg:w-40">
            <select
              aria-label="Sort"
              className="sf-input w-full appearance-none pr-10"
              value={params.get('sort') ?? 'featured'}
              onChange={(event) => apply({ sort: event.target.value === 'featured' ? null : event.target.value })}
            >
              {SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>
                  {sort.label}
                </option>
              ))}
            </select>
            <Chevron />
          </span>
        </label>
        {hasSubcategories ? (
          <label className="flex min-w-0 flex-col gap-1 text-sm lg:flex-row lg:items-center lg:gap-2">
            <span className="shrink-0 text-sf-muted">Subcategory</span>
            <span className="relative block min-w-0 w-full lg:w-48">
              <select
                aria-label="Subcategory"
                className="sf-input w-full appearance-none pr-10"
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
              <Chevron />
            </span>
          </label>
        ) : null}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sf-muted"
    >
      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
