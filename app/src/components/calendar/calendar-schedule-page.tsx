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
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<CalendarActivity | null>(null);
  const [agendaFilter, setAgendaFilter] = useState<"All" | CalendarActivityType>("All");

  const visibleActivities = useMemo(
    () =>
      activityFilter === "All Activity"
        ? CALENDAR_ACTIVITIES
        : CALENDAR_ACTIVITIES.filter((activity) => activity.type === activityFilter),
    [activityFilter]
  );

  const openDayAgenda = (dayKey: string) => {
    setSelectedActivity(null);
    setSelectedDayKey(dayKey);
    setAgendaFilter("All");
  };

  const openActivityDetails = (activity: CalendarActivity) => {
    setSelectedDayKey(null);
    setSelectedActivity(activity);
  };

  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4">
        <CalendarHeading />
        <CalendarControls activityFilter={activityFilter} onActivityFilterChange={setActivityFilter} />
        <ScheduleGrid
          activities={visibleActivities}
          onOpenActivity={openActivityDetails}
          onOpenDay={openDayAgenda}
        />
      </div>

      <DayAgendaSheet
        agendaFilter={agendaFilter}
        dayKey={selectedDayKey}
        onAgendaFilterChange={setAgendaFilter}
        onViewDetails={(activity) => {
          setSelectedDayKey(null);
          setSelectedActivity(activity);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDayKey(null);
          }
        }}
        onSelectDay={(dayKey) => {
          setSelectedDayKey(dayKey);
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

function ScheduleGrid({
  activities,
  onOpenActivity,
  onOpenDay,
}: {
  activities: readonly CalendarActivity[];
  onOpenActivity: (activity: CalendarActivity) => void;
  onOpenDay: (dayKey: string) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="min-w-[70rem]">
            <div className="grid grid-cols-[5rem_repeat(7,minmax(0,1fr))] border-b border-dashboard-border">
              <div className="border-r border-dashboard-border bg-dashboard-surface" />
              {CALENDAR_DAYS.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => onOpenDay(day.key)}
                  aria-label={`Open ${day.label} ${day.date} agenda`}
                  className={cn(
                    "border-r border-dashboard-border bg-dashboard-surface px-4 py-3 text-left transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30 last:border-r-0",
                    day.key === "wed" && "bg-dashboard-active"
                  )}
                >
                  <p className={cn("text-sm font-semibold text-dashboard-navy", day.key === "wed" && "text-dashboard-accent")}>{day.label}</p>
                  <p className="mt-0.5 text-xs text-dashboard-muted">{day.date}</p>
                  <span className="mt-2 inline-flex rounded-full bg-dashboard-neutral-soft px-2 py-1 text-[0.7rem] font-medium text-dashboard-neutral-text">
                    {day.activityCount} activities
                  </span>
                </button>
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
                  onOpenActivity={onOpenActivity}
                  onOpenDay={onOpenDay}
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
  onOpenActivity,
  onOpenDay,
}: {
  activities: readonly CalendarActivity[];
  dayKey: string;
  highlighted: boolean;
  onOpenActivity: (activity: CalendarActivity) => void;
  onOpenDay: (dayKey: string) => void;
}) {
  return (
    <div className={cn("relative grid grid-rows-[repeat(20,minmax(0,1fr))] border-r border-dashboard-border last:border-r-0", highlighted && "bg-dashboard-active/40")}> 
      {Array.from({ length: 20 }).map((_, index) => (
        <div key={index} className={cn("min-h-8", index % 2 === 1 && "border-b border-dashboard-border")} />
      ))}

      <div className="pointer-events-none absolute inset-0 grid grid-rows-[repeat(20,minmax(0,1fr))] p-2">
        {activities.map((activity) => (
          <ActivityCard key={activity.id} activity={activity} onClick={() => onOpenActivity(activity)} />
        ))}
        <button
          type="button"
          onClick={() => onOpenDay(dayKey)}
          className="pointer-events-auto mx-1 self-end rounded-full bg-dashboard-neutral-soft px-2 py-1 text-center text-[0.7rem] font-medium text-dashboard-neutral-text transition-colors hover:bg-dashboard-active hover:text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
          style={{ gridRow: "20" }}
          aria-label={`Open all ${dayKey} activities`}
        >
          + {CALENDAR_MORE_COUNTS[dayKey] ?? 0} more
        </button>
      </div>
    </div>
  );
}

function ActivityCard({
  activity,
  onClick,
}: {
  activity: CalendarActivity;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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

const WEEKDAY_NAMES: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const AGENDA_FILTERS: readonly ("All" | CalendarActivityType)[] = [
  "All",
  "Pickup",
  "Return",
  "Fitting",
  "Reservation",
];

const reservationStatusTone = {
  Confirmed: "reservation-status-confirmed",
  Completed: "reservation-status-completed",
  Pending: "reservation-status-pending",
} as const;

function reservationDetailsFor(activity: CalendarActivity) {
  const allActivities = Object.values(CALENDAR_DAY_AGENDA).flat();
  const index = Math.max(0, allActivities.findIndex((item) => item.id === activity.id));
  const day = CALENDAR_DAYS.find((item) => item.key === activity.day) ?? CALENDAR_DAYS[0]!;
  const dayNumber = Number(day.date.replace("Sep ", ""));
  const startDate = new Date(2025, 8, dayNumber);
  const endDate = new Date(2025, 8, dayNumber + 3);
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
    pickupTime: activity.type === "Pickup" ? activity.time : "10:00 AM",
    returnTime: activity.type === "Return" ? activity.time : "10:00 AM",
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
                    <DetailMetric icon={Truck} label="Pickup" value={`${details.rentalStart.replace(", 2025", "")}, ${details.pickupTime}`} />
                    <DetailMetric icon={RotateCcw} label="Return" value={`${details.rentalEnd.replace(", 2025", "")}, ${details.returnTime}`} />
                    <DetailMetric icon={Clock3} label="Duration" value={details.duration} />
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-dashboard-navy">Status Timeline</h3>
                  <div className="mt-4 space-y-0">
                    <TimelineStep label="Reservation Created" note={`${details.rentalStart.replace(", 2025", "")}, 11:24 AM`} complete />
                    <TimelineStep label="Payment Confirmed" note={`${details.rentalStart.replace(", 2025", "")}, 11:35 AM`} complete />
                    <TimelineStep label="Pickup Completed" note={`${details.rentalStart.replace(", 2025", "")}, 9:52 AM`} complete={activity.type !== "Fitting"} />
                    <TimelineStep label="Return Pending" note={`${details.rentalEnd.replace(", 2025", "")}, ${details.returnTime}`} complete={false} last />
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
  dayKey,
  onAgendaFilterChange,
  onOpenChange,
  onSelectDay,
  onViewDetails,
}: {
  agendaFilter: "All" | CalendarActivityType;
  dayKey: string | null;
  onAgendaFilterChange: (filter: "All" | CalendarActivityType) => void;
  onOpenChange: (open: boolean) => void;
  onSelectDay: (dayKey: string) => void;
  onViewDetails: (activity: CalendarActivity) => void;
}) {
  const dayIndex = dayKey ? CALENDAR_DAYS.findIndex((day) => day.key === dayKey) : -1;
  const day = dayIndex >= 0 ? CALENDAR_DAYS[dayIndex] : undefined;
  const agenda = dayKey ? CALENDAR_DAY_AGENDA[dayKey] ?? [] : [];
  const filteredAgenda =
    agendaFilter === "All" ? agenda : agenda.filter((activity) => activity.type === agendaFilter);

  const counts = Object.fromEntries(
    AGENDA_FILTERS.map((filter) => [
      filter,
      filter === "All" ? agenda.length : agenda.filter((activity) => activity.type === filter).length,
    ])
  ) as Record<(typeof AGENDA_FILTERS)[number], number>;

  const moveDay = (direction: -1 | 1) => {
    if (dayIndex < 0) return;
    const next = CALENDAR_DAYS[dayIndex + direction];
    if (next) onSelectDay(next.key);
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
                      {day.date.replace("Sep", "September")}, 2025
                    </SheetTitle>
                    <SheetDescription className="mt-0.5">
                      {WEEKDAY_NAMES[day.key] ?? day.label}
                    </SheetDescription>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1 pr-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Previous day"
                    disabled={dayIndex <= 0}
                    onClick={() => moveDay(-1)}
                    className="h-9 w-9"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Next day"
                    disabled={dayIndex === CALENDAR_DAYS.length - 1}
                    onClick={() => moveDay(1)}
                    className="h-9 w-9"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["Pickup", "Return", "Fitting", "Reservation"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onAgendaFilterChange(type)}
                    className="rounded-lg border border-dashboard-border bg-dashboard-surface px-3 py-3 text-left transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
                  >
                    <span className="block text-lg font-semibold text-dashboard-navy">{counts[type]}</span>
                    <span className="mt-1 block text-xs text-dashboard-muted">{type === "Reservation" ? "Reservations" : `${type}s`}</span>
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
                    aria-label={`Agenda ${activity.type}: ${activity.customer}, ${activity.clothing}, ${activity.time}`}
                    onClick={() => onViewDetails(activity)}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-xl border border-dashboard-border bg-dashboard-surface p-3 text-left transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center sm:p-4"
                  >
                    <span className="text-xs font-semibold text-dashboard-muted">{activity.time}</span>
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
