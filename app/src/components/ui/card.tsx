import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-slot="card"
      className={cn(
        "group/card flex flex-col gap-4 overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface py-4 text-sm text-dashboard-navy shadow-none",
        className
      )}
      {...props}
    />
  );
});

const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-header"
        className={cn(
          "grid auto-rows-min items-start gap-1 px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
          className
        )}
        {...props}
      />
    );
  }
);

type CardTitleProps = React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "h2" | "h3";
};

function CardTitle({ as: Component = "div", className, ...props }: CardTitleProps) {
  return (
    <Component
      data-slot="card-title"
      className={cn("leading-none font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

const CardDescription = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardDescription({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-description"
        className={cn("text-muted-foreground text-sm", className)}
        {...props}
      />
    );
  }
);

const CardAction = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardAction({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-action"
        className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
        {...props}
      />
    );
  }
);

const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} data-slot="card-content" className={cn("px-4", className)} {...props} />;
  }
);

const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-footer"
        className={cn("flex items-center border-t border-dashboard-border px-4 pt-4", className)}
        {...props}
      />
    );
  }
);

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
