import Image from 'next/image';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import type { publicApiClient } from '@/lib/api-client';
import { formatPhpPerUnit } from '@/lib/money';

type CatalogItemSummary = Awaited<ReturnType<typeof publicApiClient.getCatalog>>['items'][number];

const AVAILABILITY_TONE = {
  available: 'success',
  reserved: 'warning',
  rented: 'danger',
  unavailable: 'neutral',
} as const;

const AVAILABILITY_LABEL = {
  available: 'Available',
  reserved: 'Reserved',
  rented: 'Rented',
  unavailable: 'Unavailable',
} as const;

const AVAILABILITY_DOT = {
  available: 'bg-success',
  reserved: 'bg-warning',
  rented: 'bg-danger',
  unavailable: 'bg-storefront-muted',
} as const;

export function CatalogItemCard({
  storeSlug,
  item,
}: {
  storeSlug: string;
  item: CatalogItemSummary;
}) {
  const availability = item.availabilityStatus as keyof typeof AVAILABILITY_LABEL;

  return (
    <Link
      href={`/s/${storeSlug}/items/${item.id}`}
      className="group block overflow-hidden rounded-md border border-storefront-line bg-storefront-paper shadow-storefront-card transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative aspect-square overflow-hidden bg-storefront-soft">
        <Image
          src={item.primaryImageUrl}
          alt={item.name}
          fill
          sizes="(min-width: 1280px) 18vw, (min-width: 768px) 28vw, 48vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute left-2.5 top-2.5">
          <Badge tone={AVAILABILITY_TONE[availability]}>{AVAILABILITY_LABEL[availability]}</Badge>
        </div>
      </div>

      <div className="px-3 py-3">
        <h2 className="truncate text-sm font-semibold text-storefront-ink">{item.name}</h2>
        <p className="mt-0.5 truncate text-xs text-storefront-muted">{item.categoryName}</p>
        <p className="mt-1 text-sm font-semibold text-storefront-ink">
          {formatPhpPerUnit(item.priceDecimal, item.rentalUnitLabel)}
        </p>

        {item.sizes.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {item.sizes.map((size: string) => (
              <span
                key={size}
                className="grid min-h-7 min-w-7 place-items-center rounded-md border border-storefront-line bg-storefront-paper px-1.5 text-xs font-medium text-storefront-muted"
              >
                {size}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2 border-t border-storefront-line pt-2.5 text-xs font-medium text-storefront-muted">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${AVAILABILITY_DOT[availability]}`}
          />
          <span>{AVAILABILITY_LABEL[availability]}</span>
        </div>
      </div>
    </Link>
  );
}
