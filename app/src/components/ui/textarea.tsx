import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        data-slot="textarea"
        className={cn(
          "flex w-full resize-y rounded-md border border-dashboard-border bg-dashboard-surface px-3 py-2 text-ws-input leading-6 text-dashboard-navy shadow-none transition-colors placeholder:text-dashboard-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);

export { Textarea };
