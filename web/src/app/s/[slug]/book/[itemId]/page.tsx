import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { publicApiClient } from '@/lib/api-client';
import { buildGuestFlowMetadata } from '@/lib/seo';
import { BookingSteps } from '@/components/booking/booking-steps';
import { HoldDateSelector } from '@/components/booking/hold-date-selector';
import { formatPhpPerUnit } from '@/lib/money';

export const metadata: Metadata = buildGuestFlowMetadata('Select Dates');

interface BookingDatesPageProps {
  params: Promise<{ slug: string; itemId: string }>;
  searchParams: Promise<{ size?: string }>;
}

/**
 * Step 1 of the guest booking flow: availability + date selection, ending in
 * a hold. This is the reference implementation the spec calls for — every
 * later step (details, review) reuses its `useSubmitGuard` pattern.
 */
export default async function BookingDatesPage({ params, searchParams }: BookingDatesPageProps) {
  const { slug, itemId } = await params;
  const { size } = await searchParams;

  const item = await publicApiClient.getCatalogItem(slug, itemId);
  if (!item) {
    notFound();
  }

  if (!size || !item.sizes.includes(size)) {
    // No valid size chosen yet — send the guest back to pick one rather than
    // silently defaulting, since the size is part of what gets held.
    redirect(`/s/${slug}/items/${itemId}`);
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <BookingSteps current={1} />

      <div className="mt-6 flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-border">
          <Image src={item.images[0] ?? ''} alt="" fill className="object-cover" sizes="64px" />
        </div>
        <div>
          <p className="font-medium text-foreground">{item.name}</p>
          <p className="text-sm text-muted">
            Size {size} · {formatPhpPerUnit(item.priceDecimal, item.rentalUnitLabel)}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <HoldDateSelector storeSlug={slug} item={item} size={size} />
      </div>
    </section>
  );
}
