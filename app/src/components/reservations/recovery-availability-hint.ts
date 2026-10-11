import type {
  StaffReservationAvailabilityCalendarResponse,
  StaffReservationAvailabilityCheckResponse,
} from "@drezivo/contracts";

/**
 * Returns an explanatory hint only when the exact check and branch-local day projection together
 * isolate the conflict to post-return recovery. This is presentation-only; exact availability
 * remains authoritative.
 */
export function recoveryAvailabilityHint(
  itemLabel: string,
  exact: StaffReservationAvailabilityCheckResponse | null,
  calendar: StaffReservationAvailabilityCalendarResponse | undefined,
  timeZone: string
): string | null {
  if (!exact || exact.available || exact.available_assets > 0 || !calendar) return null;
  if (calendar.variant_id !== exact.variant_id || calendar.timezone !== timeZone) return null;

  const recoveryMinutes = exact.pricing.recovery_minutes;
  if (recoveryMinutes <= 0) return null;

  const requestedStart = Date.parse(exact.requested_interval.start);
  const requestedEnd = Date.parse(exact.requested_interval.end);
  const blockedStart = Date.parse(exact.blocked_interval.start);
  const blockedEnd = Date.parse(exact.blocked_interval.end);
  const expectedBlockedEnd = requestedEnd + recoveryMinutes * 60_000;
  if (
    ![requestedStart, requestedEnd, blockedStart, blockedEnd].every(Number.isFinite) ||
    requestedStart >= requestedEnd ||
    blockedStart !== requestedStart ||
    blockedEnd <= requestedEnd ||
    blockedEnd !== expectedBlockedEnd
  ) {
    return null;
  }

  const rentalStart = localDate(requestedStart, timeZone);
  const rentalEnd = localDate(requestedEnd - 1, timeZone);
  const recoveryStart = localDate(requestedEnd, timeZone);
  const recoveryEnd = localDate(blockedEnd - 1, timeZone);
  if (!rentalStart || !rentalEnd || !recoveryStart || !recoveryEnd || rentalStart > rentalEnd) {
    return null;
  }

  const rentalDates = datesBetween(rentalStart, rentalEnd);
  // A day shared by the rental and recovery portions cannot establish that recovery alone caused
  // the conflict. Only inspect whole local dates strictly after the rental's last date.
  const recoveryDates = datesBetween(recoveryStart, recoveryEnd).filter((date) => date > rentalEnd);
  if (rentalDates.length === 0 || recoveryDates.length === 0) return null;

  const relevantDates = [...rentalDates, ...recoveryDates];
  if (
    relevantDates.some(
      (date) => date < calendar.window.start_date || date > calendar.window.end_date
    )
  ) {
    return null;
  }

  const daysByDate = new Map(calendar.days.map((day) => [day.date, day]));
  const rentalDays = rentalDates.map((date) => daysByDate.get(date));
  const recoveryDays = recoveryDates.map((date) => daysByDate.get(date));
  if (rentalDays.some((day) => !day) || recoveryDays.some((day) => !day)) return null;

  // If a calendar day in the requested rental period is unavailable, keep the generic wording:
  // the day-level projection cannot distinguish a rental conflict from a recovery conflict.
  if (rentalDays.some((day) => day!.state === "unavailable" || day!.available_assets === 0)) {
    return null;
  }

  const conflictingRecoveryDates = recoveryDates.filter((date) => {
    const day = daysByDate.get(date)!;
    return day.state === "unavailable" || day.available_assets === 0;
  });
  if (conflictingRecoveryDates.length === 0) return null;

  const duration = formatDuration(recoveryMinutes);
  const dates = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
    conflictingRecoveryDates.map(formatDate)
  );
  return `${itemLabel} is unavailable: its ${duration} recovery after return extends into ${dates}, when no pieces are free.`;
}

function localDate(timestamp: number, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(timestamp));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function datesBetween(start: string, end: string): string[] {
  const first = Date.parse(`${start}T00:00:00.000Z`);
  const last = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return [];
  const count = Math.floor((last - first) / 86_400_000) + 1;
  // The exact-check contract caps rental intervals at 31 days; this also protects against
  // malformed timestamps or unexpectedly huge recovery values.
  if (count > 400) return [];
  return Array.from({ length: count }, (_, index) =>
    new Date(first + index * 86_400_000).toISOString().slice(0, 10)
  );
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDuration(minutes: number): string {
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440;
    return `${days}-day`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours}-hour`;
  }
  return `${minutes}-minute`;
}
