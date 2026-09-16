"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@clerk/nextjs";
import type { DashboardSummary } from "@drezivo/contracts";
import { useApiClient } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

// PRD §4 Operations: "Dashboard queues pickups, returns, pending evidence, expiring holds,
// overdue/late flags, cleaning/maintenance, and review work." Each tile here is a queue,
// not a vanity metric — clicking through takes staff to the filtered work list.
const TILES: Array<{ key: keyof DashboardSummary; label: string; href: string; tone: "warning" | "danger" | "brand" }> = [
  { key: "pickupsToday", label: "Pickups today", href: "/reservations?status=confirmed", tone: "brand" },
  { key: "returnsToday", label: "Returns due today", href: "/reservations?status=picked_up", tone: "brand" },
  { key: "pendingEvidence", label: "Evidence to review", href: "/payments", tone: "warning" },
  { key: "expiringHolds", label: "Holds expiring soon", href: "/reservations?status=held", tone: "warning" },
  { key: "overdueReturns", label: "Overdue returns", href: "/reservations?status=picked_up&overdue=true", tone: "danger" },
  { key: "cleaningRequired", label: "Awaiting cleaning", href: "/inventory?status=needs_cleaning", tone: "warning" },
];

export default function DashboardOverviewPage() {
  const { organization } = useOrganization();
  const api = useApiClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["dashboard-summary", organization?.id],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
    enabled: Boolean(organization),
    // Operational counts go stale fast; a merchant checking pickups mid-shift needs a
    // fresher number than the default 30s used elsewhere.
    staleTime: 10_000,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Dashboard</h1>
        <p className="text-sm text-ink-500">
          {organization ? organization.name : "Select an organization"} — today&apos;s operational queues.
        </p>
      </div>

      {isPending && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" label="Loading dashboard tile" />
          ))}
        </div>
      )}

      {isError && (
        <EmptyState
          heading="Couldn't load the dashboard"
          description={error instanceof Error ? error.message : "Try refreshing the page."}
        />
      )}

      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {TILES.map((tile) => (
            <Link
              key={tile.key}
              href={tile.href}
              className="flex flex-col gap-1 rounded-lg border border-ink-300 bg-white p-4 transition-colors hover:border-brand-500"
            >
              <span className="text-2xl font-semibold text-ink-900">{data[tile.key]}</span>
              <span className="text-sm text-ink-500">{tile.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
