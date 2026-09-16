export interface SkeletonProps {
  className?: string;
  /** Announced to screen readers while real content loads; keep it specific. */
  label?: string;
}

export function Skeleton({ className = "h-4 w-full", label = "Loading" }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={["animate-pulse rounded-md bg-ink-300/60", className].join(" ")}
    />
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink-300 bg-white p-4">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton key={columnIndex} className="h-4 flex-1" label="Loading row" />
          ))}
        </div>
      ))}
    </div>
  );
}
