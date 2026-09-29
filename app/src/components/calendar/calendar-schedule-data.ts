import type { OperationalCalendarEvent, OperationalCalendarResponse } from "@drezivo/contracts";

export const CALENDAR_START_HOUR = 7;
export const CALENDAR_END_HOUR = 21;
export const CALENDAR_HOUR_HEIGHT = 56;
export const CALENDAR_TOTAL_HEIGHT =
  (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * CALENDAR_HOUR_HEIGHT;

export type CalendarActivityType = "Pickup" | "Return" | "Fitting";

export type CalendarActivity = {
  id: string;
  source: OperationalCalendarEvent["source"];
  sourceId: string;
  eventType: OperationalCalendarEvent["event_type"];
  status: string;
  type: CalendarActivityType;
  dateKey: string;
  startAt: string;
  endAt: string;
  startMinute: number;
  durationMinutes: number;
  customerName: string | null;
  itemNames: string[];
  categoryIds: string[];
};

export type CalendarCategory = OperationalCalendarResponse["categories"][number];

export type CalendarView = "week" | "month";

const DATE_KEY_FORMATTER_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

function datePartsInTimeZone(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...DATE_KEY_FORMATTER_OPTIONS,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(instant);
  const readPart = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) throw new Error(`Missing ${type} while formatting a calendar date.`);
    return Number(value);
  };

  return {
    year: readPart("year"),
    month: readPart("month"),
    day: readPart("day"),
    hour: readPart("hour"),
    minute: readPart("minute"),
  };
}

function dateKeyFromParts(parts: { year: number; month: number; day: number }) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function calendarDateKeyAt(instant: Date, timeZone: string) {
  return dateKeyFromParts(datePartsInTimeZone(instant, timeZone));
}

export function calendarTodayDateKey(timeZone: string) {
  return calendarDateKeyAt(new Date(), timeZone);
}

export function addCalendarDays(dateKey: string, amount: number) {
  const date = parseCalendarDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatCalendarDateKey(date);
}

export function addCalendarMonths(dateKey: string, amount: number) {
  const date = parseCalendarDateKey(dateKey);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return formatCalendarDateKey(date);
}

export function startOfCalendarWeek(dateKey: string) {
  const date = parseCalendarDateKey(dateKey);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return formatCalendarDateKey(date);
}

export function getCalendarWeekDateKeys(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index));
}

export function getCalendarMonthGridDateKeys(monthStart: string) {
  const gridStart = startOfCalendarWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
}

export function formatCalendarDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function parseCalendarDateKey(dateKey: string) {
  const [yearPart, monthPart, dayPart] = dateKey.split("-");
  if (!yearPart || !monthPart || !dayPart) throw new Error("Invalid calendar date.");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== dateKey) {
    throw new Error("Invalid calendar date.");
  }
  return date;
}

export function formatCalendarDate(dateKey: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...options,
  }).format(parseCalendarDateKey(dateKey));
}

export function formatCalendarTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

/**
 * Convert a branch-local calendar boundary to an ISO instant for the API.
 * Iteratively corrects the UTC guess using the zone's represented wall time,
 * so week/month boundaries remain branch-local across DST changes.
 */
export function calendarBoundaryInstant(dateKey: string, timeZone: string) {
  const localDate = parseCalendarDateKey(dateKey);
  const desiredWallTime = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    0,
    0,
    0,
    0
  );
  let candidate = desiredWallTime;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = datePartsInTimeZone(new Date(candidate), timeZone);
    const representedWallTime = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    );
    const correction = desiredWallTime - representedWallTime;
    if (correction === 0) return new Date(candidate).toISOString();
    candidate += correction;
  }

  throw new Error("Could not resolve the branch-local calendar boundary.");
}

function minuteOfDay(instant: string, timeZone: string) {
  const parts = datePartsInTimeZone(new Date(instant), timeZone);
  return parts.hour * 60 + parts.minute;
}

function labelForEvent(event: OperationalCalendarEvent): CalendarActivityType {
  if (event.event_type === "fitting") return "Fitting";
  return event.event_type === "pickup" ? "Pickup" : "Return";
}

export function mapOperationalCalendarEvents(
  events: OperationalCalendarEvent[],
  timeZone: string,
): CalendarActivity[] {
  return events
    .map((event) => ({
      id: event.id,
      source: event.source,
      sourceId: event.source_id,
      eventType: event.event_type,
      status: event.status,
      type: labelForEvent(event),
      dateKey: calendarDateKeyAt(new Date(event.period.start), timeZone),
      startAt: event.period.start,
      endAt: event.period.end,
      startMinute: minuteOfDay(event.period.start, timeZone),
      durationMinutes: (Date.parse(event.period.end) - Date.parse(event.period.start)) / 60_000,
      customerName: event.customer_name,
      itemNames: event.item_names,
      categoryIds: event.category_ids,
    }))
    .sort((left, right) => {
      const byStart = Date.parse(left.startAt) - Date.parse(right.startAt);
      return byStart || left.id.localeCompare(right.id);
    });
}
