/**
 * Shown inside the persistent shell the moment a dashboard link is clicked, while the next page's
 * code and data load, so navigation always responds immediately instead of appearing frozen.
 */
export default function DashboardLoading() {
  return (
    <div className="px-ws-gutter pt-6" aria-busy="true" aria-label="Loading page">
      <div className="mx-auto w-full max-w-6xl animate-pulse motion-reduce:animate-none">
        <div className="h-9 w-56 rounded-md bg-dashboard-border/60" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-dashboard-border/40" />
        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="h-72 rounded-xl border border-dashboard-border bg-dashboard-surface" />
          <div className="h-72 rounded-xl border border-dashboard-border bg-dashboard-surface" />
        </div>
      </div>
    </div>
  );
}
