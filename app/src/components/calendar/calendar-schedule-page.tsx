"use client";

import { useAuth } from "@clerk/nextjs";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  RotateCcw,
  Ruler,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

import {
  addCalendarDays,
  addCalendarMonths,
  calendarBoundaryInstant,
  calendarTodayDateKey,
  formatCalendarDate,
  formatCalendarTime,
  getCalendarMonthGridDateKeys,
  getCalendarWeekDateKeys,
  mapOperationalCalendarEvents,
  startOfCalendarWeek,
  type CalendarActivity,
  type CalendarActivityType,
  type CalendarView,
} from "./calendar-schedule-data";

const activityTone: Record<CalendarActivityType, string> = {
  Pickup: "dashboard-event-pickup",
  Return: "dashboard-event-return",
  Fitting: "dashboard-event-fitting",
};

const activityIcon: Record<CalendarActivityType, typeof RotateCcw> = {
  Pickup: RotateCcw,
  Return: RotateCcw,
  Fitting: Ruler,
};

type ContextState = "loading" | "ready" | "signed_out" | "forbidden" | "error";
type CalendarState = "idle" | "loading" | "ready" | "forbidden" | "error";

export function CalendarSchedulePage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const fallbackTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [contextState, setContextState] = useState<ContextState>("loading");
  const [contextError, setContextError] = useState<string | null>(null);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState(fallbackTimeZone);
  const [view, setView] = useState<CalendarView>("week");
  const [weekStart, setWeekStart] = useState(() =>
    startOfCalendarWeek(calendarTodayDateKey(fallbackTimeZone))
  );
  const [monthStart, setMonthStart] = useState(() =>
    `${calendarTodayDateKey(fallbackTimeZone).slice(0, 7)}-01`
  );
  const [activityFilter, setActivityFilter] = useState<"All Activity" | CalendarActivityType>(
    "All Activity"
  );
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [calendarState, setCalendarState] = useState<CalendarState>("idle");
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [activities, setActivities] = useState<CalendarActivity[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [contextReloadVersion, setContextReloadVersion] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setContextState("signed_out");
      return;
    }

    let cancelled = false;
    setContextState("loading");
    setContextError(null);
    void createDrezivoApiClient(getToken)
      .getActorContext()
      .then(({ data }) => {
        if (cancelled) return;
        const branch = data.branches.find((item) => item.id === data.active_branch_id);
        const grant = data.branch_grants.find(
          (item) => item.branch_id === data.active_branch_id
        );
        if (!branch || !grant) {
          setContextState("error");
          setContextError("The active branch could not be resolved. Refresh your workspace and try again.");
          return;
        }
        if (!grant.permission_codes.includes("reservations.manage")) {
          setContextState("forbidden");
          return;
        }

        const resolvedTimeZone = branch.timezone || data.tenant.timezone;
        const today = calendarTodayDateKey(resolvedTimeZone);
        setActiveBranchId(branch.id);
        setTimeZone(resolvedTimeZone);
        setWeekStart(startOfCalendarWeek(today));
        setMonthStart(`${today.slice(0, 7)}-01`);
        setContextState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DrezivoApiError && error.code === "FORBIDDEN") {
          setContextState("forbidden");
          return;
        }
        setContextState("error");
        setContextError(
          error instanceof DrezivoApiError
            ? error.message
            : "The calendar workspace could not be loaded. Please try again."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [contextReloadVersion, getToken, isLoaded, isSignedIn]);

  const visibleDateKeys = useMemo(
    () =>
      view === "week"
        ? getCalendarWeekDateKeys(weekStart)
        : getCalendarMonthGridDateKeys(monthStart),
    [monthStart, view, weekStart]
  );
  const requestRange = useMemo(() => {
    const firstDateKey = visibleDateKeys[0];
    const lastDateKey = visibleDateKeys[visibleDateKeys.length - 1];
    if (!firstDateKey || !lastDateKey) return null;
    try {
      return {
        start: calendarBoundaryInstant(firstDateKey, timeZone),
        end: calendarBoundaryInstant(addCalendarDays(lastDateKey, 1), timeZone),
      };
    } catch {
      return null;
    }
  }, [timeZone, visibleDateKeys]);
  const todayKey = useMemo(() => calendarTodayDateKey(timeZone), [timeZone]);

  useEffect(() => {
    if (contextState !== "ready" || !activeBranchId || !requestRange) return;

    let cancelled = false;
    setCalendarState("loading");
    setCalendarError(null);
    setActivities([]);
    setTruncated(false);

    void createDrezivoApiClient(getToken)
      .getOperationalCalendar({ start: requestRange.start, end: requestRange.end })
      .then(({ data }) => {
        if (cancelled) return;
        setActivities(mapOperationalCalendarEvents(data.events, timeZone));
        setTruncated(data.truncated);
        setCalendarState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DrezivoApiError && error.code === "FORBIDDEN") {
          setCalendarState("forbidden");
          return;
        }
        setCalendarState("error");
        setCalendarError(
          error instanceof DrezivoApiError
            ? error.message
            : "The schedule could not be loaded. Please try again."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [activeBranchId, contextState, getToken, reloadVersion, requestRange, timeZone]);

  const visibleActivities = useMemo(
    () =>
      activityFilter === "All Activity"
        ? activities
        : activities.filter((activity) => activity.type === activityFilter),
    [activities, activityFilter]
  );
  const weekDateKeys = useMemo(() => getCalendarWeekDateKeys(weekStart), [weekStart]);
  const firstWeekDay = weekDateKeys[0] ?? weekStart;
  const lastWeekDay = weekDateKeys[weekDateKeys.length - 1] ?? weekStart;
  const periodLabel =
    view === "week"
      ? `${formatCalendarDate(firstWeekDay, { month: "short", day: "numeric" })} – ${formatCalendarDate(lastWeekDay, { month: "short", day: "numeric", year: "numeric" })}`
      : formatCalendarDate(monthStart, { month: "long", year: "numeric" });
  const currentPeriodContainsToday =
    view === "week"
      ? todayKey >= firstWeekDay && todayKey <= lastWeekDay
      : todayKey.slice(0, 7) === monthStart.slice(0, 7);

  const navigate = (direction: -1 | 1) => {
    if (view === "month") {
      setMonthStart((current) => addCalendarMonths(current, direction));
      return;
    }
    setWeekStart((current) => addCalendarDays(current, direction * 7));
  };

  const goToday = () => {
    const today = calendarTodayDateKey(timeZone);
    setWeekStart(startOfCalendarWeek(today));
    setMonthStart(`${today.slice(0, 7)}-01`);
  };

  const openDayAgenda = (dateKey: string) => setSelectedDateKey(dateKey);

  return (
    <div className="min-h-full bg-dashboard-canvas px-3 py-5 sm:px-4 lg:px-5">
      <div className="flex w-full max-w-none flex-col gap-4">
        <CalendarHeading />
        <CalendarControls
          activityFilter={activityFilter}
          dateLabel={periodLabel}
          onActivityFilterChange={setActivityFilter}
          onNavigate={navigate}
          onToday={goToday}
          onViewChange={setView}
          showTodayAction={!currentPeriodContainsToday}
          view={view}
          disabled={contextState !== "ready"}
        />

        {truncated && calendarState === "ready" ? <TruncationWarning /> : null}
        {contextState === "loading" || calendarState === "loading" ? (
          <CalendarMessage title="Loading schedule" description="Loading calendar activity for the active branch." />
        ) : null}
        {contextState === "signed_out" ? (
          <CalendarMessage title="Sign in required" description="Sign in to view your branch schedule." />
        ) : null}
        {contextState === "forbidden" || calendarState === "forbidden" ? (
          <CalendarMessage title="Calendar unavailable" description="Your current role does not have permission to view this schedule." />
        ) : null}
        {contextState === "error" ? (
          <CalendarMessage
            title="Workspace unavailable"
            description={contextError ?? "The active workspace could not be loaded."}
            onRetry={() => setContextReloadVersion((value) => value + 1)}
          />
        ) : null}
        {calendarState === "error" ? (
          <CalendarMessage
            title="Schedule unavailable"
            description={calendarError ?? "The schedule could not be loaded."}
            onRetry={() => setReloadVersion((value) => value + 1)}
          />
        ) : null}
        {contextState === "ready" && calendarState === "ready" ? (
          view === "week" ? (
            <ScheduleGrid
              activities={visibleActivities}
              dateKeys={weekDateKeys}
              timeZone={timeZone}
              todayKey={todayKey}
              onOpenDay={openDayAgenda}
            />
          ) : (
            <MonthGrid
              activities={visibleActivities}
              cursor={monthStart}
              dateKeys={getCalendarMonthGridDateKeys(monthStart)}
              timeZone={timeZone}
              todayKey={todayKey}
              onOpenDay={openDayAgenda}
            />
          )
        ) : null}
        {contextState === "ready" && !requestRange ? (
          <CalendarMessage
            title="Calendar range unavailable"
            description="The branch-local date range could not be resolved. Check the branch timezone and try refreshing the workspace."
            onRetry={() => setContextReloadVersion((value) => value + 1)}
          />
        ) : null}
      </div>

      <DayAgendaSheet
        activities={visibleActivities.filter((activity) => activity.dateKey === selectedDateKey)}
        dateKey={selectedDateKey}
        timeZone={timeZone}
        onOpenChange={(open) => {
          if (!open) setSelectedDateKey(null);
        }}
      />
    </div>
  );
}

function CalendarHeading() {
  return (
    <section aria-labelledby="calendar-heading" className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-dashboard-muted">Calendar</p>
          <h1 id="calendar-heading" className="mt-1 font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">
            Rental Calendar
          </h1>
          <p className="mt-1 text-sm text-dashboard-muted">
            Reservation pickup and return activity, plus scheduled fittings.
          </p>
        </div>
        <nav
          aria-label="Calendar views"
          className="grid w-full overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-surface sm:w-auto sm:grid-cols-2"
        >
          <Link
            href="/calendar"
            aria-current="page"
            className="flex min-h-11 min-w-44 items-center justify-center gap-2 bg-dashboard-active px-5 text-sm font-semibold text-dashboard-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Schedule
          </Link>
          <Link
            href="/calendar/availability"
            className="flex min-h-11 min-w-52 items-center justify-center gap-2 border-t border-dashboard-border px-5 text-sm font-medium text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30 sm:border-l sm:border-t-0"
          >
            Clothing Availability
          </Link>
        </nav>
      </div>
    </section>
  );
}

function CalendarControls({
  activityFilter,
  dateLabel,
  onActivityFilterChange,
  onNavigate,
  onToday,
  onViewChange,
  showTodayAction,
  view,
  disabled,
}: {
  activityFilter: "All Activity" | CalendarActivityType;
  dateLabel: string;
  onActivityFilterChange: (value: "All Activity" | CalendarActivityType) => void;
  onNavigate: (direction: -1 | 1) => void;
  onToday: () => void;
  onViewChange: (nextView: CalendarView) => void;
  showTodayAction: boolean;
  view: CalendarView;
  disabled: boolean;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Previous period" disabled={disabled} onClick={() => onNavigate(-1)} className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next period" disabled={disabled} onClick={() => onNavigate(1)} className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="inline-flex min-h-10 items-center gap-2 rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-sm font-medium text-dashboard-navy">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {dateLabel}
          </span>
          {showTodayAction ? (
            <Button variant="ghost" disabled={disabled} onClick={onToday} className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
              Today
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" disabled={disabled} className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
                {activityFilter}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(["All Activity", "Pickup", "Return", "Fitting"] as const).map((option) => (
                <DropdownMenuItem key={option} onClick={() => onActivityFilterChange(option)}>
                  {option}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="inline-flex w-full rounded-lg border border-dashboard-border bg-dashboard-surface p-1 lg:w-auto">
          {(["week", "month"] as const).map((option) => (
            <Button
              key={option}
              variant="ghost"
              disabled={disabled}
              aria-pressed={view === option}
              onClick={() => onViewChange(option)}
              className={cn(
                "min-h-9 flex-1 capitalize text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy lg:flex-none",
                view === option && "bg-dashboard-active text-dashboard-accent"
              )}
            >
              {option}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TruncationWarning() {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-dashboard-navy">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
      <p>
        This range contains more activity than the calendar can display. Only the first 2,000 events are shown; this view may be incomplete.
      </p>
    </div>
  );
}

function CalendarMessage({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
        <CircleAlert className="h-5 w-5 text-dashboard-accent" aria-hidden="true" />
        <h2 className="font-semibold text-dashboard-navy">{title}</h2>
        <p className="max-w-lg text-sm text-dashboard-muted">{description}</p>
        {onRetry ? <Button variant="secondary" onClick={onRetry} className="mt-2">Try again</Button> : null}
      </CardContent>
    </Card>
  );
}

function ScheduleGrid({
  activities,
  dateKeys,
  timeZone,
  todayKey,
  onOpenDay,
}: {
  activities: CalendarActivity[];
  dateKeys: string[];
  timeZone: string;
  todayKey: string;
  onOpenDay: (dateKey: string) => void;
}) {
  const hours = Array.from({ length: 14 }, (_, index) => index + 7);
  return (
    <Card className="overflow-x-auto gap-0 py-0">
      <div className="grid min-w-[980px] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
        <div className="min-h-[4.25rem] border-b border-r border-dashboard-border" />
        {dateKeys.map((dateKey) => {
          const dayActivities = activities.filter((activity) => activity.dateKey === dateKey);
          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onOpenDay(dateKey)}
              className={cn(
                "flex min-h-[4.25rem] min-w-0 flex-col items-center justify-center border-b border-r border-dashboard-border px-1 text-center transition-colors hover:bg-dashboard-active",
                dateKey === todayKey && "bg-dashboard-active/60"
              )}
            >
              <span className="text-xs font-semibold text-dashboard-navy">
                {formatCalendarDate(dateKey, { weekday: "short" })}
              </span>
              <span className={cn("text-xs text-dashboard-muted", dateKey === todayKey && "font-semibold text-dashboard-accent")}>
                {formatCalendarDate(dateKey, { month: "short", day: "numeric" })}
              </span>
              <Badge variant="outline" className="mt-1 h-4 px-1 text-[10px]">
                {dayActivities.length}
              </Badge>
            </button>
          );
        })}
        <div className="relative border-r border-dashboard-border" style={{ height: 14 * 56 }}>
          {hours.map((hour, index) => (
            <span
              key={hour}
              className="absolute right-1 -translate-y-1/2 bg-dashboard-surface px-0.5 text-[9px] text-dashboard-muted"
              style={{ top: index * 56 }}
            >
              {formatHour(hour)}
            </span>
          ))}
        </div>
        {dateKeys.map((dateKey) => {
          const dayActivities = activities.filter((activity) => activity.dateKey === dateKey);
          return (
            <ScheduleDayColumn
              key={dateKey}
              activities={dayActivities}
              timeZone={timeZone}
              onOpenDay={() => onOpenDay(dateKey)}
            />
          );
        })}
        <div className="border-r border-t border-dashboard-border p-2 text-[10px] font-semibold text-dashboard-muted">
          Outside
        </div>
        {dateKeys.map((dateKey) => (
          <OutsideHoursList
            key={`${dateKey}-outside`}
            activities={activities.filter((activity) => activity.dateKey === dateKey)}
            timeZone={timeZone}
            onOpenDay={() => onOpenDay(dateKey)}
          />
        ))}
      </div>
    </Card>
  );
}

function ScheduleDayColumn({
  activities,
  timeZone,
  onOpenDay,
}: {
  activities: CalendarActivity[];
  timeZone: string;
  onOpenDay: () => void;
}) {
  const startMinute = 7 * 60;
  const endMinute = 21 * 60;
  const onGrid = activities.filter(
    (activity) =>
      activity.startMinute >= startMinute &&
      activity.startMinute < endMinute &&
      activity.startMinute + activity.durationMinutes <= endMinute
  );
  const positioned = layoutOverlappingActivities(onGrid);

  return (
    <div className="min-w-0">
      <div
        className="relative border-b border-r border-dashboard-border"
        style={{ height: 14 * 56 }}
        aria-label="Schedule day activity from 7 AM to 9 PM"
      >
        {Array.from({ length: 14 }, (_, index) => (
          <div
            key={index}
            className="pointer-events-none absolute inset-x-0 border-t border-dashboard-border/70"
            style={{ top: index * 56 }}
          >
          </div>
        ))}
        {positioned.map(({ activity, lane, lanes }) => {
          const top = ((activity.startMinute - startMinute) / 60) * 56 + 3;
          const height = Math.max(28, (activity.durationMinutes / 60) * 56 - 6);
          const width = 100 / lanes;
          const Icon = activityIcon[activity.type];
          return (
            <button
              key={activity.id}
              type="button"
              onClick={onOpenDay}
              aria-label={`${activity.type}: ${activity.itemNames.join(", ") || "Rental activity"}, ${formatCalendarTime(activity.startAt, timeZone)} to ${formatCalendarTime(activity.endAt, timeZone)}`}
              className={cn(
                "absolute z-10 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[10px] leading-tight shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent",
                activityTone[activity.type]
              )}
              style={{
                top,
                height,
                left: `${lane * width}%`,
                width: `${width}%`,
              }}
            >
              <span className="flex items-center gap-1 font-semibold">
                <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                {activity.type}
              </span>
              <span className="mt-0.5 block truncate">
                {activity.customerName ?? (activity.itemNames.join(", ") || "Scheduled activity")}
              </span>
              <span className="block truncate opacity-80">
                {formatCalendarTime(activity.startAt, timeZone)}–{formatCalendarTime(activity.endAt, timeZone)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OutsideHoursList({
  activities,
  timeZone,
  onOpenDay,
}: {
  activities: CalendarActivity[];
  timeZone: string;
  onOpenDay: () => void;
}) {
  const visibleStart = 7 * 60;
  const visibleEnd = 21 * 60;
  const outsideHours = activities.filter(
    (activity) =>
      activity.startMinute < visibleStart ||
      activity.startMinute >= visibleEnd ||
      activity.startMinute + activity.durationMinutes > visibleEnd
  );
  return (
    <div className="min-h-12 space-y-1 border-r border-t border-dashboard-border p-1.5">
      {outsideHours.length > 0 ? (
        <>
          <p className="text-[10px] font-semibold text-dashboard-muted">
            Outside visible hours ({outsideHours.length})
          </p>
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {outsideHours.map((activity) => (
              <button
                key={activity.id}
                type="button"
                onClick={onOpenDay}
                className={cn("block w-full truncate rounded border px-1.5 py-1 text-left text-[10px]", activityTone[activity.type])}
                aria-label={`${activity.type} outside visible hours at ${formatCalendarTime(activity.startAt, timeZone)}`}
              >
                {formatCalendarTime(activity.startAt, timeZone)} · {activity.type} · {activity.customerName ?? (activity.itemNames.join(", ") || "Scheduled activity")}
              </button>
            ))}
          </div>
        </>
      ) : (
        <span className="text-[10px] text-dashboard-muted">—</span>
      )}
    </div>
  );
}

function layoutOverlappingActivities(activities: CalendarActivity[]) {
  const sorted = [...activities].sort(
    (left, right) => left.startMinute - right.startMinute || left.id.localeCompare(right.id)
  );
  const result: Array<{ activity: CalendarActivity; lane: number; lanes: number }> = [];
  let cluster: CalendarActivity[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const finishCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((activity) => {
      let lane = laneEnds.findIndex((end) => end <= activity.startMinute);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = activity.startMinute + Math.max(1, activity.durationMinutes);
      return { activity, lane };
    });
    for (const entry of assigned) result.push({ ...entry, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const activity of sorted) {
    if (cluster.length > 0 && activity.startMinute >= clusterEnd) finishCluster();
    cluster.push(activity);
    clusterEnd = Math.max(clusterEnd, activity.startMinute + Math.max(1, activity.durationMinutes));
  }
  finishCluster();
  return result;
}

function MonthGrid({
  activities,
  cursor,
  dateKeys,
  timeZone,
  todayKey,
  onOpenDay,
}: {
  activities: CalendarActivity[];
  cursor: string;
  dateKeys: string[];
  timeZone: string;
  todayKey: string;
  onOpenDay: (dateKey: string) => void;
}) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid grid-cols-7 border-b border-dashboard-border bg-dashboard-surface">
        {weekdays.map((day) => (
          <div key={day} className="p-2 text-center text-xs font-semibold text-dashboard-muted">{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dateKeys.map((dateKey) => {
          const inMonth = dateKey.slice(0, 7) === cursor.slice(0, 7);
          const dayActivities = activities.filter((activity) => activity.dateKey === dateKey);
          const preview = dayActivities.slice(0, 4);
          const moreCount = Math.max(0, dayActivities.length - preview.length);
          return (
            <div
              key={dateKey}
              className={cn(
                "min-h-32 border-b border-r border-dashboard-border p-1.5 sm:min-h-36 sm:p-2",
                !inMonth && "bg-dashboard-canvas/50",
                dateKey === todayKey && "bg-dashboard-active/40"
              )}
            >
              <button
                type="button"
                onClick={() => onOpenDay(dateKey)}
                className={cn(
                  "mb-1 flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-medium",
                  dateKey === todayKey ? "bg-dashboard-accent text-white" : "text-dashboard-navy",
                  !inMonth && "text-dashboard-muted"
                )}
                aria-label={`Open ${formatCalendarDate(dateKey, { month: "long", day: "numeric", year: "numeric" })} agenda`}
              >
                {formatCalendarDate(dateKey, { day: "numeric" })}
              </button>
              <div className="space-y-1">
                {preview.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    onClick={() => onOpenDay(dateKey)}
                    className={cn(
                      "block w-full truncate rounded border px-1 py-1 text-left text-[10px] leading-tight sm:text-xs",
                      activityTone[activity.type]
                    )}
                    title={`${activity.type}: ${activity.itemNames.join(", ")}`}
                  >
                    <span className="font-semibold">{formatCalendarTime(activity.startAt, timeZone)}</span>{" "}
                    {activity.type} · {activity.customerName ?? (activity.itemNames.join(", ") || "Activity")}
                  </button>
                ))}
                {moreCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenDay(dateKey)}
                    className="px-1 text-[10px] font-medium text-dashboard-accent hover:underline"
                  >
                    +{moreCount} more
                  </button>
                ) : dayActivities.length === 0 ? (
                  <span className="px-1 text-[10px] text-dashboard-muted">No activity</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function DayAgendaSheet({
  activities,
  dateKey,
  timeZone,
  onOpenChange,
}: {
  activities: CalendarActivity[];
  dateKey: string | null;
  timeZone: string;
  onOpenChange: (open: boolean) => void;
}) {
  const open = dateKey !== null;
  const sortedActivities = [...activities].sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-l border-dashboard-border bg-dashboard-canvas p-0 text-dashboard-navy sm:max-w-xl">
        <div className="border-b border-dashboard-border p-5">
          <SheetTitle className="text-dashboard-navy">
            {dateKey ? formatCalendarDate(dateKey, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Daily agenda"}
          </SheetTitle>
          <SheetDescription className="mt-1 text-dashboard-muted">
            {activities.length} calendar {activities.length === 1 ? "event" : "events"} from the active branch schedule.
          </SheetDescription>
        </div>
        <div className="space-y-3 p-5">
          {sortedActivities.length === 0 ? (
            <div className="rounded-lg border border-dashed border-dashboard-border p-8 text-center text-sm text-dashboard-muted">
              No activity on this day.
            </div>
          ) : (
            sortedActivities.map((activity) => {
              const Icon = activityIcon[activity.type];
              return (
                <div key={activity.id} className="flex gap-3 rounded-lg border border-dashboard-border bg-dashboard-surface p-3">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", activityTone[activity.type])}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{activity.type}</p>
                      <Badge variant="outline" className="capitalize">{activity.status.replaceAll("_", " ")}</Badge>
                    </div>
                    <p className="truncate text-sm text-dashboard-muted">
                      {activity.itemNames.join(", ") || "Scheduled activity"}
                    </p>
                    {activity.customerName ? (
                      <p className="text-sm text-dashboard-muted">{activity.customerName}</p>
                    ) : null}
                    <p className="mt-1 flex items-center gap-1 text-xs text-dashboard-muted">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatCalendarTime(activity.startAt, timeZone)} – {formatCalendarTime(activity.endAt, timeZone)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function formatHour(hour: number) {
  const displayHour = hour % 12 || 12;
  return `${displayHour}${hour < 12 ? "am" : "pm"}`;
}
