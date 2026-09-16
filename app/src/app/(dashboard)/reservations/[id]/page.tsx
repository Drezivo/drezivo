"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Reservation } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ReservationStatusBadge } from "@/components/reservations/reservation-status-badge";
import { ConfirmReservationDialog } from "@/components/reservations/confirm-reservation-dialog";
import { can } from "@/lib/permissions";
import { useStaffRole } from "@/lib/use-staff-role";
import { formatPhp } from "@/lib/money";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

export default function ReservationDetailPage() {
  const params = useParams<{ id: string }>();
  const { organization } = useOrganization();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const staffRole = useStaffRole();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const queryKey = ["reservations", "detail", params.id];
  const { data: reservation, isPending, isError, error } = useQuery({
    queryKey,
    queryFn: () => api.get<Reservation>(`/reservations/${params.id}`),
    enabled: Boolean(organization) && Boolean(params.id),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" label="Loading reservation" />
        <Skeleton className="h-40 w-full" label="Loading reservation details" />
      </div>
    );
  }

  if (isError || !reservation) {
    return (
      <EmptyState
        heading="Couldn't load this reservation"
        description={error instanceof Error ? error.message : "It may not exist, or you may not have access to it."}
      />
    );
  }

  // PRD §5: Front desk can view payments but not verify/confirm them. This check is UX
  // only (lib/permissions.ts) — the API will refuse the POST server-side regardless.
  const canConfirm =
    Boolean(staffRole) &&
    can({ role: staffRole as NonNullable<typeof staffRole> }, "payments.verify_evidence") &&
    reservation.status === "pending_confirmation";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{reservation.referenceNumber}</h1>
          <p className="text-sm text-ink-500">{reservation.customerName}</p>
        </div>
        <ReservationStatusBadge status={reservation.status} />
      </div>

      <section className="grid grid-cols-2 gap-x-8 gap-y-4 rounded-lg border border-ink-300 bg-white p-6 text-sm">
        <div>
          <dt className="text-ink-500">Pickup</dt>
          <dd className="text-ink-900">{DATE_FORMAT.format(new Date(reservation.pickupAt))}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Return</dt>
          <dd className="text-ink-900">{DATE_FORMAT.format(new Date(reservation.returnAt))}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Rental charge</dt>
          <dd className="text-ink-900">{formatPhp(reservation.rentalAmount)}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Security deposit</dt>
          <dd className="text-ink-900">{formatPhp(reservation.depositAmount)}</dd>
        </div>
      </section>

      {reservation.status === "pending_confirmation" && (
        <section className="rounded-lg border border-warning-500/30 bg-warning-500/5 p-4 text-sm text-ink-700">
          Evidence was submitted and is awaiting your review. Confirm only after you&apos;ve verified the funds
          actually arrived — a screenshot alone is not sufficient (see the payments queue for the evidence
          image).
        </section>
      )}

      {canConfirm && (
        <div>
          <Button onClick={() => setConfirmOpen(true)}>Confirm reservation</Button>
        </div>
      )}

      <ConfirmReservationDialog
        reservation={reservation}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirmed={(updated) => {
          queryClient.setQueryData(queryKey, updated);
        }}
      />
    </div>
  );
}
