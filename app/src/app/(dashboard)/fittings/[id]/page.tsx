"use client";

import { useParams } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import type { FittingNote } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" });

export default function FittingDetailPage() {
  const params = useParams<{ id: string }>();
  const { organization } = useOrganization();
  const api = useApiClient();

  const { data: note, isPending, isError, error } = useQuery({
    queryKey: ["fittings", "detail", params.id],
    queryFn: () => api.get<FittingNote>(`/fittings/${params.id}`),
    enabled: Boolean(organization) && Boolean(params.id),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" label="Loading fitting request" />
        <Skeleton className="h-40 w-full" label="Loading fitting details" />
      </div>
    );
  }

  if (isError || !note) {
    return (
      <EmptyState
        heading="Couldn't load this fitting request"
        description={error instanceof Error ? error.message : "It may not exist, or you may not have access."}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{note.customerName}</h1>
          <p className="text-sm text-ink-500">Preferred date: {DATE_FORMAT.format(new Date(note.preferredDate))}</p>
        </div>
        <Badge tone={note.status === "completed" ? "success" : "warning"}>{note.status}</Badge>
      </div>

      <section className="rounded-lg border border-ink-300 bg-white p-4 text-sm">
        <h2 className="mb-1 font-medium text-ink-900">Note</h2>
        <p className="whitespace-pre-wrap text-ink-700">{note.note}</p>
      </section>

      <section className="rounded-lg border border-warning-500/30 bg-warning-500/5 p-4 text-sm text-ink-700">
        This is a note only — no room, staff, or garment is reserved against a fitting in V1 (PRD §4 FR11).
        Confirm the appointment time with the customer by phone and record the outcome here manually.
      </section>
    </div>
  );
}
