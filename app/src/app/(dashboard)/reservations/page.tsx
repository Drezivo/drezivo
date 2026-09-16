"use client";

import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@clerk/nextjs";
import type { ReservationListItem, PaginatedResponse } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { ReservationsTable } from "@/components/reservations/reservations-table";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";

export default function ReservationsPage() {
  const { organization } = useOrganization();
  const api = useApiClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["reservations", organization?.id],
    queryFn: () => api.get<PaginatedResponse<ReservationListItem>>("/reservations"),
    enabled: Boolean(organization),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Reservations</h1>
        <p className="text-sm text-ink-500">
          Every hold, pending confirmation, and active rental for this branch. Select a reservation to confirm,
          reschedule, or record custody.
        </p>
      </div>

      {isPending && <TableSkeleton columns={6} />}

      {isError && (
        <EmptyState
          heading="Couldn't load reservations"
          description={error instanceof Error ? error.message : "Try refreshing the page."}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          heading="No reservations yet"
          description="Reservations appear here as soon as a guest holds a garment from your storefront, or you create a walk-in booking."
        />
      )}

      {data && data.items.length > 0 && <ReservationsTable reservations={data.items} />}
    </div>
  );
}
