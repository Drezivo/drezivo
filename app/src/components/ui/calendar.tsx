"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";

import { cn } from "@/lib/utils";

export function Calendar({
  className,
  classNames,
  showOutsideDays = false,
  components,
  ...props
}: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("relative w-full", className)}
      classNames={{
        months: "flex w-full flex-col",
        month: "relative w-full space-y-4",
        month_caption: "relative flex h-10 items-center justify-center",
        caption_label: "text-sm font-semibold text-dashboard-navy",
        nav: "absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between px-1",
        button_previous:
          "inline-flex h-9 w-9 items-center justify-center rounded-md text-dashboard-muted transition-colors hover:bg-dashboard-active hover:text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:pointer-events-none disabled:opacity-50",
        button_next:
          "inline-flex h-9 w-9 items-center justify-center rounded-md text-dashboard-muted transition-colors hover:bg-dashboard-active hover:text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:pointer-events-none disabled:opacity-50",
        month_grid: "w-full border-collapse",
        weekdays: "flex w-full",
        weekday: "flex-1 py-2 text-center text-xs font-medium text-dashboard-muted",
        week: "mt-1 flex w-full",
        day: "relative flex-1 p-0 text-center",
        day_button:
          "h-10 w-full rounded-md text-sm text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
        range_start: "rounded-l-md bg-dashboard-active",
        range_middle: "rounded-none bg-dashboard-active/60",
        range_end: "rounded-r-md bg-dashboard-active",
        selected: "bg-dashboard-active font-semibold text-dashboard-accent",
        today: "font-semibold text-dashboard-accent",
        outside: "text-dashboard-muted opacity-50",
        disabled: "pointer-events-none text-dashboard-muted opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ className: chevronClassName, orientation }) => {
          const iconClassName = cn("h-4 w-4", chevronClassName);
          if (orientation === "left") return <ChevronLeft className={iconClassName} />;
          if (orientation === "right") return <ChevronRight className={iconClassName} />;
          if (orientation === "up") return <ChevronUp className={iconClassName} />;
          return <ChevronDown className={iconClassName} />;
        },
        ...components,
      }}
      {...props}
    />
  );
}
