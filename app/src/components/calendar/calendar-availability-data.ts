import type {
  ClothingAvailabilityTimelineAgenda,
  ClothingAvailabilityTimelineStatus,
  ClothingAvailabilityTimelineUnavailableReason,
} from "@drezivo/contracts";

export const AVAILABILITY_WINDOW_DAYS = 14;

export type AvailabilityDay = {
  date: string;
  label: string;
  dateLabel: string;
};

export type AgendaPlacement = {
  startColumn: number;
  span: number;
};

const statusLabels: Record<ClothingAvailabilityTimelineStatus, string> = {
  reserved: "Reserved",
  rented: "Rented",
  unavailable: "Unavailable",
};

const unavailableReasonLabels: Record<ClothingAvailabilityTimelineUnavailableReason, string> = {
  recovery: "Recovery",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  manual_block: "Manual block",
  other: "Other",
};

export function availabilityStatusLabel(status: ClothingAvailabilityTimelineStatus): string {
  return statusLabels[status];
}

export function unavailableReasonLabel(
  reason: ClothingAvailabilityTimelineUnavailableReason | null
): string | null {
  return reason ? unavailableReasonLabels[reason] : null;
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return instantToDateKey(now, timeZone);
}

export function addCalendarDays(value: string, amount: number): string {
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return toCalendarDateKey(date);
}

export function buildAvailabilityDays(
  startDate: string,
  endDate = addCalendarDays(startDate, AVAILABILITY_WINDOW_DAYS - 1)
): AvailabilityDay[] {
  const dayCount = calendarDayDifference(startDate, endDate) + 1;
  return Array.from({ length: Math.max(0, dayCount) }, (_, index) => {
    const date = parseCalendarDate(addCalendarDays(startDate, index));
    return {
      date: toCalendarDateKey(date),
      label: new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: "UTC",
      }).format(date),
      dateLabel: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(date),
    };
  });
}

export function formatAvailabilityRange(startDate: string, endDate: string): string {
  const start = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);
  return `${startLabel} – ${endLabel}`;
}

export function formatAgendaDateRange(
  agenda: ClothingAvailabilityTimelineAgenda,
  timeZone: string
): string {
  const startDate = displayAgendaStartDate(agenda, timeZone);
  const endInstant = new Date(Date.parse(agenda.period.end) - 1);
  const endDate = instantToDateKey(endInstant, timeZone);
  if (startDate === endDate) return formatCalendarDate(startDate);
  return `${formatCalendarDate(startDate)} – ${formatCalendarDate(endDate)}`;
}

export function formatBoundarySummary(agenda: ClothingAvailabilityTimelineAgenda): string | null {
  const labels: string[] = [];
  if (agenda.pickup) labels.push(`Pickup ${formatCalendarDate(agenda.pickup.date)}`);
  if (agenda.return) labels.push(`Return ${formatCalendarDate(agenda.return.date)}`);
  return labels.length > 0 ? labels.join(" · ") : null;
}

export function formatBoundaryDateTime(
  value: { at: string } | null,
  timeZone: string
): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value.at));
}

export function agendaPlacement(
  agenda: ClothingAvailabilityTimelineAgenda,
  windowStart: string,
  windowEnd: string,
  timeZone: string
): AgendaPlacement | null {
  const agendaStart = displayAgendaStartDate(agenda, timeZone);
  const endMilliseconds = Date.parse(agenda.period.end);
  if (!Number.isFinite(endMilliseconds)) return null;

  // API periods are end-exclusive. Subtracting one millisecond prevents a midnight end from
  // incorrectly occupying the following calendar day in this day-based projection.
  const agendaEnd = instantToDateKey(new Date(endMilliseconds - 1), timeZone);
  const clippedStart = agendaStart < windowStart ? windowStart : agendaStart;
  const clippedEnd = agendaEnd > windowEnd ? windowEnd : agendaEnd;
  if (clippedStart > clippedEnd) return null;

  return {
    startColumn: calendarDayDifference(windowStart, clippedStart) + 1,
    span: calendarDayDifference(clippedStart, clippedEnd) + 1,
  };
}

export function formatMinorMoney(value: string, currency: string): string {
  const amount = Number(value) / 100;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function displayAgendaStartDate(
  agenda: ClothingAvailabilityTimelineAgenda,
  timeZone: string
): string {
  const periodStartDate = instantToDateKey(new Date(agenda.period.start), timeZone);

  // This is a day-based planning grid: the reservation owns its return calendar day, while the
  // post-rental recovery block begins on the following branch-local day.
  return agenda.type === "unavailable" && agenda.unavailable_reason === "recovery"
    ? addCalendarDays(periodStartDate, 1)
    : periodStartDate;
}

function formatCalendarDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseCalendarDate(value));
}

function instantToDateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");
  if (!year || !month || !day) throw new Error("Calendar date could not be formatted.");
  return `${year}-${month}-${day}`;
}

export function calendarDayDifference(startDate: string, endDate: string): number {
  return Math.round(
    (parseCalendarDate(endDate).getTime() - parseCalendarDate(startDate).getTime()) /
      (24 * 60 * 60 * 1_000)
  );
}

function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid calendar date: ${value}`);
  return new Date(Date.UTC(year, month - 1, day));
}

function toCalendarDateKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
