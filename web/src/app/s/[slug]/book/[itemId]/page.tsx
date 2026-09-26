import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { HoldDateSelector } from '@/components/booking/hold-date-selector';
import { formatPhp, formatPhpPerUnit } from '@/lib/money';
import { publicApiClient } from '@/lib/api-client';
import { buildGuestFlowMetadata } from '@/lib/seo';

export const metadata: Metadata = buildGuestFlowMetadata('Select Dates');

interface BookingDatesPageProps {
  params: Promise<{ slug: string; itemId: string }>;
  searchParams: Promise<{ size?: string }>;
}

/** Step 1 renders as a right-side drawer over the selected clothing detail context. */
export default async function BookingDatesPage({ params, searchParams }: BookingDatesPageProps) {
  const { slug, itemId } = await params;
  const { size } = await searchParams;

  const item = await publicApiClient.getCatalogItem(slug, itemId);
  if (!item) {
    notFound();
  }

  if (!size || !item.sizes.includes(size)) {
    redirect(`/s/${slug}/items/${itemId}`);
  }

  return (
    <>
      <section aria-hidden="true" className="mx-auto max-w-7xl px-6 py-8 sm:px-10 lg:px-20">
        <Link
          href={`/s/${slug}/catalog`}
          tabIndex={-1}
          className="text-sm font-medium text-storefront-ink"
        >
          ← Back to Catalog
        </Link>

        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_5rem]">
            <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-storefront-soft">
              {item.images[0] ? (
                <Image
                  src={item.images[0]}
                  alt=""
                  fill
                  priority
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  className="object-cover"
                />
              ) : null}
            </div>

            <div className="hidden space-y-3 sm:block">
              {item.images.slice(0, 5).map((imageUrl: string) => (
                <div
                  key={imageUrl}
                  className="relative aspect-[4/5] overflow-hidden rounded-md border border-storefront-line bg-storefront-soft"
                >
                  <Image src={imageUrl} alt="" fill sizes="80px" className="object-cover" />
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <p className="text-sm text-storefront-muted">{item.categoryName}</p>
            <h1 className="mt-2 font-display text-4xl font-semibold text-storefront-ink">
              {item.name}
            </h1>
            <p className="mt-4 font-display text-3xl font-semibold text-storefront-ink">
              {formatPhpPerUnit(item.priceDecimal, item.rentalUnitLabel)}
            </p>
            <p className="mt-2 text-sm text-storefront-muted">
              Security Deposit: {formatPhp(item.securityDepositDecimal)} refundable
            </p>

            <p className="mt-6 max-w-xl text-sm leading-6 text-storefront-muted">
              {item.description}
            </p>

            <div className="mt-6">
              <p className="text-sm font-semibold text-storefront-ink">Selected Size</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.sizes.map((itemSize: string) => (
                  <span
                    key={itemSize}
                    className={`grid h-11 min-w-11 place-items-center rounded-full border px-3 text-sm ${
                      itemSize === size
                        ? 'border-storefront-brand bg-storefront-brand text-storefront-paper'
                        : 'border-storefront-line text-storefront-muted'
                    }`}
                  >
                    {itemSize}
                  </span>
                ))}
              </div>
            </div>

            {item.measurements.length > 0 ? (
              <div className="mt-8 border-t border-storefront-line pt-6">
                <p className="font-display text-xl font-semibold text-storefront-ink">
                  Measurements (approx.)
                </p>
                <dl className="mt-3 divide-y divide-storefront-line text-sm">
                  {item.measurements
                    .slice(0, 4)
                    .map((measurement: { label: string; value: string }) => (
                      <div key={measurement.label} className="flex justify-between gap-6 py-2">
                        <dt className="text-storefront-muted">{measurement.label}</dt>
                        <dd className="text-storefront-ink">{measurement.value}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <HoldDateSelector storeSlug={slug} item={item} size={size} />
    </>
  );
}
