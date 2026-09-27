"use client";

import { useEffect, useMemo, useState } from "react";

import type { FittingDetail } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

import { formatFittingDate, formatFittingTimeRange } from "./fittings-presentation";

type RescheduleFittingFormProps = {
  fitting: FittingDetail;
  getToken: () => Promise<string | null>;
  timeZone: string;
  onCancel: () => void;
  onRescheduled: (fitting: FittingDetail) => void;
};

export function RescheduleFittingForm({
  fitting,
  getToken,
  timeZone,
  onCancel,
  onRescheduled,
}: RescheduleFittingFormProps) {
  const initial = useMemo(
    () => localDateTimeFields(fitting.period.start, timeZone),
    [fitting.period.start, timeZone]
  );
  const today = useMemo(() => todayInTimeZone(timeZone), [timeZone]);
  const durationMinutes = Math.max(
    1,
    Math.round(
      (new Date(fitting.period.end).getTime() - new Date(fitting.period.start).getTime()) / 60_000
    )
  );
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.time);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<DrezivoApiError | null>(null);
  const {
    isSubmitting,
    resetIntent: resetRescheduleIntent,
    submit: submitReschedule,
  } = useSubmitGuard();

  useEffect(() => {
    setDate(initial.date);
    setStartTime(initial.time);
    setValidationMessage(null);
    setSubmitError(null);
    resetRescheduleIntent();
  }, [fitting.id, fitting.version, initial.date, initial.time, resetRescheduleIntent]);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!date || date < today) {
      setValidationMessage("Choose today or a future date.");
      return;
    }
    const startMinute = Number(startTime.split(":")[1] ?? Number.NaN);
    if (!Number.isInteger(startMinute) || startMinute % 30 !== 0) {
      setValidationMessage("Fitting start time must be on a 30-minute boundary.");
      return;
    }

    const startsAt = zonedDateTimeToIso(date, startTime, timeZone);
    if (!startsAt) {
      setValidationMessage("Choose a valid fitting date and time.");
      return;
    }
    if (new Date(startsAt).getTime() <= Date.now()) {
      setValidationMessage("Choose a fitting time in the future.");
      return;
    }
    if (startsAt === fitting.period.start) {
      setValidationMessage("Choose a different date or time before rescheduling.");
      return;
    }

    setValidationMessage(null);
    setSubmitError(null);
    try {
      const result = await submitReschedule((idempotencyKey) =>
        createDrezivoApiClient(getToken).rescheduleFitting(
          fitting.id,
          { version: fitting.version, starts_at: startsAt },
          idempotencyKey
        )
      );
      if (!result) return;
      onRescheduled(result.data.fitting);
      resetRescheduleIntent();
    } catch (error) {
      setSubmitError(toDrezivoApiError(error));
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-dashboard-border bg-dashboard-canvas p-4">
      <p className="text-sm font-semibold text-dashboard-navy">Reschedule fitting</p>
      <p className="mt-1 text-xs text-dashboard-muted">
        Current: {formatFittingDate(fitting.period.start, timeZone)} ·{" "}
        {formatFittingTimeRange(fitting.period.start, fitting.period.end, timeZone)}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">New date</span>
          <DatePickerField
            ariaLabel="Reschedule fitting date"
            value={date}
            min={today}
            clearable={false}
            disabled={isSubmitting}
            onChange={setDate}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
            New start time
          </span>
          <TimePickerField
            ariaLabel="Reschedule fitting start time"
            value={startTime}
            disabled={isSubmitting}
            popoverAlign="end"
            onChange={setStartTime}
          />
        </label>
      </div>

      <p className="mt-3 text-xs text-dashboard-muted">
        The appointment remains {durationMinutes} minutes. Drezivo will recheck branch hours,
        closures, fitting capacity, and any guaranteed garment before saving the new time.
      </p>

      {validationMessage ? (
        <div
          role="alert"
          className="mt-3 rounded-lg bg-dashboard-attention/10 px-3 py-2 text-sm text-dashboard-attention"
        >
          {validationMessage}
        </div>
      ) : null}
      {submitError ? (
        <div
          role="alert"
          className="mt-3 rounded-lg bg-dashboard-danger/10 px-3 py-2 text-sm text-dashboard-danger"
        >
          <p>{submitError.message}</p>
          {submitError.requestId ? (
            <p className="mt-1 text-xs">Request ID: {submitError.requestId}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onCancel}>
          Keep current time
        </Button>
        <Button
          type="button"
          isPending={isSubmitting}
          pendingLabel="Rescheduling…"
          onClick={() => void handleSubmit()}
        >
          Save new time
        </Button>
      </div>
    </div>
  );
}

function localDateTimeFields(
  instantValue: string,
  timeZone: string
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(instantValue));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values["year"]}-${values["month"]}-${values["day"]}`,
    time: `${values["hour"]}:${values["minute"]}`,
  };
}

function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

function zonedDateTimeToIso(dateValue: string, timeValue: string, timeZone: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const wallTimeUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = new Date(wallTimeUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    instant = new Date(wallTimeUtc - timeZoneOffsetMs(instant, timeZone));
  }
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return (
    Date.UTC(
      Number(values["year"]),
      Number(values["month"]) - 1,
      Number(values["day"]),
      Number(values["hour"]),
      Number(values["minute"]),
      Number(values["second"])
    ) - instant.getTime()
  );
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("The fitting could not be rescheduled. Please try again.", {
        status: 500,
      });
}
