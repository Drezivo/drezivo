import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getGuestReservationByToken } from '@/lib/static-capability';
import { buildGuestFlowMetadata } from '@/lib/seo';
import { ReservationSummaryCard } from '@/components/booking/reservation-summary-card';

export const metadata: Metadata = buildGuestFlowMetadata('Your Reservation');

/**
 * Static preview of the durable guest reservation status page. During this
 * storefront-design phase the token is only a route placeholder; no backend,
 * capability cookie, or reservation API is contacted.
 */
export default async function GuestReservationStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const summary = await getGuestReservationByToken(token);

  if (!summary) {
    // A wrong, expired, or already-superseded link renders identically to
    // one that never existed — see src/lib/capability.ts for why this must
    // never be a distinct "invalid token" state.
    notFound();
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-2xl font-semibold text-foreground">Your Reservation</h1>
      <p className="mt-1 text-sm text-muted">
        Reference #{summary.referenceNumber} · {summary.item.name}
      </p>

      <div className="mt-6">
        <ReservationSummaryCard summary={summary} />
      </div>
    </section>
  );
}
