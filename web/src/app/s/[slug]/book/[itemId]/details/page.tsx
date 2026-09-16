import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { buildGuestFlowMetadata } from '@/lib/seo';
import { BookingSteps } from '@/components/booking/booking-steps';
import { CustomerDetailsForm } from '@/components/booking/customer-details-form';

export const metadata: Metadata = buildGuestFlowMetadata('Your Details');

interface BookingDetailsPageProps {
  params: Promise<{ slug: string; itemId: string }>;
  searchParams: Promise<{ rid?: string }>;
}

/** Step 2: customer/pickup/payment details. Requires a reservation id from step 1's hold. */
export default async function BookingDetailsPage({
  params,
  searchParams,
}: BookingDetailsPageProps) {
  const { slug, itemId } = await params;
  const { rid } = await searchParams;

  if (!rid) {
    // No hold exists yet for this browser — send the guest back to start
    // over rather than rendering a details form with nothing to attach it to.
    redirect(`/s/${slug}/items/${itemId}`);
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <BookingSteps current={2} />
      <div className="mt-6">
        <CustomerDetailsForm storeSlug={slug} itemId={itemId} reservationId={rid} />
      </div>
    </section>
  );
}
