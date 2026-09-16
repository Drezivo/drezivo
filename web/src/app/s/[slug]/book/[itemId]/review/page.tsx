import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { buildGuestFlowMetadata } from '@/lib/seo';
import { BookingSteps } from '@/components/booking/booking-steps';
import { ReservationReview } from '@/components/booking/reservation-review';

export const metadata: Metadata = buildGuestFlowMetadata('Review Reservation');

interface BookingReviewPageProps {
  params: Promise<{ slug: string; itemId: string }>;
  searchParams: Promise<{ rid?: string }>;
}

export default async function BookingReviewPage({ params, searchParams }: BookingReviewPageProps) {
  const { slug, itemId } = await params;
  const { rid } = await searchParams;

  if (!rid) {
    redirect(`/s/${slug}/items/${itemId}`);
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <BookingSteps current={3} />
      <div className="mt-6">
        <ReservationReview storeSlug={slug} itemId={itemId} reservationId={rid} />
      </div>
    </section>
  );
}
