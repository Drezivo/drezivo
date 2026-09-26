import Image from 'next/image';
import Link from 'next/link';

import type { publicApiClient } from '@/lib/api-client';
import { formatPhpPerUnit } from '@/lib/money';

type CatalogItemSummary = Awaited<ReturnType<typeof publicApiClient.getCatalog>>['items'][number];

interface StorefrontHomeItemCardProps {
  storeSlug: string;
  item: CatalogItemSummary;
}

/** Compact homepage product card matching the tenant storefront reference layout. */
export function StorefrontHomeItemCard({ storeSlug, item }: StorefrontHomeItemCardProps) {
  return (
    <Link
      href={`/s/${storeSlug}/items/${item.id}`}
      className="group overflow-hidden rounded-md border border-storefront-line bg-storefront-paper shadow-storefront-card transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative aspect-video overflow-hidden bg-storefront-soft">
        <Image
          src={item.primaryImageUrl}
          alt={item.name}
          fill
          sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 23vw, (min-width: 640px) 31vw, 48vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>
      <div className="space-y-1 px-3 py-2.5">
        <h3 className="truncate text-sm font-semibold text-storefront-ink">{item.name}</h3>
        <p className="truncate text-xs text-storefront-muted">{item.categoryName}</p>
        <p className="text-sm font-semibold text-storefront-ink">
          {formatPhpPerUnit(item.priceDecimal, item.rentalUnitLabel)}
        </p>
      </div>
    </Link>
  );
}
