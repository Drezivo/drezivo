import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getGuestReservationByToken } from '@/lib/capability';
import { buildGuestFlowMetadata } from '@/lib/seo';
import { ReservationSummaryCard } from '@/components/booking/reservation-summary-card';

export const metadata: Metadata = buildGuestFlowMetadata('Your Reservation');

// Never statically cache this route — it is keyed by a bearer token and the
// underlying reservation state changes as the business reviews it.
export const dynamic = 'force-dynamic';

/**
 * The durable status page behind every "view your reservation" link sent by
 * email (Drezivo-PRD.md §4: "Resend guest link uses a hashed, expiring
 * token; it reveals no reservation before verification"). The dynamic
 * segment IS the raw capability secret — see src/lib/capability.ts for the
 * full security model this page depends on.
 *
 * The secret is read here, server-side, for exactly one request, and is
 * never interpolated into anything this page renders (no data attribute, no
 * hidden input, no outbound link target) — it only ever flows into the one
 * `getGuestReservationByToken` call below.
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
