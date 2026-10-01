"use client";

import { CalendarDays, ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DateRange as DayPickerDateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

export type DateRangeValue = {
  from: string;
  to: string;
};

export function DateRangePickerField({
  value,
  onChange,
  ariaLabel,
  placeholder = "Select pickup date",
  invalid = false,
  disabled = false,
  className,
  startFreshOnOpen = false,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  ariaLabel: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  startFreshOnOpen?: boolean;
}) {
  const externalRange = useMemo<DayPickerDateRange | undefined>(() => {
    const from = parseIsoDate(value.from);
    const to = parseIsoDate(value.to);
    if (!from) return undefined;
    return { from, ...(to ? { to } : {}) };
  }, [value.from, value.to]);
  const [draftRange, setDraftRange] = useState<DayPickerDateRange | undefined>(externalRange);
  const [freshRangeStarted, setFreshRangeStarted] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setDraftRange(externalRange);
  }, [externalRange, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const today = startOfDay(new Date());
  const displayValue = formatDisplayRange(value);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-invalid={invalid}
        disabled={disabled}
        onClick={() => {
          setOpen((current) => {
            const nextOpen = !current;
            if (nextOpen) {
              setDraftRange(startFreshOnOpen ? undefined : externalRange);
              setFreshRangeStarted(false);
            }
            return nextOpen;
          });
        }}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border bg-dashboard-surface px-3 text-left text-sm text-dashboard-navy transition-colors hover:border-dashboard-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:pointer-events-none disabled:opacity-50",
          invalid ? "border-danger-500/70" : "border-dashboard-border"
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-dashboard-muted" />
          <span className={cn("truncate", !displayValue && "text-dashboard-muted")}>
            {displayValue || placeholder}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-dashboard-muted transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div className="absolute left-1/2 top-[calc(100%+0.5rem)] z-50 w-[calc(100vw-2rem)] max-w-[22rem] -translate-x-1/2 rounded-lg border border-dashboard-border bg-dashboard-surface p-2 shadow-xl sm:left-0 sm:w-[22rem] sm:translate-x-0 sm:p-3">
          <Calendar
            mode="range"
            selected={draftRange}
            defaultMonth={draftRange?.from ?? today}
            onSelect={(range) => {
              if (!range?.from) return;

              if (startFreshOnOpen && !freshRangeStarted) {
                setDraftRange({ from: range.from });
                setFreshRangeStarted(true);
                return;
              }

              setDraftRange(range);
              if (!range.to) {
                const date = formatIsoDate(range.from);
                onChange({ from: date, to: date });
                return;
              }

              onChange({
                from: formatIsoDate(range.from),
                to: formatIsoDate(range.to),
              });
              setFreshRangeStarted(false);
              setOpen(false);
            }}
          />

          <div className="mt-3 flex items-center justify-between border-t border-dashboard-border pt-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-zinc-200 hover:text-white"
              onClick={() => {
                const date = formatIsoDate(today);
                onChange({ from: date, to: date });
                setOpen(false);
              }}
            >
              Today
            </Button>
            {value.from || value.to ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange({ from: "", to: "" });
                  setDraftRange(undefined);
                  setOpen(false);
                }}
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function parseIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayRange(value: DateRangeValue): string {
  const from = parseIsoDate(value.from);
  const to = parseIsoDate(value.to);
  if (!from) return "";
  if (!to || value.from === value.to) return formatDisplayDate(from);
  return `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
}

function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
