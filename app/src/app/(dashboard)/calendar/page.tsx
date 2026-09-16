"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@clerk/nextjs";
import type { CalendarAllocation } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AllocationDetailsDrawer } from "@/components/calendar/allocation-details-drawer";

const DAY_FORMAT = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" });
const TIME_FORMAT = new Intl.DateTimeFormat("en-PH", { timeStyle: "short", timeZone: "Asia/Manila" });

function startOfWeekManila(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

/** Groups allocations by their local Manila calendar day so the "Listing.png" agenda view reads top to bottom. */
function groupByDay(allocations: CalendarAllocation[]): Map<string, CalendarAllocation[]> {
  const groups = new Map<string, CalendarAllocation[]>();
  for (const allocation of allocations) {
    const dayKey = new Date(allocation.blockedStart).toISOString().slice(0, 10);
    const existing = groups.get(dayKey) ?? [];
    existing.push(allocation);
    groups.set(dayKey, existing);
  }
  return groups;
}

export default function CalendarPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const [selected, setSelected] = useState<CalendarAllocation | null>(null);
  const from = useMemo(startOfWeekManila, []);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["calendar-allocations", organization?.id, from],
    queryFn: () => api.get<CalendarAllocation[]>(`/calendar/allocations?from=${from}`),
    enabled: Boolean(organization),
  });

  const grouped = data ? groupByDay(data) : new Map<string, CalendarAllocation[]>();

  return (
    <div className="flex gap-4">
      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Rental calendar</h1>
          <p className="text-sm text-ink-500">
            Blocked asset windows for the next two weeks, including preparation and turnaround buffers (TRD §5).
            Overlapping bars on the same asset are impossible by construction — the database rejects it.
          </p>
        </div>

        {isPending && <TableSkeleton rows={6} columns={3} />}

        {isError && (
          <EmptyState
            heading="Couldn't load the calendar"
            description={error instanceof Error ? error.message : "Try refreshing the page."}
          />
        )}

        {data && data.length === 0 && (
          <EmptyState
            heading="Nothing on the calendar"
            description="No assets are held, confirmed, or picked up for the selected range. Reservations appear here once a hold is created."
          />
        )}

        {data && data.length > 0 && (
          <div className="flex flex-col gap-4">
            {Array.from(grouped.entries()).map(([day, allocations]) => (
              <section key={day} className="rounded-lg border border-ink-300 bg-white">
                <h2 className="border-b border-ink-100 px-4 py-2 text-sm font-semibold text-ink-900">
                  {DAY_FORMAT.format(new Date(day))}
                </h2>
                <ul>
                  {allocations.map((allocation) => (
                    <li key={allocation.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(allocation)}
                        className="flex w-full items-center justify-between gap-4 border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-brand-50"
                      >
                        <span className="font-medium text-ink-900">{allocation.assetCode}</span>
                        <span className="text-ink-500">{allocation.customerName}</span>
                        <span className="text-ink-500">
                          {TIME_FORMAT.format(new Date(allocation.blockedStart))} –{" "}
                          {TIME_FORMAT.format(new Date(allocation.blockedEnd))}
                        </span>
                        <Badge tone={allocation.isBlocking ? "brand" : "neutral"}>
                          {allocation.isBlocking ? "Blocking" : "Cleaning/maintenance"}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <AllocationDetailsDrawer allocation={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
