import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type = "text", ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "flex h-10 w-full rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-sm text-dashboard-navy shadow-none transition-colors placeholder:text-dashboard-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);

export { Input };
