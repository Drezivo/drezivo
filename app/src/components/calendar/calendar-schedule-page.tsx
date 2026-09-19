"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Ruler,
  RotateCcw,
  Shirt,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  CALENDAR_ACTIVITIES,
  CALENDAR_DAYS,
  CALENDAR_HOURS,
  CALENDAR_METRICS,
  CALENDAR_MORE_COUNTS,
  type CalendarActivity,
  type CalendarActivityType,
} from "./calendar-schedule-data";

const activityTone: Record<CalendarActivityType, string> = {
  Pickup: "dashboard-event-pickup",
  Return: "dashboard-event-return",
  Fitting: "dashboard-event-fitting",
  Reservation: "dashboard-event-reservation",
};

const metricIcons = [CalendarDays, RotateCcw, Ruler, CircleAlert] as const;

const metricTone = {
  blue: "dashboard-tone-blue",
  mint: "dashboard-tone-mint",
  purple: "dashboard-tone-purple",
  danger: "bg-dashboard-danger/10 text-dashboard-danger",
} as const;

export function CalendarSchedulePage() {
  const [activityFilter, setActivityFilter] = useState<"All Activity" | CalendarActivityType>(
    "All Activity"
  );

  const visibleActivities = useMemo(
    () =>
      activityFilter === "All Activity"
        ? CALENDAR_ACTIVITIES
        : CALENDAR_ACTIVITIES.filter((activity) => activity.type === activityFilter),
    [activityFilter]
  );

  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4">
        <CalendarHeading />
        <CalendarControls activityFilter={activityFilter} onActivityFilterChange={setActivityFilter} />
        <ScheduleGrid activities={visibleActivities} />
      </div>
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
        {CALENDAR_METRICS.map((metric, index) => {
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
  onActivityFilterChange,
}: {
  activityFilter: "All Activity" | CalendarActivityType;
  onActivityFilterChange: (value: "All Activity" | CalendarActivityType) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Previous week" className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next week" className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Sep 14 – Sep 20, 2025
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-surface">
            <button type="button" aria-pressed="true" className="min-h-9 bg-dashboard-active px-5 text-xs font-semibold text-dashboard-accent">
              Week
            </button>
            <button type="button" className="min-h-9 border-l border-dashboard-border px-5 text-xs font-medium text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy">
              Month
            </button>
            <button type="button" className="min-h-9 border-l border-dashboard-border px-5 text-xs font-medium text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy">
              Day
            </button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="min-w-36 justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
                {activityFilter}
                <ChevronRight className="h-3.5 w-3.5 rotate-90 text-dashboard-muted" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(["All Activity", "Pickup", "Return", "Fitting", "Reservation"] as const).map((item) => (
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

          <Button variant="ghost" className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active">
            Today
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduleGrid({ activities }: { activities: readonly CalendarActivity[] }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="min-w-[70rem]">
            <div className="grid grid-cols-[5rem_repeat(7,minmax(0,1fr))] border-b border-dashboard-border">
              <div className="border-r border-dashboard-border bg-dashboard-surface" />
              {CALENDAR_DAYS.map((day) => (
                <div
                  key={day.key}
                  className={cn(
                    "border-r border-dashboard-border bg-dashboard-surface px-4 py-3 last:border-r-0",
                    day.key === "wed" && "bg-dashboard-active"
                  )}
                >
                  <p className={cn("text-sm font-semibold text-dashboard-navy", day.key === "wed" && "text-dashboard-accent")}>{day.label}</p>
                  <p className="mt-0.5 text-xs text-dashboard-muted">{day.date}</p>
                  <span className="mt-2 inline-flex rounded-full bg-dashboard-neutral-soft px-2 py-1 text-[0.7rem] font-medium text-dashboard-neutral-text">
                    {day.activityCount} activities
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[5rem_repeat(7,minmax(0,1fr))]">
              <TimeColumn />
              {CALENDAR_DAYS.map((day) => (
                <DayColumn
                  key={day.key}
                  dayKey={day.key}
                  highlighted={day.key === "wed"}
                  activities={activities.filter((activity) => activity.day === day.key)}
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TimeColumn() {
  return (
    <div className="grid grid-rows-10 border-r border-dashboard-border bg-dashboard-surface">
      {CALENDAR_HOURS.map((hour) => (
        <div key={hour} className="min-h-16 border-b border-dashboard-border px-3 pt-2 text-right text-[0.7rem] text-dashboard-muted last:border-b-0">
          {hour}
        </div>
      ))}
    </div>
  );
}

function DayColumn({
  activities,
  dayKey,
  highlighted,
}: {
  activities: readonly CalendarActivity[];
  dayKey: string;
  highlighted: boolean;
}) {
  return (
    <div className={cn("relative grid grid-rows-[repeat(20,minmax(0,1fr))] border-r border-dashboard-border last:border-r-0", highlighted && "bg-dashboard-active/40")}> 
      {Array.from({ length: 20 }).map((_, index) => (
        <div key={index} className={cn("min-h-8", index % 2 === 1 && "border-b border-dashboard-border")} />
      ))}

      <div className="pointer-events-none absolute inset-0 grid grid-rows-[repeat(20,minmax(0,1fr))] p-2">
        {activities.map((activity) => (
          <ActivityCard key={activity.id} activity={activity} />
        ))}
        <div
          className="pointer-events-auto mx-1 self-end rounded-full bg-dashboard-neutral-soft px-2 py-1 text-center text-[0.7rem] font-medium text-dashboard-neutral-text"
          style={{ gridRow: "20" }}
        >
          + {CALENDAR_MORE_COUNTS[dayKey] ?? 0} more
        </div>
      </div>
    </div>
  );
}

function ActivityCard({ activity }: { activity: CalendarActivity }) {
  return (
    <button
      type="button"
      className={cn(
        "pointer-events-auto mx-1 min-w-0 self-stretch rounded-lg border px-2.5 py-2 text-left shadow-sm transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
        activityTone[activity.type]
      )}
      style={{ gridRow: `${activity.rowStart} / span ${activity.rowSpan ?? 2}` }}
      aria-label={`${activity.type}: ${activity.customer}, ${activity.clothing}, ${activity.time}`}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        {activity.type === "Pickup" ? <Truck className="h-3 w-3" aria-hidden="true" /> : null}
        {activity.type === "Return" ? <RotateCcw className="h-3 w-3" aria-hidden="true" /> : null}
        {activity.type === "Fitting" ? <Ruler className="h-3 w-3" aria-hidden="true" /> : null}
        {activity.type === "Reservation" ? <CalendarDays className="h-3 w-3" aria-hidden="true" /> : null}
        {activity.type}
      </span>
      <span className="mt-1 block truncate text-[0.72rem] font-medium">{activity.customer}</span>
      <span className="block truncate text-[0.68rem] opacity-80">{activity.clothing}</span>
      <span className="block text-[0.68rem] opacity-80">{activity.time}</span>
    </button>
  );
}
