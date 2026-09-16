import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getGuestReservationById } from '@/lib/capability';
import { buildGuestFlowMetadata } from '@/lib/seo';
import { ReservationSummaryCard } from '@/components/booking/reservation-summary-card';

export const metadata: Metadata = buildGuestFlowMetadata('Reservation Received');

interface ConfirmationPageProps {
  params: Promise<{ slug: string; itemId: string }>;
  searchParams: Promise<{ rid?: string }>;
}

/**
 * Immediate post-submit confirmation, server-rendered. Reads the incoming
 * request's Cookie header (set moments ago by `exchangeGuestCapability`
 * during step 1) and forwards it to the API — the raw capability secret
 * itself never reaches this page; only the already-exchanged cookie does.
 */
export default async function BookingConfirmationPage({
  params,
  searchParams,
}: ConfirmationPageProps) {
  const { slug, itemId } = await params;
  const { rid } = await searchParams;

  if (!rid) {
    redirect(`/s/${slug}/items/${itemId}`);
  }

  const cookieStore = await cookies();
  const summary = await getGuestReservationById(rid, { cookieHeader: cookieStore.toString() });

  if (!summary) {
    notFound();
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-2xl text-success">
        ✓
      </div>
      <h1 className="mt-4 font-display text-3xl font-semibold text-foreground">
        Reservation Received
      </h1>
      <p className="mt-2 text-muted">
        Your reservation has been submitted. We&rsquo;ve sent the details to your email.
      </p>
      <p className="mt-4 inline-block rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground">
        Reference #{summary.referenceNumber}
      </p>

      <div className="mt-8 text-left">
        <ReservationSummaryCard summary={summary} />
      </div>

      <div className="mt-8 rounded-lg border border-border bg-surface p-6 text-left text-sm text-muted">
        <p className="font-medium text-foreground">What Happens Next?</p>
        <p className="mt-2">
          The business will review your reservation and notify you once it has been confirmed.
          You&rsquo;ll receive an update by email.
        </p>
      </div>
    </section>
  );
}
