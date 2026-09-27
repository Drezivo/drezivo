import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { ReservationConfirmationDetails } from '@/components/booking/reservation-confirmation-details';
import { getGuestReservationById } from '@/lib/static-capability';
import { staticStorefrontClient } from '@/lib/static-storefront-client';
import { buildGuestFlowMetadata } from '@/lib/seo';

export const metadata: Metadata = buildGuestFlowMetadata('Reservation Received');

interface ConfirmationPageProps {
  params: Promise<{ slug: string; itemId: string }>;
  searchParams: Promise<{ rid?: string }>;
}

/** Immediate post-submit confirmation, authenticated by the exchanged guest capability cookie. */
export default async function BookingConfirmationPage({
  params,
  searchParams,
}: ConfirmationPageProps) {
  const { slug, itemId } = await params;
  const { rid } = await searchParams;

  if (!rid) {
    redirect(`/s/${slug}/items/${itemId}`);
  }

  const [summary, store] = await Promise.all([
    getGuestReservationById(rid),
    staticStorefrontClient.getStore(slug),
  ]);

  if (!summary || !store) {
    notFound();
  }

  return <ReservationConfirmationDetails store={store} summary={summary} />;
}
