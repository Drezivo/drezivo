import Image from 'next/image';
import Link from 'next/link';
import type { CatalogItemSummary } from '@drezivo/contracts';
import { Badge } from '@/components/ui/badge';
import { formatPhpPerUnit } from '@/lib/money';

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

export function CatalogItemCard({
  storeSlug,
  item,
}: {
  storeSlug: string;
  item: CatalogItemSummary;
}) {
  return (
    <Link
      href={`/s/${storeSlug}/items/${item.id}`}
      className="group block overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="relative aspect-[3/4] bg-border">
        <Image
          src={item.primaryImageUrl}
          alt={item.name}
          fill
          sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform group-hover:scale-[1.02]"
        />
        <div className="absolute left-3 top-3">
          <Badge tone={AVAILABILITY_TONE[item.availabilityStatus]}>
            {AVAILABILITY_LABEL[item.availabilityStatus]}
          </Badge>
        </div>
      </div>
      <div className="p-4">
        <p className="font-medium text-foreground">{item.name}</p>
        <p className="text-sm text-muted">{item.categoryName}</p>
        <p className="mt-2 font-medium text-foreground">
          {formatPhpPerUnit(item.priceDecimal, item.rentalUnitLabel)}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.sizes.map((size) => (
            <span
              key={size}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted"
            >
              {size}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
