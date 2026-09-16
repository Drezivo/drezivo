"use client";

import { useRouter } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import type { CustomerListItem, PaginatedResponse } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Table } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";

export default function CustomersPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const router = useRouter();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["customers", organization?.id],
    queryFn: () => api.get<PaginatedResponse<CustomerListItem>>("/customers"),
    enabled: Boolean(organization),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Customers</h1>
        <p className="text-sm text-ink-500">
          Minimum contact data collected at checkout (PRD §5). Identity documents and export/erasure are
          restricted — see a customer&apos;s detail page for what your role can access.
        </p>
      </div>

      {isPending && <TableSkeleton columns={4} />}

      {isError && (
        <EmptyState
          heading="Couldn't load customers"
          description={error instanceof Error ? error.message : "Try refreshing the page."}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          heading="No customers yet"
          description="Customers appear here after their first booking, whether created by a guest checkout or a walk-in reservation."
        />
      )}

      {data && data.items.length > 0 && (
        <Table
          caption="Customers"
          rows={data.items}
          getRowId={(customer) => customer.id}
          onRowClick={(customer) => router.push(`/customers/${customer.id}`)}
          columns={[
            { key: "name", header: "Name", render: (customer) => <span className="font-medium">{customer.name}</span> },
            { key: "phone", header: "Phone", render: (customer) => customer.phone },
            { key: "email", header: "Email", render: (customer) => customer.email ?? "—" },
            { key: "reservations", header: "Reservations", align: "right", render: (customer) => customer.reservationCount },
          ]}
        />
      )}
    </div>
  );
}
