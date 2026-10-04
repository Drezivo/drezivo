import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { reservationId } from '@drezivo/contracts';

import { BookingStatus } from '@/components/store/booking-status';
import { readStore } from '@/lib/storefront-preview';

export const metadata: Metadata = { title: 'Your request', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ reservation?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const parsedReservationId = reservationId.safeParse(query.reservation);
  if (!parsedReservationId.success) notFound();
  const store = await readStore(slug);
  if (!store) notFound();
  return (
    <div className="mx-auto max-w-7xl px-5 pb-8 pt-12 sm:px-8 sm:pt-16">
      <BookingStatus store={store} reservationId={parsedReservationId.data} />
    </div>
  );
}
