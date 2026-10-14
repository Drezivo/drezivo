import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-dashboard-active motion-reduce:animate-none",
        className
      )}
    />
  );
}
