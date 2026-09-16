"use client";

import { useParams, useRouter } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import type { CustomerDetail } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Table } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ReservationStatusBadge } from "@/components/reservations/reservation-status-badge";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const { organization } = useOrganization();
  const api = useApiClient();
  const router = useRouter();

  const { data: customer, isPending, isError, error } = useQuery({
    queryKey: ["customers", "detail", params.id],
    queryFn: () => api.get<CustomerDetail>(`/customers/${params.id}`),
    enabled: Boolean(organization) && Boolean(params.id),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" label="Loading customer" />
        <Skeleton className="h-40 w-full" label="Loading customer details" />
      </div>
    );
  }

  if (isError || !customer) {
    return (
      <EmptyState
        heading="Couldn't load this customer"
        description={error instanceof Error ? error.message : "They may not exist, or you may not have access."}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{customer.name}</h1>
        <p className="text-sm text-ink-500">
          {customer.phone}
          {customer.email ? ` · ${customer.email}` : ""}
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Reservation history</h2>
        {customer.reservations.length === 0 ? (
          <EmptyState heading="No reservations yet" description="This customer hasn't booked anything yet." />
        ) : (
          <Table
            caption="Reservation history"
            rows={customer.reservations}
            getRowId={(reservation) => reservation.id}
            onRowClick={(reservation) => router.push(`/reservations/${reservation.id}`)}
            columns={[
              { key: "reference", header: "Reference", render: (r) => r.referenceNumber },
              { key: "status", header: "Status", render: (r) => <ReservationStatusBadge status={r.status} /> },
            ]}
          />
        )}
      </section>

      <section className="rounded-lg border border-ink-300 bg-white p-4 text-sm text-ink-500">
        Identity documents and full export are restricted per PRD §5 (audited owner access, or receipt-only for
        assigned front desk staff). Request an export from Settings if you need this customer&apos;s full record.
      </section>
    </div>
  );
}
