"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import {
  calendarClosedReason,
  formatCalendarDate,
  formatCalendarTime,
  isActivityOutsideBusinessHours,
  type CalendarActivity,
  type CalendarActivityType,
  type CalendarBusinessHours,
} from "@/components/calendar/calendar-schedule-data";
import { cn } from "@/lib/utils";

/*
 * Phone calendar (below 640px). A week grid squeezed onto a phone either scrolls sideways or
 * becomes unreadable, so phones get the pattern mobile calendars converge on: a seven-day strip to
 * pick the day, and that day's activities as a list. Both swipe like iOS: the content follows the
 * finger, and a release past the threshold moves to the next or previous week/day.
 */

const activityTone: Record<CalendarActivityType, string> = {
  Pickup: "calendar-activity-pickup",
  Return: "calendar-activity-return",
  Fitting: "calendar-activity-fitting",
};

/** iOS's own deceleration curve; used for every settle so the strip and list move as one system. */
const IOS_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SWIPE_COMMIT_PX = 56;

/**
 * Horizontal swipe that leaves vertical scrolling native (touch-action: pan-y on the element).
 * The element follows the finger with resistance; releasing past the threshold calls onSwipe.
 */
function useHorizontalSwipe(onSwipe: (direction: -1 | 1) => void) {
  const element = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null);

  const settle = (offset: number) => {
    const node = element.current;
    if (!node) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    node.style.transition = reduced ? "none" : `transform 380ms ${IOS_EASE}`;
    node.style.transform = offset ? `translate3d(${offset}px,0,0)` : "";
  };

  return {
    ref: element,
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.pointerType === "mouse") return;
      gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId, horizontal: null };
      if (element.current) element.current.style.transition = "none";
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.horizontal === null && Math.hypot(dx, dy) > 8) start.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!start.horizontal || !element.current) return;
      // Rubber-band: the content moves at 60% of the finger, like an iOS page at its edge.
      element.current.style.transform = `translate3d(${dx * 0.6}px,0,0)`;
    },
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      const start = gesture.current;
      gesture.current = null;
      if (!start || !start.horizontal) return settle(0);
      const dx = event.clientX - start.x;
      if (Math.abs(dx) >= SWIPE_COMMIT_PX) onSwipe(dx < 0 ? 1 : -1);
      settle(0);
    },
    onPointerCancel() {
      gesture.current = null;
      settle(0);
    },
  };
}

export function PhoneWeekStrip({
  dateKeys,
  selectedKey,
  todayKey,
  activityCountByDate,
  businessHours,
  onSelect,
  onSwipeWeek,
}: {
  dateKeys: string[];
  selectedKey: string;
  todayKey: string;
  activityCountByDate: ReadonlyMap<string, number>;
  businessHours: CalendarBusinessHours | null;
  onSelect: (dateKey: string) => void;
  onSwipeWeek: (direction: -1 | 1) => void;
}) {
  const swipe = useHorizontalSwipe(onSwipeWeek);

  return (
    <div
      {...swipe}
      role="group"
      aria-label="Choose a day this week. Swipe for another week."
      className="grid touch-pan-y select-none grid-cols-7 gap-1"
    >
      {dateKeys.map((dateKey) => {
        const selected = dateKey === selectedKey;
        const today = dateKey === todayKey;
        const count = activityCountByDate.get(dateKey) ?? 0;
        const closed = businessHours ? calendarClosedReason(dateKey, businessHours) !== null : false;
        return (
          <button
            key={dateKey}
            type="button"
            aria-pressed={selected}
            aria-label={`${formatCalendarDate(dateKey, { weekday: "long", month: "long", day: "numeric" })}, ${count} ${count === 1 ? "activity" : "activities"}${closed ? ", closed" : ""}`}
            onClick={() => onSelect(dateKey)}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-dashboard-navy transition-[background-color,color,transform] duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent",
              selected ? "bg-dashboard-navy text-dashboard-canvas" : "hover:bg-dashboard-active",
              !selected && today && "ring-1 ring-inset ring-dashboard-accent",
              closed && !selected && "text-dashboard-muted"
            )}
          >
            <span className={cn("text-[0.6875rem] font-medium uppercase tracking-wide", selected ? "opacity-80" : "text-dashboard-muted")}>
              {formatCalendarDate(dateKey, { weekday: "narrow" })}
            </span>
            <span className="text-base font-semibold tabular-nums leading-none">
              {formatCalendarDate(dateKey, { day: "numeric" })}
            </span>
            <span aria-hidden="true" className="flex h-1.5 items-center gap-0.5">
              {Array.from({ length: Math.min(count, 3) }).map((_, index) => (
                <span key={index} className={cn("h-1 w-1 rounded-full", selected ? "bg-dashboard-canvas" : "bg-dashboard-accent")} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PhoneDayAgenda({
  dateKey,
  activities,
  businessHours,
  timeZone,
  onOpenActivity,
  onSwipeDay,
}: {
  dateKey: string;
  activities: CalendarActivity[];
  businessHours: CalendarBusinessHours | null;
  timeZone: string;
  onOpenActivity: (activity: CalendarActivity) => void;
  onSwipeDay: (direction: -1 | 1) => void;
}) {
  const swipe = useHorizontalSwipe(onSwipeDay);
  const sorted = [...activities].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  const untimed = sorted.filter((activity) => activity.timeUnspecified);
  const timed = sorted.filter((activity) => !activity.timeUnspecified);
  const closedReason = businessHours ? calendarClosedReason(dateKey, businessHours) : null;

  return (
    <section aria-labelledby="phone-agenda-day" className="min-h-[50svh]">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h2 id="phone-agenda-day" className="text-base font-semibold text-dashboard-navy">
          {formatCalendarDate(dateKey, { weekday: "long", month: "long", day: "numeric" })}
        </h2>
        <p className="text-sm text-dashboard-muted tabular-nums">
          {sorted.length} {sorted.length === 1 ? "activity" : "activities"}
        </p>
      </div>
      <div {...swipe} className="touch-pan-y">
        {sorted.length === 0 ? (
          <p className="border-t border-dashboard-border py-10 text-center text-sm text-dashboard-muted">
            {closedReason ? `Closed · ${closedReason}` : "Nothing scheduled. Swipe for another day."}
          </p>
        ) : (
          <div className="space-y-4">
            {untimed.length > 0 ? (
              <section aria-labelledby="phone-agenda-untimed-heading">
                <h3 id="phone-agenda-untimed-heading" className="mb-1 text-sm font-semibold text-dashboard-muted">
                  No specific time
                </h3>
                <ol className="divide-y divide-dashboard-border border-y border-dashboard-border">
                  {untimed.map((activity) => {
                    const who = activity.customerName;
                    const what = activity.itemNames.join(", ") || "Scheduled activity";
                    return (
                      <li key={activity.id}>
                        <button
                          type="button"
                          onClick={() => onOpenActivity(activity)}
                          aria-label={`Open ${activity.type.toLowerCase()} with no specific time: ${who ?? what}`}
                          className="flex w-full items-center gap-3 py-3.5 text-left transition-colors active:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent"
                        >
                          <span aria-hidden="true" className={cn("h-8 w-[3px] shrink-0 rounded-full", activityTone[activity.type])} />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                              <span className="font-semibold text-dashboard-navy">{activity.type}</span>
                              <span className="capitalize text-dashboard-muted">{activity.status.replaceAll("_", " ")}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-sm text-dashboard-navy">{what}</span>
                            {who ? <span className="block truncate text-sm text-dashboard-muted">{who}</span> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}
            {timed.length > 0 ? (
              <ol aria-label="Timed activity" className="divide-y divide-dashboard-border border-y border-dashboard-border">
                {timed.map((activity) => {
              const who = activity.customerName;
              const what = activity.itemNames.join(", ") || "Scheduled activity";
              const outside =
                activity.source === "reservation" && businessHours && !activity.timeUnspecified
                  ? isActivityOutsideBusinessHours(activity, businessHours)
                  : false;
              return (
                <li key={activity.id}>
                  <button
                    type="button"
                    onClick={() => onOpenActivity(activity)}
                    aria-label={`Open ${activity.type.toLowerCase()} at ${formatCalendarTime(activity.startAt, timeZone)}: ${who ?? what}`}
                    className="grid w-full grid-cols-[4.25rem_3px_minmax(0,1fr)] items-stretch gap-3 py-3.5 text-left transition-colors active:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent"
                  >
                    <span className="pt-0.5 text-sm tabular-nums">
                      <span className="block font-semibold text-dashboard-navy">{formatCalendarTime(activity.startAt, timeZone)}</span>
                      <span className="block text-xs text-dashboard-muted">{formatCalendarTime(activity.endAt, timeZone)}</span>
                    </span>
                    <span aria-hidden="true" className={cn("rounded-full bg-transparent", activityTone[activity.type])}>
                      <span className="block h-full w-full rounded-full bg-current" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-semibold text-dashboard-navy">{activity.type}</span>
                        <span className="capitalize text-dashboard-muted">{activity.status.replaceAll("_", " ")}</span>
                        {outside ? <span className="text-dashboard-danger">Outside hours</span> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-dashboard-navy">{what}</span>
                      {who ? <span className="block truncate text-sm text-dashboard-muted">{who}</span> : null}
                    </span>
                  </button>
                </li>
              );
                })}
              </ol>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
