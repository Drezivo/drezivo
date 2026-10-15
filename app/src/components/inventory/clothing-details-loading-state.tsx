import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ClothingDetailsLoadingState() {
  return (
    <div
      className="min-h-[calc(100svh-4.5rem)] bg-dashboard-canvas px-ws-gutter py-6"
      role="status"
      aria-busy="true"
      aria-label="Loading clothing details"
    >
      <span className="sr-only">Loading clothing details</span>
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <Skeleton className="h-4 w-56" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>

        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="grid gap-6 p-5 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(24rem,1.1fr)]">
            <Skeleton className="aspect-[4/5] w-full rounded-xl" />
            <div className="space-y-5">
              <Skeleton className="h-6 w-40" />
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b border-dashboard-border">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="mt-2 h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b border-dashboard-border">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-2 h-4 w-56" />
          </CardHeader>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
