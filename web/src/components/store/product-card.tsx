import Link from 'next/link';

import type { CatalogueCard } from '@drezivo/contracts';

import { durationLabel, formatMinor } from '@/lib/storefront-format';

export function ProductCard({ slug, item, priority = false }: { slug: string; item: CatalogueCard; priority?: boolean }) {
  return (
    <Link href={`/s/${slug}/items/${item.product_id}`} className="group block">
      <div className="relative aspect-[3/4] overflow-hidden bg-sf-line">
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; next/image cannot cache it usefully
          <img
            src={item.image_url}
            alt={item.name}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
          />
        ) : (
          <span className="flex h-full items-center justify-center px-4 text-center font-sf-display text-lg text-sf-muted">{item.name}</span>
        )}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate font-sf-display text-lg font-normal leading-snug">{item.name}</h3>
        <p className="shrink-0 text-sm tabular-nums">{formatMinor(item.price_from_minor)}</p>
      </div>
      <p className="mt-0.5 flex justify-between gap-3 text-xs text-sf-muted">
        <span className="truncate">{[item.category, item.sizes.length > 0 ? item.sizes.join(' · ') : null].filter(Boolean).join(' — ')}</span>
        <span className="shrink-0">{durationLabel(item.pricing_mode, item.included_duration_minutes)}</span>
      </p>
    </Link>
  );
}

export function ProductGrid({ slug, items, priorityCount = 0 }: { slug: string; items: CatalogueCard[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">
      {items.map((item, index) => (
        <li key={item.product_id}>
          <ProductCard slug={slug} item={item} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
