"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const PHONE_MEDIA_QUERY = "(max-width: 639.98px)";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function MonthPickerField({
  id,
  label,
  value,
  defaultYear,
  onChange,
  popoverAlign = "start",
}: {
  id: string;
  label: string;
  value: string;
  defaultYear: number;
  onChange: (value: string) => void;
  popoverAlign?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [displayYear, setDisplayYear] = useState(defaultYear);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = `${id}-month-picker`;
  const displayValue = formatMonth(value);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(PHONE_MEDIA_QUERY);
    const update = () => setIsPhone(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open || isPhone) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, isPhone]);

  const openPicker = () => {
    if (open) {
      setOpen(false);
      return;
    }

    setDisplayYear(parseMonth(value)?.year ?? defaultYear);
    setOpen(true);
  };

  const selectMonth = (monthIndex: number) => {
    onChange(`${displayYear}-${String(monthIndex + 1).padStart(2, "0")}`);
    setOpen(false);
    if (!isPhone) triggerRef.current?.focus();
  };

  const monthGrid = (
    <MonthGrid
      value={value}
      year={displayYear}
      onYearChange={setDisplayYear}
      onSelect={selectMonth}
    />
  );

  return (
    <div ref={rootRef} className="relative min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-dashboard-navy/80">
        {label}
      </label>
      <Button
        ref={triggerRef}
        id={id}
        type="button"
        variant="secondary"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-describedby={`${id}-selected-value`}
        onClick={openPicker}
        className="min-w-0 w-full justify-between px-3 text-left font-normal text-dashboard-navy"
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />
          <span
            id={`${id}-selected-value`}
            className={cn("truncate", !displayValue && "text-dashboard-muted")}
          >
            {displayValue || "Select month"}
          </span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-dashboard-muted transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </Button>

      {!isPhone && open ? (
        <div
          id={dialogId}
          role="dialog"
          aria-label={`Select ${label.toLowerCase()}`}
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-50 w-[calc(100vw-2rem)] max-w-72 rounded-lg border border-dashboard-border bg-dashboard-surface p-3 shadow-xl",
            popoverAlign === "end" ? "right-0" : "left-0"
          )}
        >
          {monthGrid}
        </div>
      ) : null}

      <Sheet open={open && isPhone} onOpenChange={setOpen}>
        <SheetContent
          id={dialogId}
          side="bottom"
          aria-label={`Select ${label.toLowerCase()}`}
          className="max-h-[88svh] gap-0 overflow-y-auto rounded-t-[1.75rem] px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
        >
          <SheetTitle className="pr-10">Select {label.toLowerCase()}</SheetTitle>
          <SheetDescription className="sr-only">Choose a month and year.</SheetDescription>
          <div className="mt-3">{monthGrid}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MonthGrid({
  value,
  year,
  onYearChange,
  onSelect,
}: {
  value: string;
  year: number;
  onYearChange: (year: number) => void;
  onSelect: (monthIndex: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          aria-label="Previous year"
          onClick={() => onYearChange(year - 1)}
          className="w-ws-control px-0"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <p className="text-sm font-semibold text-dashboard-navy" aria-live="polite">
          {year}
        </p>
        <Button
          type="button"
          variant="ghost"
          aria-label="Next year"
          onClick={() => onYearChange(year + 1)}
          className="w-ws-control px-0"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {MONTHS.map((month, monthIndex) => {
          const monthValue = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
          const selected = value === monthValue;
          return (
            <Button
              key={month}
              type="button"
              variant={selected ? "secondary" : "ghost"}
              aria-label={`${month} ${year}`}
              aria-pressed={selected}
              onClick={() => onSelect(monthIndex)}
              className="w-full px-1 text-xs sm:text-sm"
            >
              {month}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function parseMonth(value: string): { year: number; month: number } | undefined {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function formatMonth(value: string): string {
  const parsed = parseMonth(value);
  if (!parsed) return "";
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(
    new Date(parsed.year, parsed.month - 1, 1)
  );
}
