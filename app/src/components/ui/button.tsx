import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "dashboard-button-default",
        primary: "dashboard-button-default",
        secondary: "dashboard-button-secondary border border-dashboard-border",
        danger: "bg-dashboard-danger text-dashboard-primary-ink hover:bg-dashboard-danger/90",
        ghost: "text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy",
      },
      size: {
        default: "h-ws-control px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-6",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    isPending?: boolean;
    pendingLabel?: string;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    isPending = false,
    pendingLabel,
    disabled,
    children,
    type = "button",
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isPending}
      aria-busy={isPending}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {isPending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
});

export { buttonVariants };
