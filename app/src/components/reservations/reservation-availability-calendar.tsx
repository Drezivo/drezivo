"use client";

import { useMemo, useState } from "react";
import type { DateRange, DayButtonProps } from "react-day-picker";

import type {
  StaffReservationAvailabilityCalendarDay,
  StaffReservationAvailabilityCalendarResponse,
} from "@drezivo/contracts";

import { Calendar } from "@/components/ui/calendar";
import { DatePickerField } from "@/components/ui/date-picker-field";
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
  // The pickup date is Day 1, so an N-day package spans N - 1 nights: a 3-day rental picked up
  // Oct 5 is returned Oct 7. react-day-picker's range `min` counts nights.
  const includedRentalDays = availability
    ? Math.floor(availability.pricing.minimum_duration_minutes / (24 * 60))
    : 0;
  const minimumNights = Math.max(0, includedRentalDays - 1);
  const branchToday = parseCalendarDate(todayInTimeZone(timeZone));
  const disabledDates = useMemo(
    () =>
      availability?.days
        .filter((day) => day.state === "unavailable")
        .map((day) => parseCalendarDate(day.date))
        .filter((date): date is Date => date !== null) ?? [],
    [availability?.days]
  );
  const earliestCandidateReturn =
    selected?.from && !selected.to && minimumNights > 0
      ? addCalendarDays(selected.from, minimumNights)
      : null;

  const [fieldNotice, setFieldNotice] = useState<string | null>(null);
  const todayIso = todayInTimeZone(timeZone);

  /** First unavailable day inside the range, so a typed range cannot skip over a busy day. */
  const firstBusyDate = (start: string, end: string): string | null => {
    for (let day = start; day <= end; day = addIsoDays(day, 1)) {
      if (byDate.get(day)?.state === "unavailable") return day;
    }
    return null;
  };

  const choosePickupFromField = (date: string) => {
    setFieldNotice(null);
    if (!date) {
      onRangeChange({ pickupDate: "", dueDate: "" });
      return;
    }
    // Keep a return date that still works; otherwise suggest the earliest one the package allows.
    const earliest = addIsoDays(date, minimumNights);
    const keep = dueDate && dueDate >= earliest && !firstBusyDate(date, dueDate) ? dueDate : null;
    const suggested = keep ?? (firstBusyDate(date, earliest) ? "" : earliest);
    onRangeChange({ pickupDate: date, dueDate: suggested });
  };

  const chooseReturnFromField = (date: string) => {
    setFieldNotice(null);
    if (!date || !pickupDate) {
      onRangeChange({ pickupDate, dueDate: "" });
      return;
    }
    const busy = firstBusyDate(pickupDate, date);
    if (busy) {
      setFieldNotice(`${formatIsoForNotice(busy)} is not available in that range. Choose another return date.`);
      return;
    }
    onRangeChange({ pickupDate, dueDate: date });
  };

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
            "cursor-not-allowed border-red-500/20 bg-red-500/10 text-red-400",
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
          min={minimumNights}
          resetOnSelect
          disabled={[
            ...(branchToday ? [{ before: branchToday }] : []),
            ...disabledDates,
          ]}
          excludeDisabled
          onSelect={(range, triggerDate) => {
            setFieldNotice(null);
            if (
              minimumNights === 0 &&
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-dashboard-navy">Date from · pickup (Day 1)</span>
          <DatePickerField
            ariaLabel="Date from"
            placeholder="Pickup date"
            value={pickupDate}
            min={todayIso}
            disabledDates={disabledDates}
            onChange={choosePickupFromField}
          />
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-dashboard-navy">Date to · return</span>
          <DatePickerField
            ariaLabel="Date to"
            placeholder={pickupDate ? "Return date" : "Choose pickup first"}
            value={dueDate}
            min={pickupDate ? addIsoDays(pickupDate, minimumNights) : todayIso}
            disabled={!pickupDate}
            disabledDates={disabledDates}
            onChange={chooseReturnFromField}
          />
        </div>
      </div>
      {fieldNotice ? (
        <p className="text-xs text-warning-500" role="alert">
          {fieldNotice}
        </p>
      ) : null}
      {earliestCandidateReturn ? (
        <p className="text-xs text-dashboard-muted">
          This is a {includedRentalDays}-day rental. The pickup date counts as Day 1, so the earliest return date is {formatCalendarDate(earliestCandidateReturn)}.
        </p>
      ) : null}
      <p className="text-xs text-dashboard-muted">
        Day colors show when this variant&apos;s serialized garments are actually occupied. Your full rental interval plus post-return recovery is revalidated after pickup and return times are selected.
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

function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function formatIsoForNotice(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year!, month! - 1, day!))
  );
}
