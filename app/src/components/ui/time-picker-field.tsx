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
const QUICK_TIMES = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  return `${String(hour).padStart(2, "0")}:${minute}`;
});

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
  mode = "picker",
  quickStart = "00:00",
  quickEnd = "24:00",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  /** Offer only minutes on this step when the picker/input is constrained (30 shows :00 and :30). */
  minuteStep?: number;
  className?: string;
  popoverAlign?: "start" | "end";
  mode?: "picker" | "input";
  quickStart?: string;
  quickEnd?: string;
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

  if (mode === "input") {
    return (
      <EditableTimeField
        value={value}
        onChange={onChange}
        ariaLabel={ariaLabel}
        placeholder={placeholder === "Select time" ? "hh:mm AM/PM" : placeholder}
        disabled={disabled}
        {...(min ? { min } : {})}
        minuteStep={minuteStep}
        {...(className ? { className } : {})}
        popoverAlign={popoverAlign}
        quickStart={quickStart}
        quickEnd={quickEnd}
      />
    );
  }

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

function EditableTimeField({
  value,
  onChange,
  ariaLabel,
  disabled,
  min,
  minuteStep,
  className,
  popoverAlign,
  quickStart,
  quickEnd,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
  disabled: boolean;
  min?: string;
  minuteStep: number;
  className?: string;
  popoverAlign: "start" | "end";
  quickStart: string;
  quickEnd: string;
}) {
  const parsedValue = useMemo(() => parseTime(value), [value]);
  const [hour, setHour] = useState(parsedValue?.hour ?? "");
  const [minute, setMinute] = useState(parsedValue?.minute ?? "");
  const [period, setPeriod] = useState<Period>(parsedValue?.period ?? "AM");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHour(parsedValue?.hour ?? "");
    setMinute(parsedValue?.minute ?? "");
    setPeriod(parsedValue?.period ?? "AM");
    setError(null);
  }, [parsedValue]);

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

  const commit = (nextHour = hour, nextMinute = minute, nextPeriod = period) => {
    if (!nextHour && !nextMinute) {
      setError(null);
      onChange("");
      return;
    }
    const hourNumber = Number(nextHour);
    const minuteNumber = Number(nextMinute);
    if (!/^\d{1,2}$/.test(nextHour) || hourNumber < 1 || hourNumber > 12 || !/^\d{1,2}$/.test(nextMinute) || minuteNumber < 0 || minuteNumber > 59) {
      setError("Enter a valid time.");
      return;
    }
    if (minuteNumber % minuteStep !== 0) {
      setError(`Enter a time on a ${minuteStep}-minute boundary.`);
      return;
    }
    const normalized = to24HourTime({
      hour: String(hourNumber).padStart(2, "0"),
      minute: String(minuteNumber).padStart(2, "0"),
      period: nextPeriod,
    });
    if (min && normalized < min) {
      const minimum = parseTime(min);
      setError(minimum ? `Earliest valid time is ${formatDisplayTime(minimum)}.` : "This time is earlier than allowed.");
      return;
    }
    const normalizedParts = parseTime(normalized);
    if (normalizedParts) {
      setHour(normalizedParts.hour);
      setMinute(normalizedParts.minute);
      setPeriod(normalizedParts.period);
    }
    setError(null);
    if (normalized !== value) onChange(normalized);
  };

  const quickTimes = QUICK_TIMES.filter((quickTime) => quickTime >= quickStart && quickTime < quickEnd);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="flex items-center gap-2">
        <Clock3 className="h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />
        <input
          aria-label={`${ariaLabel} hour`}
          inputMode="numeric"
          maxLength={2}
          disabled={disabled}
          placeholder="hh"
          value={hour}
          onChange={(event) => {
            setHour(event.target.value.replace(/\D/g, "").slice(0, 2));
            if (error) setError(null);
          }}
          onBlur={() => commit()}
          className="h-10 w-16 rounded-md border border-dashboard-border bg-dashboard-surface px-2 text-center text-sm font-medium text-dashboard-navy outline-none placeholder:text-dashboard-muted focus:ring-2 focus:ring-dashboard-accent/30"
        />
        <span className="text-dashboard-muted">:</span>
        <input
          aria-label={`${ariaLabel} minute`}
          inputMode="numeric"
          maxLength={2}
          disabled={disabled}
          placeholder="mm"
          value={minute}
          onChange={(event) => {
            setMinute(event.target.value.replace(/\D/g, "").slice(0, 2));
            if (error) setError(null);
          }}
          onBlur={() => commit()}
          className="h-10 w-16 rounded-md border border-dashboard-border bg-dashboard-surface px-2 text-center text-sm font-medium text-dashboard-navy outline-none placeholder:text-dashboard-muted focus:ring-2 focus:ring-dashboard-accent/30"
        />
        <div className="relative">
          <select
            aria-label={`${ariaLabel} period`}
            disabled={disabled}
            value={period}
            onChange={(event) => {
              const nextPeriod = event.target.value as Period;
              setPeriod(nextPeriod);
              commit(hour, minute, nextPeriod);
            }}
            className="h-10 appearance-none rounded-md border border-dashboard-border bg-dashboard-surface py-2 pl-3 pr-9 text-sm font-medium text-dashboard-navy outline-none focus:ring-2 focus:ring-dashboard-accent/30"
          >
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted"
          />
        </div>
        <button
          type="button"
          aria-label={`Choose ${ariaLabel.toLowerCase()}`}
          aria-expanded={open}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashboard-border text-dashboard-muted hover:text-dashboard-navy disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </div>

      {error ? <p className="mt-1.5 text-xs text-dashboard-danger">{error}</p> : null}

      {open ? (
        <div
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-50 w-[18rem] max-w-[calc(100vw-2rem)] rounded-lg border border-dashboard-border bg-dashboard-surface p-2 shadow-xl",
            popoverAlign === "end" ? "right-0" : "left-0"
          )}
        >
          <p className="px-2 pb-2 text-xs font-medium text-dashboard-muted">Quick times</p>
          <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto pr-1">
            {quickTimes.map((quickTime) => {
              const quickParts = parseTime(quickTime);
              const belowMinimum = Boolean(min && quickTime < min);
              const selected = value === quickTime;
              return (
                <button
                  key={quickTime}
                  type="button"
                  disabled={belowMinimum}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (!quickParts) return;
                    onChange(quickTime);
                    setHour(quickParts.hour);
                    setMinute(quickParts.minute);
                    setPeriod(quickParts.period);
                    setError(null);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors",
                    selected ? "bg-dashboard-active font-medium text-dashboard-navy" : "text-dashboard-navy hover:bg-dashboard-active/60",
                    belowMinimum && "cursor-not-allowed opacity-35"
                  )}
                >
                  <span>{quickParts ? formatDisplayTime(quickParts) : quickTime}</span>
                  {selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                </button>
              );
            })}
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

function parseFlexibleTime(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, " ");
  if (!normalized) return null;

  const twentyFourHour = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const compact = normalized.replace(/\s/g, "");
  const twelveHour = /^(\d{1,2})(?::?(\d{2}))?([AP])(?:M)?$/.exec(compact);
  if (!twelveHour) return null;

  const hour12 = Number(twelveHour[1]);
  const minute = Number(twelveHour[2] ?? "00");
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;

  let hour24 = hour12 % 12;
  if (twelveHour[3] === "P") hour24 += 12;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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

/** A minute the picker cannot show would be submitted invisibly, so round it down onto the step. */
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
