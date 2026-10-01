"use client";

import { Check, ChevronDown, Clock3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Period = "AM" | "PM";

type TimeParts = {
  hour: string;
  minute: string;
  period: Period;
};

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
function minuteOptions(step: number): string[] {
  return Array.from({ length: Math.ceil(60 / step) }, (_, index) =>
    String(index * step).padStart(2, "0")
  );
}

export function TimePickerField({
  value,
  onChange,
  ariaLabel,
  placeholder = "Select time",
  disabled = false,
  min,
  minuteStep = 1,
  className,
  popoverAlign = "start",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  /** Offer only minutes on this step (30 shows :00 and :30) when nothing else is accepted. */
  minuteStep?: number;
  className?: string;
  popoverAlign?: "start" | "end";
}) {
  const parsedValue = useMemo(() => parseTime(value), [value]);
  const minutes = useMemo(() => minuteOptions(minuteStep), [minuteStep]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TimeParts>(() =>
    snapMinute(parsedValue ?? defaultTimeParts(), minuteStep)
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(snapMinute(parsedValue ?? defaultTimeParts(), minuteStep));
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
  }, [open, parsedValue, minuteStep]);

  const draftValue = to24HourTime(draft);
  const belowMinimum = Boolean(min && draftValue < min);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-left text-sm text-dashboard-navy transition-colors hover:border-dashboard-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Clock3 className="h-4 w-4 shrink-0 text-dashboard-muted" />
          <span className={cn("truncate font-medium", !parsedValue && "font-normal text-dashboard-muted")}>
            {parsedValue ? formatDisplayTime(parsedValue) : placeholder}
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
        <div
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-50 w-[18rem] max-w-[calc(100vw-2rem)] rounded-lg border border-dashboard-border bg-dashboard-surface p-3 shadow-xl",
            popoverAlign === "end" ? "right-0" : "left-0"
          )}
        >
          <p className="mb-3 text-xs font-medium text-dashboard-muted">Choose time</p>
          <div className="grid grid-cols-[1fr_auto_1fr_1fr] items-center gap-2">
            <TimeSelect
              ariaLabel={`${ariaLabel} hour`}
              value={draft.hour}
              options={HOURS}
              onChange={(hour) => setDraft((current) => ({ ...current, hour }))}
            />
            <span className="text-lg font-semibold text-dashboard-muted">:</span>
            <TimeSelect
              ariaLabel={`${ariaLabel} minute`}
              value={draft.minute}
              options={minutes}
              onChange={(minute) => setDraft((current) => ({ ...current, minute }))}
            />
            <TimeSelect
              ariaLabel={`${ariaLabel} period`}
              value={draft.period}
              options={["AM", "PM"]}
              onChange={(period) =>
                setDraft((current) => ({ ...current, period: period as Period }))
              }
            />
          </div>
          {belowMinimum && min ? (
            <p className="mt-2 text-xs text-dashboard-attention">
              Earliest valid time is {formatDisplayTime(parseTime(min) ?? defaultTimeParts())}.
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-dashboard-border pt-3">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={belowMinimum}
              onClick={() => {
                onChange(draftValue);
                setOpen(false);
              }}
            >
              <Check className="h-3.5 w-3.5" />
              Set time
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimeSelect({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative min-w-0">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full appearance-none rounded-md border border-dashboard-border bg-dashboard-surface pl-3 pr-9 text-sm font-medium text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted"
      />
    </div>
  );
}

function parseTime(value: string): TimeParts | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) return null;
  const period: Period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return {
    hour: String(hour12).padStart(2, "0"),
    minute: String(minute).padStart(2, "0"),
    period,
  };
}

function defaultTimeParts(): TimeParts {
  const now = new Date();
  const hour24 = now.getHours();
  return {
    hour: String(hour24 % 12 || 12).padStart(2, "0"),
    minute: String(now.getMinutes()).padStart(2, "0"),
    period: hour24 >= 12 ? "PM" : "AM",
  };
}

/** A minute the select cannot show would be submitted invisibly, so round it down onto the step. */
function snapMinute(parts: TimeParts, step: number): TimeParts {
  const minute = Math.floor(Number(parts.minute) / step) * step;
  return { ...parts, minute: String(minute).padStart(2, "0") };
}

function to24HourTime(parts: TimeParts): string {
  let hour = Number(parts.hour) % 12;
  if (parts.period === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${parts.minute}`;
}

function formatDisplayTime(parts: TimeParts): string {
  return `${parts.hour}:${parts.minute} ${parts.period}`;
}
