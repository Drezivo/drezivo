"use client";

import { useMemo } from "react";
import type { DateRange, DayButtonProps } from "react-day-picker";

import type {
  StaffReservationAvailabilityCalendarDay,
  StaffReservationAvailabilityCalendarResponse,
} from "@drezivo/contracts";

import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

export function ReservationAvailabilityCalendar({
  availability,
  loading,
  month,
  onMonthChange,
  pickupDate,
  dueDate,
  onRangeChange,
  timeZone,
}: {
  availability: StaffReservationAvailabilityCalendarResponse | null;
  loading: boolean;
  month: Date;
  onMonthChange: (month: Date) => void;
  pickupDate: string;
  dueDate: string;
  onRangeChange: (range: { pickupDate: string; dueDate: string }) => void;
  timeZone: string;
}) {
  const byDate = useMemo(
    () => new Map(availability?.days.map((day) => [day.date, day]) ?? []),
    [availability?.days]
  );
  const selected = useMemo<DateRange | undefined>(() => {
    const from = parseCalendarDate(pickupDate);
    if (!from) return undefined;
    return { from, to: parseCalendarDate(dueDate) ?? undefined };
  }, [dueDate, pickupDate]);
  const minimumCalendarDays = availability
    ? Math.floor(availability.pricing.minimum_duration_minutes / (24 * 60))
    : 0;
  const branchToday = parseCalendarDate(todayInTimeZone(timeZone));
  const earliestCandidateReturn =
    selected?.from && !selected.to && minimumCalendarDays > 0
      ? addCalendarDays(selected.from, minimumCalendarDays)
      : null;

  const AvailabilityDayButton = ({
    day,
    modifiers,
    className,
    ...buttonProps
  }: DayButtonProps) => {
    const isoDate = toCalendarIsoDate(day.date);
    const dayAvailability = byDate.get(isoDate);
    const label = availabilityLabel(dayAvailability);
    const isSelected =
      modifiers.selected ||
      modifiers.range_start ||
      modifiers.range_middle ||
      modifiers.range_end;

    return (
      <button
        {...buttonProps}
        type="button"
        aria-label={`${buttonProps["aria-label"] ?? isoDate}. ${label}`}
        className={cn(
          "flex min-h-11 min-w-0 w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-transparent px-0.5 py-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 sm:min-h-16 sm:gap-1 sm:px-1 sm:py-2",
          dayAvailability?.state === "available" &&
            "bg-transparent text-dashboard-navy hover:bg-dashboard-active/40",
          dayAvailability?.state === "limited" &&
            "bg-dashboard-gold-soft text-dashboard-gold-text hover:bg-dashboard-gold-soft/80",
          dayAvailability?.state === "unavailable" &&
            "border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/15",
          !dayAvailability && "text-dashboard-muted",
          isSelected && "border-dashboard-accent bg-dashboard-active text-dashboard-accent",
          modifiers.today && "ring-1 ring-dashboard-accent/40",
          modifiers.disabled && "pointer-events-none opacity-40",
          className
        )}
      >
        <span className="text-xs font-semibold sm:text-sm">{day.date.getDate()}</span>
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 rounded-full sm:hidden",
            dayAvailability?.state === "limited" && "bg-dashboard-accent",
            dayAvailability?.state === "unavailable" && "bg-red-400",
            (!dayAvailability || dayAvailability?.state === "available") && "bg-dashboard-muted/50"
          )}
        />
        <span className="hidden min-h-4 truncate text-xs leading-tight sm:block">{label}</span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-surface p-2 sm:p-3">
        <Calendar
          mode="range"
          month={month}
          onMonthChange={onMonthChange}
          selected={selected}
          min={minimumCalendarDays}
          resetOnSelect
          disabled={branchToday ? { before: branchToday } : undefined}
          onSelect={(range, triggerDate) => {
            if (
              minimumCalendarDays === 0 &&
              selected?.from &&
              !selected.to &&
              isSameCalendarDay(selected.from, triggerDate)
            ) {
              const sameDay = toCalendarIsoDate(triggerDate);
              onRangeChange({ pickupDate: sameDay, dueDate: sameDay });
              return;
            }
            if (!range?.from) {
              onRangeChange({ pickupDate: "", dueDate: "" });
              return;
            }
            onRangeChange({
              pickupDate: toCalendarIsoDate(range.from),
              dueDate: range.to ? toCalendarIsoDate(range.to) : "",
            });
          }}
          components={{ DayButton: AvailabilityDayButton }}
          classNames={{
            month_grid: "w-full min-w-0 border-collapse",
            weekdays: "flex w-full min-w-0",
            weekday: "min-w-0 flex-1 py-1.5 text-center text-[10px] font-medium text-dashboard-muted sm:py-2 sm:text-xs",
            week: "mt-0.5 flex w-full min-w-0 sm:mt-1",
            day_button: "h-auto min-h-11 min-w-0 w-full sm:min-h-16",
            day: "relative min-w-0 flex-1 p-px text-center sm:p-0.5",
            range_start: "rounded-l-md",
            range_middle: "rounded-none",
            range_end: "rounded-r-md",
          }}
        />
      </div>

      <div
        className="flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-dashboard-muted sm:gap-x-4 sm:text-xs"
        aria-label="Availability legend"
      >
        <LegendSwatch className="border border-dashboard-border bg-transparent" label="Available" />
        <LegendSwatch className="bg-dashboard-gold-soft" label="Limited" />
        <LegendSwatch className="border border-red-500/20 bg-red-500/10" label="Unavailable / busy" />
        <LegendSwatch
          className="border border-dashboard-accent bg-dashboard-active"
          label="Selected"
        />
      </div>

      {loading ? (
        <p className="text-xs text-dashboard-muted" role="status">
          Loading variant availability…
        </p>
      ) : null}
      {earliestCandidateReturn ? (
        <p className="text-xs text-dashboard-muted">
          Earliest candidate return date for this fixed rental: {formatCalendarDate(earliestCandidateReturn)}. Exact pickup and return times must still meet the minimum duration.
        </p>
      ) : null}
      <p className="text-xs text-dashboard-muted">
        Day labels are planning guidance based on this variant&apos;s serialized garments. Exact pickup and return times are checked before the garment is reserved.
      </p>
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

function availabilityLabel(day: StaffReservationAvailabilityCalendarDay | undefined): string {
  if (!day) return "—";
  if (day.available_assets > 0) {
    return day.state === "limited" ? `${day.available_assets} left` : "Available";
  }
  if (day.rented_assets > 0) return "Rented";
  if (day.reserved_assets > 0) return "Reserved";
  if (day.fitting_assets > 0) return "Fitting";
  if (day.maintenance_assets > 0) return "Maintenance";
  if (day.transfer_assets > 0) return "Unavailable";
  return "Unavailable";
}

export function toCalendarIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function monthWindow(month: Date): { startDate: string; endDate: string } {
  return {
    startDate: toCalendarIsoDate(new Date(month.getFullYear(), month.getMonth(), 1)),
    endDate: toCalendarIsoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0)),
  };
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatCalendarDate(date: Date): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
