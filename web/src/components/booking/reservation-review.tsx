'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { confirmGuestReservation, getGuestReservationById } from '@/lib/capability';
import { useSubmitGuard } from '@/lib/use-submit-guard';
import { Button } from '@/components/ui/button';
import { ReservationSummaryCard } from '@/components/booking/reservation-summary-card';

/**
 * Step 3: read-only review, then the guest's explicit confirmation. Same
 * `useSubmitGuard` pattern as the dates step — a customer double-tapping
 * "Confirm Reservation" must submit exactly one confirmation.
 */
export function ReservationReview({
  storeSlug,
  itemId,
  reservationId,
}: {
  storeSlug: string;
  itemId: string;
  reservationId: string;
}) {
  const router = useRouter();

  const summaryQuery = useQuery({
    queryKey: ['guest-reservation', reservationId],
    queryFn: () => getGuestReservationById(reservationId),
  });

  const { submit, isPending, error } = useSubmitGuard((idempotencyKey) =>
    confirmGuestReservation(reservationId, idempotencyKey),
  );

  async function handleConfirm() {
    const confirmed = await submit();
    if (!confirmed) return;
    router.push(`/s/${storeSlug}/book/${itemId}/confirmation?rid=${reservationId}`);
  }

  if (summaryQuery.isLoading) {
    return <p className="text-sm text-muted">Loading your reservation…</p>;
  }

  if (!summaryQuery.data) {
    return (
      <p role="alert" className="text-sm text-danger">
        We couldn&rsquo;t find this reservation. It may have expired — please start again.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <ReservationSummaryCard summary={summaryQuery.data} />

      <div className="rounded-lg border border-border bg-background p-4 text-xs text-muted">
        Your reservation will be reviewed by the business before it is confirmed. You&rsquo;ll
        receive an update by email. Please make sure your contact information is correct.
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error.message}
        </p>
      ) : null}

      <Button className="w-full" disabled={isPending} isLoading={isPending} onClick={handleConfirm}>
        Confirm Reservation
      </Button>
    </div>
  );
}
