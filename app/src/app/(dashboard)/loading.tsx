import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown inside the persistent shell the moment a dashboard link is clicked, while the next page's
 * code and data load, so navigation always responds immediately instead of appearing frozen.
 */
export default function DashboardLoading() {
  return (
    <div className="px-ws-gutter pt-6" role="status" aria-busy="true" aria-label="Loading page">
      <div className="mx-auto w-full max-w-6xl">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-72 rounded-xl border border-dashboard-border" />
          <Skeleton className="h-72 rounded-xl border border-dashboard-border" />
        </div>
      </div>
    </div>
  );
}
