import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BookingStatus } from '@/components/store/booking-status';
import { readStore } from '@/lib/storefront-preview';

export const metadata: Metadata = { title: 'Your request', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await readStore(slug);
  if (!store) notFound();
  return (
    <div className="mx-auto max-w-7xl px-5 pb-8 pt-12 sm:px-8 sm:pt-16">
      <BookingStatus store={store} />
    </div>
  );
}
