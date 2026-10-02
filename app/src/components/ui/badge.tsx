import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-dashboard-accent/30",
  {
    variants: {
      variant: {
        default: "border-transparent bg-dashboard-primary text-dashboard-primary-ink",
        secondary: "border-transparent bg-dashboard-active text-dashboard-navy",
        destructive: "border-transparent bg-dashboard-danger text-dashboard-primary-ink",
        outline: "border-dashboard-border bg-transparent text-dashboard-navy",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

const Badge = forwardRef<HTMLDivElement, BadgeProps>(function Badge(
  { className, variant, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
});

export { Badge, badgeVariants };
