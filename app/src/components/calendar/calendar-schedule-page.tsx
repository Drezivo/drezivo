"use client";

import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  Mail,
  Pencil,
  Phone,
  Ruler,
  RotateCcw,
  Shirt,
  Truck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

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
import { cn } from "@/lib/utils";

import {
  CALENDAR_ACTIVITIES,
  CALENDAR_DAY_AGENDA,
  CALENDAR_END_HOUR,
  CALENDAR_HOUR_HEIGHT,
  CALENDAR_HOURS,
  CALENDAR_MINUTE_HEIGHT,
  CALENDAR_MOCK_MONTH,
  CALENDAR_MOCK_TODAY,
  CALENDAR_MOCK_YEAR,
  CALENDAR_START_HOUR,
  CALENDAR_TOTAL_HEIGHT,
  CALENDAR_WEEK_START,
  type CalendarActivity,
  type CalendarActivityType,
  type CalendarDay,
} from "./calendar-schedule-data";

const activityTone: Record<CalendarActivityType, string> = {
  Pickup: "dashboard-event-pickup",
  Return: "dashboard-event-return",
  Fitting: "dashboard-event-fitting",
};

const metricIcons = [CalendarDays, RotateCcw, Ruler, CircleAlert] as const;

const metricTone = {
  blue: "dashboard-tone-blue",
  mint: "dashboard-tone-mint",
  purple: "dashboard-tone-purple",
  danger: "bg-dashboard-danger/10 text-dashboard-danger",
} as const;

type CalendarView = "week" | "month";

export function CalendarSchedulePage() {
  const [activityFilter, setActivityFilter] = useState<"All Activity" | CalendarActivityType>(
    "All Activity"
  );
  const [view, setView] = useState<CalendarView>("week");
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<CalendarActivity | null>(null);
  const [agendaFilter, setAgendaFilter] = useState<"All" | CalendarActivityType>("All");
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(Date.UTC(CALENDAR_MOCK_YEAR, CALENDAR_MOCK_MONTH, 1))
  );
  const [weekCursor, setWeekCursor] = useState(() => parseDateKey(CALENDAR_WEEK_START));

  const weekDays = useMemo(() => buildWeekDays(weekCursor), [weekCursor]);
  const periodActivities = useMemo(() => {
    if (view === "week") {
      const weekEnd = addUtcDays(weekCursor, 6);
      return CALENDAR_ACTIVITIES.filter((activity) => {
        const activityDate = parseDateKey(activity.dateKey);
        return activityDate >= weekCursor && activityDate <= weekEnd;
      });
    }
    return CALENDAR_ACTIVITIES.filter((activity) => {
      const activityDate = parseDateKey(activity.dateKey);
      return (
        activityDate.getUTCFullYear() === monthCursor.getUTCFullYear() &&
        activityDate.getUTCMonth() === monthCursor.getUTCMonth()
      );
    });
  }, [monthCursor, view, weekCursor]);
  const visibleActivities = useMemo(
    () =>
      activityFilter === "All Activity"
        ? periodActivities
        : periodActivities.filter((activity) => activity.type === activityFilter),
    [activityFilter, periodActivities]
  );

  const openDayAgenda = (dateKey: string) => {
    setSelectedActivity(null);
    setSelectedDateKey(dateKey);
    setAgendaFilter("All");
  };

  const openActivityDetails = (activity: CalendarActivity) => {
    setSelectedDateKey(null);
    setSelectedActivity(activity);
  };

  const navigate = (direction: -1 | 1) => {
    if (view === "month") {
      setMonthCursor(
        (current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + direction, 1))
      );
      return;
    }
    setWeekCursor((current) => addUtcDays(current, direction * 7));
  };

  const goToday = () => {
    const today = parseDateKey(CALENDAR_MOCK_TODAY);
    setMonthCursor(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
    const day = today.getUTCDay();
    const mondayOffset = (day + 6) % 7;
    setWeekCursor(addUtcDays(today, -mondayOffset));
  };

  const today = parseDateKey(CALENDAR_MOCK_TODAY);
  const currentPeriodContainsToday =
    view === "month"
      ? monthCursor.getUTCFullYear() === today.getUTCFullYear() &&
        monthCursor.getUTCMonth() === today.getUTCMonth()
      : today >= weekCursor && today <= addUtcDays(weekCursor, 6);

  return (
    <div className="min-h-full bg-dashboard-canvas px-3 py-5 sm:px-4 lg:px-5">
      <div className="flex w-full max-w-none flex-col gap-4">
        <CalendarHeading activities={periodActivities} />
        <CalendarControls
          activityFilter={activityFilter}
          dateLabel={calendarDateLabel(view, monthCursor, weekCursor)}
          onActivityFilterChange={setActivityFilter}
          onNavigate={navigate}
          onToday={goToday}
          onViewChange={setView}
          showTodayAction={!currentPeriodContainsToday}
          view={view}
        />
        {view === "week" ? (
          <ScheduleGrid
            activities={visibleActivities}
            days={weekDays}
            onOpenActivity={openActivityDetails}
            onOpenDay={openDayAgenda}
          />
        ) : null}
        {view === "month" ? (
          <MonthGrid
            activities={visibleActivities}
            cursor={monthCursor}
            onOpenActivity={openActivityDetails}
            onOpenDay={openDayAgenda}
          />
        ) : null}
      </div>

      <DayAgendaSheet
        agendaFilter={agendaFilter}
        dateKey={selectedDateKey}
        onAgendaFilterChange={setAgendaFilter}
        onViewDetails={(activity) => {
          setSelectedDateKey(null);
          setSelectedActivity(activity);
        }}
        onOpenChange={(open) => {
          if (!open) setSelectedDateKey(null);
        }}
        onSelectDate={(dateKey) => {
          setSelectedDateKey(dateKey);
          setAgendaFilter("All");
        }}
      />

      <ReservationDetailsSheet
        activity={selectedActivity}
        onOpenChange={(open) => {
          if (!open) setSelectedActivity(null);
        }}
      />
    </div>
  );
}

function CalendarHeading({ activities }: { activities: readonly CalendarActivity[] }) {
  const metrics = [
    { label: "Pickups", value: activities.filter((activity) => activity.type === "Pickup").length, tone: "blue" },
    { label: "Returns", value: activities.filter((activity) => activity.type === "Return").length, tone: "mint" },
    { label: "Fittings", value: activities.filter((activity) => activity.type === "Fitting").length, tone: "purple" },
    { label: "Issues", value: 3, tone: "danger" },
  ] as const;

  return (
    <section aria-labelledby="calendar-heading" className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-dashboard-muted">Calendar</p>
          <h1 id="calendar-heading" className="mt-1 font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">
            Rental Calendar
          </h1>
          <p className="mt-1 text-sm text-dashboard-muted">
            Manage daily rental activity and clothing availability in one place.
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
            <Shirt className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
            Clothing Availability
          </Link>
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? CalendarDays;
          return (
            <Card key={metric.label} className="gap-0 py-0">
              <CardContent className="flex min-h-20 items-center gap-3 p-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    metricTone[metric.tone]
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-xl font-semibold leading-none text-dashboard-navy">
                    {metric.value}
                  </span>
                  <span className="mt-1 block text-xs text-dashboard-muted">{metric.label}</span>
                </span>
              </CardContent>
            </Card>
          );
        })}
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
}: {
  activityFilter: "All Activity" | CalendarActivityType;
  dateLabel: string;
  onActivityFilterChange: (value: "All Activity" | CalendarActivityType) => void;
  onNavigate: (direction: -1 | 1) => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
  showTodayAction: boolean;
  view: CalendarView;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Previous period" onClick={() => onNavigate(-1)} className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next period" onClick={() => onNavigate(1)} className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {dateLabel}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-surface">
            {(["week", "month"] as const).map((calendarView) => {
              const active = view === calendarView;
              return (
                <button
                  key={calendarView}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onViewChange(calendarView)}
                  className={cn(
                    "min-h-9 px-5 text-xs transition-colors first:border-l-0",
                    calendarView !== "week" && "border-l border-dashboard-border",
                    active
                      ? "bg-dashboard-active font-semibold text-dashboard-accent"
                      : "font-medium text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy"
                  )}
                >
                  {calendarView[0]!.toUpperCase() + calendarView.slice(1)}
                </button>
              );
            })}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="min-w-36 justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
                {activityFilter}
                <ChevronRight className="h-3.5 w-3.5 rotate-90 text-dashboard-muted" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(["All Activity", "Pickup", "Return", "Fitting"] as const).map((item) => (
                <DropdownMenuItem key={item} onSelect={() => onActivityFilterChange(item)}>
                  {item}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="min-w-32 justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
                All Clothing
                <ChevronRight className="h-3.5 w-3.5 rotate-90 text-dashboard-muted" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>All Clothing</DropdownMenuItem>
              <DropdownMenuItem>Gowns</DropdownMenuItem>
              <DropdownMenuItem>Barong</DropdownMenuItem>
              <DropdownMenuItem>Filipiniana</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="min-w-28 justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
                All Status
                <ChevronRight className="h-3.5 w-3.5 rotate-90 text-dashboard-muted" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>All Status</DropdownMenuItem>
              <DropdownMenuItem>Confirmed</DropdownMenuItem>
              <DropdownMenuItem>Pending</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {showTodayAction ? (
            <Button
              variant="ghost"
              onClick={onToday}
              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              Today
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduleGrid({
  activities,
  days,
  onOpenActivity,
  onOpenDay,
}: {
  activities: readonly CalendarActivity[];
  days: readonly CalendarDay[];
  onOpenActivity: (activity: CalendarActivity) => void;
  onOpenDay: (dateKey: string) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="h-[clamp(40rem,78vh,60rem)] overflow-auto">
          <div className="w-full min-w-[82rem]">
            <div className="sticky top-0 z-30 grid grid-cols-[5rem_repeat(7,minmax(0,1fr))] border-b border-dashboard-border bg-dashboard-surface shadow-sm">
              <div className="border-r border-dashboard-border bg-dashboard-surface" />
              {days.map((day) => {
                const isToday = day.dateKey === CALENDAR_MOCK_TODAY;
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => onOpenDay(day.dateKey)}
                    aria-label={`Open ${day.label} ${day.date} agenda`}
                    aria-current={isToday ? "date" : undefined}
                    className={cn(
                      "border-r border-dashboard-border bg-dashboard-surface px-4 py-3 text-left transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30 last:border-r-0",
                      isToday && "bg-dashboard-active"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <p className={cn("text-sm font-semibold text-dashboard-navy", isToday && "text-dashboard-accent")}>{day.label}</p>
                      {isToday ? (
                        <span className="rounded-full bg-dashboard-gold-soft px-2 py-0.5 text-[0.62rem] font-semibold text-dashboard-gold-text">
                          Today
                        </span>
                      ) : null}
                    </div>
                    <p className={cn("mt-0.5 text-xs text-dashboard-muted", isToday && "text-dashboard-accent")}>{day.date}</p>
                    <span className="mt-2 inline-flex rounded-full bg-dashboard-neutral-soft px-2 py-1 text-[0.7rem] font-medium text-dashboard-neutral-text">
                      {day.activityCount} activities
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-[5rem_repeat(7,minmax(0,1fr))]">
              <TimeColumn />
              {days.map((day) => (
                <DayColumn
                  key={day.dateKey}
                  highlighted={day.dateKey === CALENDAR_MOCK_TODAY}
                  activities={activities.filter((activity) => activity.dateKey === day.dateKey)}
                  onOpenActivity={onOpenActivity}
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const MONTH_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function MonthGrid({
  activities,
  cursor,
  onOpenActivity,
  onOpenDay,
}: {
  activities: readonly CalendarActivity[];
  cursor: Date;
  onOpenActivity: (activity: CalendarActivity) => void;
  onOpenDay: (dateKey: string) => void;
}) {
  const cells = monthCells(cursor);
  const cursorMonth = cursor.getUTCMonth();

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="h-[clamp(40rem,78vh,60rem)] overflow-auto">
          <div className="min-w-[72rem]">
            <div className="sticky top-0 z-30 grid grid-cols-7 border-b border-dashboard-border bg-dashboard-surface shadow-sm">
              {MONTH_WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  className="border-r border-dashboard-border px-3 py-3 text-xs font-semibold text-dashboard-navy last:border-r-0"
                >
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((date) => {
                const dateKey = formatDateKey(date);
                const inMonth = date.getUTCMonth() === cursorMonth;
                const dayActivities = activities
                  .filter((activity) => activity.dateKey === dateKey)
                  .sort((a, b) => a.startTime.localeCompare(b.startTime));
                const visible = dayActivities.slice(0, 4);
                const hiddenCount = Math.max(0, dayActivities.length - visible.length);
                const isToday = dateKey === CALENDAR_MOCK_TODAY;

                return (
                  <div
                    key={dateKey}
                    className={cn(
                      "min-h-[10.5rem] border-b border-r border-dashboard-border bg-dashboard-surface p-2 last:border-r-0",
                      !inMonth && "bg-dashboard-canvas/60 text-dashboard-muted"
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenDay(dateKey)}
                        className={cn(
                          "flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold text-dashboard-navy transition-colors hover:bg-dashboard-active",
                          isToday && "bg-dashboard-active text-dashboard-accent ring-1 ring-dashboard-accent/50"
                        )}
                        aria-current={isToday ? "date" : undefined}
                        aria-label={`Open ${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} agenda`}
                      >
                        {date.getUTCDate()}
                      </button>
                      {isToday ? (
                        <span className="rounded-full bg-dashboard-gold-soft px-2 py-0.5 text-[0.62rem] font-semibold text-dashboard-gold-text">
                          Today
                        </span>
                      ) : null}
                    </div>

                    <div className="space-y-1">
                      {visible.map((activity) => (
                        <button
                          key={activity.id}
                          type="button"
                          onClick={() => onOpenActivity(activity)}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[0.68rem] transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                            activityTone[activity.type]
                          )}
                          aria-label={`${activity.type}: ${activity.customer}, ${activity.clothing}, ${formatActivityTime(activity)}`}
                        >
                          <span className="shrink-0 font-semibold">{formatClockMinutes(timeToMinutes(activity.startTime))}</span>
                          <span className="truncate">{activity.type} · {activity.customer}</span>
                        </button>
                      ))}
                      {hiddenCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => onOpenDay(dateKey)}
                          className="w-full rounded-md px-2 py-1 text-left text-[0.68rem] font-semibold text-dashboard-accent transition hover:bg-dashboard-active"
                          aria-label={`Open ${hiddenCount} more activities on ${dateKey}`}
                        >
                          +{hiddenCount} more
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TimeColumn() {
  const visibleHours = CALENDAR_HOURS.slice(0, -1);
  const finalHour = CALENDAR_HOURS.at(-1);

  return (
    <div
      className="relative border-r border-dashboard-border bg-dashboard-surface"
      style={{ height: CALENDAR_TOTAL_HEIGHT }}
      aria-label={`Schedule hours ${CALENDAR_HOURS[0]} to ${finalHour}`}
    >
      {visibleHours.map((hour, index) => (
        <div
          key={hour}
          className="relative border-b border-dashboard-border px-3 pt-2 text-right text-[0.7rem] text-dashboard-muted"
          style={{ height: CALENDAR_HOUR_HEIGHT }}
        >
          {hour}
          <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-dashboard-border/45" />
        </div>
      ))}
      {finalHour ? (
        <span className="absolute bottom-1 right-3 text-[0.7rem] text-dashboard-muted">{finalHour}</span>
      ) : null}
    </div>
  );
}

type PositionedActivity = {
  activity: CalendarActivity;
  columnCount: number;
  columnIndex: number;
  height: number;
  top: number;
};

function DayColumn({
  activities,
  highlighted,
  onOpenActivity,
}: {
  activities: readonly CalendarActivity[];
  highlighted: boolean;
  onOpenActivity: (activity: CalendarActivity) => void;
}) {
  const positionedActivities = layoutOverlappingActivities(activities);
  const hourCount = CALENDAR_END_HOUR - CALENDAR_START_HOUR;

  return (
    <div
      className={cn(
        "relative border-r border-dashboard-border last:border-r-0",
        highlighted && "bg-dashboard-active/40"
      )}
      style={{ height: CALENDAR_TOTAL_HEIGHT }}
    >
      {Array.from({ length: hourCount }).map((_, index) => (
        <div
          key={index}
          className="pointer-events-none absolute inset-x-0 border-b border-dashboard-border"
          style={{ top: index * CALENDAR_HOUR_HEIGHT, height: CALENDAR_HOUR_HEIGHT }}
        >
          <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-dashboard-border/45" />
        </div>
      ))}

      {positionedActivities.map((positioned) => (
        <ActivityCard
          key={positioned.activity.id}
          positioned={positioned}
          onClick={() => onOpenActivity(positioned.activity)}
        />
      ))}
    </div>
  );
}

function ActivityCard({
  positioned,
  onClick,
}: {
  positioned: PositionedActivity;
  onClick: () => void;
}) {
  const { activity, columnCount, columnIndex, height, top } = positioned;
  const compact = columnCount >= 3;
  const veryCompact = columnCount >= 4;
  const timeLabel = formatActivityTime(activity);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute z-10 min-w-0 overflow-hidden rounded-md border text-left shadow-sm transition hover:z-20 hover:brightness-[0.98] focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
        compact ? "px-1.5 py-1.5" : "px-2.5 py-2",
        activityTone[activity.type]
      )}
      style={{
        top: top + 2,
        height: Math.max(42, height - 4),
        left: `calc(${(columnIndex / columnCount) * 100}% + 3px)`,
        width: `calc(${100 / columnCount}% - 6px)`,
      }}
      aria-label={`${activity.type}: ${activity.customer}, ${activity.clothing}, ${timeLabel}`}
      data-overlap-count={columnCount}
    >
      <span className={cn("flex min-w-0 items-center gap-1 font-semibold", veryCompact ? "text-[0.62rem]" : "text-xs")}>
        {activity.type === "Pickup" ? <Truck className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
        {activity.type === "Return" ? <RotateCcw className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
        {activity.type === "Fitting" ? <Ruler className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">{veryCompact ? activity.type.slice(0, 3) : activity.type}</span>
      </span>
      <span className={cn("block truncate font-medium", compact ? "mt-0.5 text-[0.66rem]" : "mt-1 text-[0.72rem]")}>
        {veryCompact ? activity.customer.split(" ")[0] : activity.customer}
      </span>
      {!compact ? <span className="block truncate text-[0.68rem] opacity-80">{activity.clothing}</span> : null}
      {!veryCompact ? <span className="block truncate text-[0.66rem] opacity-80">{timeLabel}</span> : null}
    </button>
  );
}

function layoutOverlappingActivities(activities: readonly CalendarActivity[]): PositionedActivity[] {
  const sorted = [...activities]
    .map((activity) => ({
      activity,
      start: timeToMinutes(activity.startTime),
      end: timeToMinutes(activity.startTime) + activity.durationMinutes,
    }))
    .filter(
      ({ start, end }) =>
        start < CALENDAR_END_HOUR * 60 && end > CALENDAR_START_HOUR * 60
    )
    .sort((a, b) => a.start - b.start || a.end - b.end || a.activity.id.localeCompare(b.activity.id));

  const result: PositionedActivity[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const assigned = cluster.map((entry) => {
      let columnIndex = columnEnds.findIndex((end) => end <= entry.start);
      if (columnIndex === -1) {
        columnIndex = columnEnds.length;
        columnEnds.push(entry.end);
      } else {
        columnEnds[columnIndex] = entry.end;
      }
      return { ...entry, columnIndex };
    });
    const columnCount = Math.max(1, columnEnds.length);

    assigned.forEach(({ activity, columnIndex, start, end }) => {
      const visibleStart = Math.max(start, CALENDAR_START_HOUR * 60);
      const visibleEnd = Math.min(end, CALENDAR_END_HOUR * 60);
      result.push({
        activity,
        columnCount,
        columnIndex,
        top: (visibleStart - CALENDAR_START_HOUR * 60) * CALENDAR_MINUTE_HEIGHT,
        height: (visibleEnd - visibleStart) * CALENDAR_MINUTE_HEIGHT,
      });
    });

    cluster = [];
    clusterEnd = -1;
  };

  sorted.forEach((entry) => {
    if (cluster.length > 0 && entry.start >= clusterEnd) flushCluster();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.end);
  });
  flushCluster();

  return result;
}

function timeToMinutes(value: string): number {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return hour * 60 + minute;
}

function formatActivityTime(activity: CalendarActivity): string {
  const start = timeToMinutes(activity.startTime);
  const end = start + activity.durationMinutes;
  return `${formatClockMinutes(start)}–${formatClockMinutes(end)}`;
}

function formatClockMinutes(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
}

function parseDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00Z`);
}

function formatDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addUtcDays(date: Date, amount: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + amount);
  return copy;
}

function monthCells(cursor: Date): Date[] {
  const firstOfMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const mondayOffset = (firstOfMonth.getUTCDay() + 6) % 7;
  const firstCell = addUtcDays(firstOfMonth, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addUtcDays(firstCell, index));
}

function buildWeekDays(weekStart: Date): CalendarDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addUtcDays(weekStart, index);
    const dateKey = formatDateKey(date);
    return {
      key: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toLowerCase(),
      label: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      date: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      dateKey,
      activityCount: CALENDAR_ACTIVITIES.filter((activity) => activity.dateKey === dateKey).length,
    };
  });
}

function calendarDateLabel(
  view: CalendarView,
  monthCursor: Date,
  weekCursor: Date,
): string {
  if (view === "month") {
    return monthCursor.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const weekEnd = addUtcDays(weekCursor, 6);
  const startLabel = weekCursor.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endLabel = weekEnd.toLocaleDateString("en-US", {
    month: weekEnd.getUTCMonth() === weekCursor.getUTCMonth() ? undefined : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${startLabel} – ${endLabel}`;
}

const AGENDA_FILTERS: readonly ("All" | CalendarActivityType)[] = [
  "All",
  "Pickup",
  "Return",
  "Fitting",
];

const reservationStatusTone = {
  Confirmed: "reservation-status-confirmed",
  Completed: "reservation-status-completed",
  Pending: "reservation-status-pending",
} as const;

function reservationDetailsFor(activity: CalendarActivity) {
  const index = Math.max(0, CALENDAR_ACTIVITIES.findIndex((item) => item.id === activity.id));
  const startDate = parseDateKey(activity.dateKey);
  const endDate = addUtcDays(startDate, 3);
  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const status: keyof typeof reservationStatusTone =
    activity.type === "Return" ? "Completed" : activity.type === "Fitting" ? "Pending" : "Confirmed";
  const nameParts = activity.customer.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
  const email = `${nameParts.join(".") || "customer"}@email.com`;
  const size = ["S", "M", "L"][index % 3] ?? "M";
  const category = activity.clothing.toLowerCase().includes("barong")
    ? "Barong"
    : activity.clothing.toLowerCase().includes("dress")
      ? "Dress"
      : "Gown";

  return {
    reservationNumber: `R-${String(146 + index).padStart(5, "0")}`,
    status,
    createdAt: `${formatDate(startDate)} · 11:24 AM`,
    size,
    category,
    color: activity.clothing.toLowerCase().includes("black") ? "Black" : "Assorted",
    phone: `+63 9${12 + (index % 7)} ${String(345 + index).slice(-3)} ${String(6789 + index).slice(-4)}`,
    email,
    rentalStart: formatDate(startDate),
    rentalEnd: formatDate(endDate),
    pickupTime:
      activity.type === "Pickup"
        ? formatClockMinutes(timeToMinutes(activity.startTime))
        : "10:00 AM",
    returnTime:
      activity.type === "Return"
        ? formatClockMinutes(timeToMinutes(activity.startTime))
        : "10:00 AM",
    duration: "4 days",
    price: "₱1,500/day",
  };
}

function ReservationDetailsSheet({
  activity,
  onOpenChange,
}: {
  activity: CalendarActivity | null;
  onOpenChange: (open: boolean) => void;
}) {
  const details = activity ? reservationDetailsFor(activity) : null;

  return (
    <Sheet open={Boolean(activity)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-xl lg:max-w-2xl"
      >
        {activity && details ? (
          <div className="flex min-h-full flex-col">
            <header className="border-b border-dashboard-border px-5 py-5 pr-14">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent">
                  <CalendarDays className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="text-lg">Reservation #{details.reservationNumber}</SheetTitle>
                    <Badge
                      variant="outline"
                      className={cn("px-2 py-1 text-xs", reservationStatusTone[details.status])}
                    >
                      {details.status}
                    </Badge>
                  </div>
                  <SheetDescription className="mt-1">Created {details.createdAt}</SheetDescription>
                </div>
              </div>
            </header>

            <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
              <Card className="gap-0 py-0">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-lg font-semibold text-dashboard-accent">
                    {activity.clothing
                      .split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-dashboard-navy">{activity.clothing}</h2>
                      <Badge variant="secondary" className="px-2 py-1 text-xs">{details.category}</Badge>
                    </div>
                    <p className="mt-2 text-base font-semibold text-dashboard-navy">{details.price}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="secondary" className="px-2 py-1 text-xs">Size {details.size}</Badge>
                      <Badge variant="secondary" className="px-2 py-1 text-xs">Color {details.color}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-dashboard-navy">Customer Details</h3>
                    <button type="button" className="text-xs font-medium text-dashboard-accent hover:underline">
                      View customer →
                    </button>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-dashboard-active text-sm font-semibold text-dashboard-accent">
                      {activity.customer
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-dashboard-navy">{activity.customer}</p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-dashboard-muted">
                        <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                        {details.phone}
                      </p>
                      <p className="mt-1 flex items-center gap-2 truncate text-xs text-dashboard-muted">
                        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {details.email}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-dashboard-navy">Rental Period</h3>
                    <Badge variant="secondary" className="px-2 py-1 text-xs">{details.duration}</Badge>
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-dashboard-navy">
                    <CalendarDays className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
                    {details.rentalStart} <span className="text-dashboard-muted">→</span> {details.rentalEnd}
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-3 border-t border-dashboard-border pt-4 sm:grid-cols-3">
                    <DetailMetric icon={Truck} label="Pickup" value={`${details.rentalStart.replace(", 2026", "")}, ${details.pickupTime}`} />
                    <DetailMetric icon={RotateCcw} label="Return" value={`${details.rentalEnd.replace(", 2026", "")}, ${details.returnTime}`} />
                    <DetailMetric icon={Clock3} label="Duration" value={details.duration} />
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-dashboard-navy">Status Timeline</h3>
                  <div className="mt-4 space-y-0">
                    <TimelineStep label="Reservation Created" note={`${details.rentalStart.replace(", 2026", "")}, 11:24 AM`} complete />
                    <TimelineStep label="Payment Confirmed" note={`${details.rentalStart.replace(", 2026", "")}, 11:35 AM`} complete />
                    <TimelineStep label="Pickup Completed" note={`${details.rentalStart.replace(", 2026", "")}, 9:52 AM`} complete={activity.type !== "Fitting"} />
                    <TimelineStep label="Return Pending" note={`${details.rentalEnd.replace(", 2026", "")}, ${details.returnTime}`} complete={false} last />
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-dashboard-navy">Additional Information</h3>
                  <div className="mt-4 space-y-4">
                    <InfoRow icon={Truck} label="Pickup Method" value="Pick up (Store)" />
                    <InfoRow icon={WalletCards} label="Payment Method" value="Cash" />
                    <InfoRow icon={FileText} label="Notes" value="Customer requested a size check before pickup." />
                  </div>
                </CardContent>
              </Card>
            </div>

            <footer className="sticky bottom-0 mt-auto grid grid-cols-1 gap-2 border-t border-dashboard-border bg-dashboard-surface/95 p-4 backdrop-blur sm:grid-cols-2">
              <Button variant="ghost" className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                View Full Reservation
              </Button>
              <Button className="bg-dashboard-accent text-dashboard-canvas hover:bg-dashboard-accent/90">
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit Reservation
              </Button>
            </footer>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Truck;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-accent" aria-hidden="true" />
      <div>
        <p className="text-xs text-dashboard-muted">{label}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-dashboard-navy">{value}</p>
      </div>
    </div>
  );
}

function TimelineStep({
  complete,
  label,
  last = false,
  note,
}: {
  complete: boolean;
  label: string;
  last?: boolean;
  note: string;
}) {
  return (
    <div className="relative flex gap-3 pb-5 last:pb-0">
      {!last ? <span className="absolute left-[0.7rem] top-6 h-[calc(100%-1rem)] w-px bg-dashboard-border" /> : null}
      <span
        className={cn(
          "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          complete
            ? "bg-dashboard-green-soft text-dashboard-green-text"
            : "bg-dashboard-gold-soft text-dashboard-gold-text"
        )}
      >
        {complete ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
      </span>
      <div>
        <p className="text-sm font-semibold text-dashboard-navy">{label}</p>
        <p className="mt-1 text-xs text-dashboard-muted">{note}</p>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Truck;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div>
        <p className="text-xs text-dashboard-muted">{label}</p>
        <p className="mt-1 text-sm font-medium text-dashboard-navy">{value}</p>
      </div>
    </div>
  );
}

function DayAgendaSheet({
  agendaFilter,
  dateKey,
  onAgendaFilterChange,
  onOpenChange,
  onSelectDate,
  onViewDetails,
}: {
  agendaFilter: "All" | CalendarActivityType;
  dateKey: string | null;
  onAgendaFilterChange: (filter: "All" | CalendarActivityType) => void;
  onOpenChange: (open: boolean) => void;
  onSelectDate: (dateKey: string) => void;
  onViewDetails: (activity: CalendarActivity) => void;
}) {
  const day = dateKey ? parseDateKey(dateKey) : null;
  const agenda = dateKey ? CALENDAR_DAY_AGENDA[dateKey] ?? [] : [];
  const filteredAgenda =
    agendaFilter === "All" ? agenda : agenda.filter((activity) => activity.type === agendaFilter);

  const counts = Object.fromEntries(
    AGENDA_FILTERS.map((filter) => [
      filter,
      filter === "All" ? agenda.length : agenda.filter((activity) => activity.type === filter).length,
    ])
  ) as Record<(typeof AGENDA_FILTERS)[number], number>;

  const moveDay = (direction: -1 | 1) => {
    if (!day) return;
    onSelectDate(formatDateKey(addUtcDays(day, direction)));
  };

  return (
    <Sheet open={Boolean(day)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-xl lg:max-w-2xl"
      >
        {day ? (
          <div className="flex min-h-full flex-col">
            <header className="border-b border-dashboard-border px-5 py-5 pr-14">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent">
                    <CalendarDays className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <SheetTitle className="text-lg sm:text-xl">
                      {day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
                    </SheetTitle>
                    <SheetDescription className="mt-0.5">
                      {day.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}
                    </SheetDescription>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1 pr-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Previous day"
                    onClick={() => moveDay(-1)}
                    className="h-9 w-9"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Next day"
                    onClick={() => moveDay(1)}
                    className="h-9 w-9"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["Pickup", "Return", "Fitting"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onAgendaFilterChange(type)}
                    className="rounded-lg border border-dashboard-border bg-dashboard-surface px-3 py-3 text-left transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
                  >
                    <span className="block text-lg font-semibold text-dashboard-navy">{counts[type]}</span>
                    <span className="mt-1 block text-xs text-dashboard-muted">{`${type}s`}</span>
                  </button>
                ))}
              </div>
            </header>

            <div className="border-b border-dashboard-border px-5 py-4">
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Agenda activity type">
                {AGENDA_FILTERS.map((filter) => {
                  const selected = agendaFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => onAgendaFilterChange(filter)}
                      className={cn(
                        "shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                        selected
                          ? "border-dashboard-accent bg-dashboard-active text-dashboard-accent"
                          : "border-dashboard-border bg-dashboard-surface text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy"
                      )}
                    >
                      {filter} ({counts[filter]})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-2 p-4 sm:p-5">
              {filteredAgenda.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-dashboard-border text-sm text-dashboard-muted">
                  No {agendaFilter.toLowerCase()} activities for this day.
                </div>
              ) : (
                filteredAgenda.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    aria-label={`Agenda ${activity.type}: ${activity.customer}, ${activity.clothing}, ${formatActivityTime(activity)}`}
                    onClick={() => onViewDetails(activity)}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-xl border border-dashboard-border bg-dashboard-surface p-3 text-left transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center sm:p-4"
                  >
                    <span className="text-xs font-semibold text-dashboard-muted">
                      {formatActivityTime(activity)}
                    </span>
                    <span className="min-w-0">
                      <Badge
                        variant="outline"
                        className={cn("mb-2 px-2 py-1 text-[0.68rem]", activityTone[activity.type])}
                      >
                        {activity.type}
                      </Badge>
                      <span className="block truncate text-sm font-semibold text-dashboard-navy">
                        {activity.customer}
                      </span>
                      <span className="mt-1 block truncate text-xs text-dashboard-muted">
                        {activity.clothing}
                      </span>
                    </span>
                    <span className="col-start-2 text-xs font-medium text-dashboard-accent sm:col-start-auto">
                      View details →
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
