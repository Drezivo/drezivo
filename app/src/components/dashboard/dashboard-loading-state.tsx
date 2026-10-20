import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardLoadingState() {
  return (
    <div
      className="min-h-[calc(100svh-72px)] px-ws-gutter py-5 sm:py-6"
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <span className="sr-only">Loading dashboard…</span>
      <div className="mx-auto space-y-5">
        <section className="rounded-ws-card border border-dashboard-border bg-dashboard-surface p-5 sm:p-7 lg:p-8">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-4 h-12 w-full max-w-xl" />
          <Skeleton className="mt-4 h-5 w-full max-w-lg" />
          <Skeleton className="mt-2 h-5 w-4/5 max-w-md" />
          <Skeleton className="mt-6 h-0.5 w-24 rounded-full" />
        </section>

        <section
          aria-label="Dashboard metric placeholders"
          className="grid grid-cols-2 gap-ws-gap md:grid-cols-3 min-[1440px]:grid-cols-6"
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} data-mobile-card="keep" className="min-h-36 py-4 sm:min-h-[166px] sm:py-5">
              <CardContent className="flex h-full flex-col justify-between px-4 sm:px-5">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <Skeleton className="h-5 w-5 rounded-full" />
                </div>
                <div className="mt-5 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-4 w-28" />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.05fr_1fr]">
          <DashboardPanelSkeleton rows={4} />
          <DashboardPanelSkeleton rows={4} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.05fr_1fr]">
          <DashboardPanelSkeleton rows={3} />
          <DashboardPanelSkeleton rows={4} />
        </section>
      </div>
    </div>
  );
}

function DashboardPanelSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-dashboard-border px-5 py-5">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
      </CardHeader>
      <CardContent className="space-y-3 p-5">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="grid grid-cols-3 gap-3 rounded-lg border border-dashboard-border p-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
