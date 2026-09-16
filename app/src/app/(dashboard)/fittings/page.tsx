"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useOrganization } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import type { FittingNote, PaginatedResponse } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Table } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" });

export default function FittingsPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const router = useRouter();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["fittings", organization?.id],
    queryFn: () => api.get<PaginatedResponse<FittingNote>>("/fittings"),
    enabled: Boolean(organization),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Fittings</h1>
          <p className="text-sm text-ink-500">
            V1 stores a fitting request as a note only — no room, staff, or time-slot capacity is guaranteed
            (PRD §4 FR11). Coordinate the actual appointment time with the customer directly.
          </p>
        </div>
        <Link href="/fittings/schedule" className="text-sm font-medium text-brand-600 hover:underline">
          Schedule &amp; availability
        </Link>
      </div>

      {isPending && <TableSkeleton columns={4} />}

      {isError && (
        <EmptyState
          heading="Couldn't load fitting requests"
          description={error instanceof Error ? error.message : "Try refreshing the page."}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          heading="No fitting requests yet"
          description="Fitting notes appear here when a customer asks about a fitting during checkout or a walk-in visit."
        />
      )}

      {data && data.items.length > 0 && (
        <Table
          caption="Fitting requests"
          rows={data.items}
          getRowId={(note) => note.id}
          onRowClick={(note) => router.push(`/fittings/${note.id}`)}
          columns={[
            { key: "customer", header: "Customer", render: (note) => note.customerName },
            { key: "preferred", header: "Preferred date", render: (note) => DATE_FORMAT.format(new Date(note.preferredDate)) },
            { key: "note", header: "Note", render: (note) => <span className="line-clamp-1">{note.note}</span> },
            {
              key: "status",
              header: "Status",
              render: (note) => <Badge tone={note.status === "completed" ? "success" : "warning"}>{note.status}</Badge>,
            },
          ]}
        />
      )}
    </div>
  );
}
