"use client";

import { useAuth } from "@clerk/nextjs";
import { ArrowRight, ChevronRight, CircleAlert, Clock3, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { DashboardOverviewResponse, DashboardOverviewScheduleEvent } from "@drezivo/contracts";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHero } from "@/components/shell/page-hero";
import { calendarDateKeyAt } from "@/components/calendar/calendar-schedule-data";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

import {
  DASHBOARD_METRIC_PRESENTATION,
  type DashboardMetricKey,
  type DashboardTone,
  type ScheduleEventType,
} from "./dashboard-data";

const metricToneClasses: Record<DashboardTone, string> = {
  purple: "dashboard-tone-purple",
  mint: "dashboard-tone-mint",
  blue: "dashboard-tone-blue",
  orange: "dashboard-tone-orange",
  lavender: "dashboard-tone-lavender",
};

const eventToneClasses: Record<ScheduleEventType, string> = {
  Fitting: "dashboard-event-fitting",
  Pickup: "dashboard-event-pickup",
  Return: "dashboard-event-return",
};

type DashboardMetricEntry = {
  key: DashboardMetricKey;
  value: number;
};

function metricHref(key: DashboardMetricKey, today: string): string {
  switch (key) {
    case "active_rentals":
      return "/reservations?status=picked_up";
    case "pickups_today":
      return `/calendar?date=${today}&activity=pickup`;
    case "returns_today":
      return `/calendar?date=${today}&activity=return`;
    case "fittings_today":
      return "/fittings?date=today";
    case "payments_to_review":
      return "/reservations?status=pending_confirmation";
  }
}

function EventBadge({ type }: { type: ScheduleEventType }) {
  return (
    <Badge variant="outline" className={eventToneClasses[type]}>
      {type}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className =
    normalized === "confirmed"
      ? "dashboard-status-confirmed"
      : normalized === "picked_up"
        ? "reservation-status-picked-up"
        : normalized === "returned"
          ? "dashboard-event-return"
          : normalized === "completed"
            ? "dashboard-event-reservation"
            : "dashboard-status-pending";

  return (
    <Badge variant="outline" className={className}>
      {humanize(status)}
    </Badge>
  );
}

export function DashboardOverview() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<DrezivoApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setOverview(null);
      setError(new DrezivoApiError("Sign in to view your dashboard.", { status: 401 }));
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void createDrezivoApiClient(getToken)
      .getDashboardOverview()
      .then(({ data }) => {
        if (!cancelled) setOverview(data);
      })
      .catch((caughtError: unknown) => {
        if (cancelled) return;
        setOverview(null);
        setError(toDashboardError(caughtError));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, reloadVersion]);

  if (!isLoaded || isLoading) {
    return (
      <div className="min-h-[calc(100svh-72px)] px-10 py-5 sm:py-6" aria-busy="true">
        <p role="status" className="text-sm text-dashboard-muted">
          Loading your dashboard…
        </p>
      </div>
    );
  }

  if (error || !overview) {
    const message =
      error?.status === 403
        ? "You do not have permission to view this dashboard."
        : error?.status === 409
          ? "This workspace is currently read-only for dashboard operations."
          : (error?.message ?? "The dashboard could not be loaded.");
    return (
      <div className="min-h-[calc(100svh-72px)] px-10 py-5 sm:py-6">
        <Card role="alert" className="mx-auto max-w-2xl">
          <CardContent className="flex flex-col items-start gap-4 p-6">
            <div className="flex items-center gap-2 text-dashboard-navy">
              <CircleAlert className="h-5 w-5 text-dashboard-accent" aria-hidden="true" />
              <h1 className="text-lg font-semibold">Dashboard unavailable</h1>
            </div>
            <p className="text-sm text-dashboard-muted">{message}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReloadVersion((version) => version + 1)}
              disabled={error?.status === 403 || error?.status === 409 || error?.status === 401}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metricEntries: DashboardMetricEntry[] = [
    { key: "active_rentals", value: overview.metrics.active_rentals },
    { key: "pickups_today", value: overview.metrics.pickups_today },
    { key: "returns_today", value: overview.metrics.returns_today },
    { key: "fittings_today", value: overview.metrics.fittings_today },
    { key: "payments_to_review", value: overview.metrics.payments_to_review },
  ];
  const today = calendarDateKeyAt(new Date(overview.window.as_of), overview.window.timezone);

  return (
    <div className="min-h-full px-ws-gutter py-5 sm:py-6">
      <div className="mx-auto space-y-5">
        <PageHero
          headingId="dashboard-heading"
          eyebrow={formatDate(overview.window.as_of, overview.window.timezone)}
          title={
            <>
              Your rental business <em className="text-dashboard-accent">today</em>
            </>
          }
          description="Live activity for this branch, plus performance for the current calendar month."
        />

        {/* Bento: two across on phones (the fifth card spans both), five across on wide screens. */}
        <section aria-label="Today's overview" className="grid grid-cols-2 gap-ws-gap xl:grid-cols-5 [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
          {metricEntries.map(({ key, value }) => {
            const metric = DASHBOARD_METRIC_PRESENTATION[key];
            const Icon = metric.icon;
            return (
              <Link
                key={key}
                href={metricHref(key, today)}
                aria-label={`View ${metric.label}`}
                className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent focus-visible:ring-offset-2 focus-visible:ring-offset-dashboard-canvas"
              >
                <Card className="min-h-36 justify-between py-4 sm:min-h-[166px] sm:py-5 transition-colors group-hover:border-dashboard-accent/50 group-focus-visible:border-dashboard-accent">
                  <CardContent className="flex h-full flex-col justify-between px-4 sm:px-5">
                    <div className="flex items-center justify-between">
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-xl",
                          metricToneClasses[metric.tone]
                        )}
                      >
                        <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                      </div>
                      <ChevronRight
                        className="h-5 w-5 text-dashboard-navy transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="mt-5">
                      <CardTitle as="h2" className="text-sm font-medium text-dashboard-navy/80">
                        {metric.label}
                      </CardTitle>
                      <p className="mt-1 text-ws-kpi font-semibold tabular-nums tracking-tight leading-none text-dashboard-navy">
                        {value.toLocaleString("en-PH")}
                      </p>
                      <p className="mt-1.5 text-sm text-dashboard-muted">{metric.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>

        <section aria-label="Dashboard activity" className="grid gap-5 xl:grid-cols-[1.05fr_1fr]">
          <Card className="py-0">
            <CardHeader className="border-b border-dashboard-border px-5 py-5">
              <CardTitle as="h2" className="text-base text-dashboard-navy">
                Today&apos;s Schedule
              </CardTitle>
              <CardAction>
                <Link
                  href="/calendar"
                  className="flex items-center gap-1 text-sm font-semibold text-dashboard-accent"
                >
                  View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              {overview.today_schedule.items.length === 0 ? (
                <p className="px-5 py-8 text-sm text-dashboard-muted">
                  No schedule activity today.
                </p>
              ) : (
                <Table aria-label="Today's schedule" className="min-w-[680px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Gown</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.today_schedule.items.map((event) => (
                      <ScheduleRow
                        key={event.id}
                        event={event}
                        timezone={overview.window.timezone}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
              {overview.today_schedule.truncated && (
                <p className="border-t border-dashboard-border px-5 py-3 text-xs text-dashboard-muted">
                  Showing {overview.today_schedule.items.length} of {overview.today_schedule.total}{" "}
                  events.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b border-dashboard-border px-5 py-5">
              <CardTitle as="h2" className="text-base text-dashboard-navy">
                Upcoming Rentals
              </CardTitle>
              <CardAction>
                <Link
                  href="/reservations"
                  className="flex items-center gap-1 text-sm font-semibold text-dashboard-accent"
                >
                  View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5">Customer</TableHead>
                      <TableHead>Clothing</TableHead>
                      <TableHead>Rental Period</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-8 pr-5">
                        <span className="sr-only">Open</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.upcoming_rentals.items.map((rental) => (
                      <TableRow key={rental.id}>
                        <TableCell className="pl-5">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8 dashboard-tone-purple">
                              <AvatarFallback className="text-xs dashboard-tone-purple">
                                {initials(rental.customer_name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-dashboard-navy">
                              {rental.customer_name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-dashboard-muted">
                          {rental.item_names.join(", ") || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-dashboard-navy/80">
                          {formatDateRange(
                            rental.pickup_at,
                            rental.due_at,
                            overview.window.timezone
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={rental.status} />
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <ChevronRight
                            className="ml-auto h-4 w-4 text-dashboard-navy"
                            aria-hidden="true"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {overview.upcoming_rentals.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-dashboard-muted">
                          No upcoming rentals in this window.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {overview.upcoming_rentals.truncated && (
                <p className="border-t border-dashboard-border px-5 py-3 text-xs text-dashboard-muted">
                  Showing 5 of {overview.upcoming_rentals.total} upcoming rentals.
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <section
          aria-label="Fitting appointments and business performance"
          className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]"
        >
          <Card className="py-0">
            <CardHeader className="border-b border-dashboard-border px-5 py-5">
              <div>
                <CardTitle as="h2" className="text-base text-dashboard-navy">
                  Upcoming Fitting Appointments
                </CardTitle>
                <p className="mt-1 text-xs text-dashboard-muted">
                  Today and the next two days · {overview.window.timezone}
                </p>
              </div>
              <CardAction>
                <Link
                  href="/fittings"
                  aria-label="View all fitting appointments"
                  className="flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-dashboard-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dashboard-accent"
                >
                  View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              <div className="w-full overflow-x-auto">
                <Table className="min-w-[680px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5">Time</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Booked via</TableHead>
                      <TableHead>Clothing</TableHead>
                      <TableHead className="pr-5">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.upcoming_fitting_appointments.items.map((appointment) => (
                      <TableRow key={appointment.id}>
                        <TableCell className="whitespace-nowrap pl-5 text-dashboard-muted">
                          {formatDateTime(appointment.starts_at, overview.window.timezone)}
                        </TableCell>
                        <TableCell className="font-medium text-dashboard-navy">
                          {appointment.customer_name}
                        </TableCell>
                        <TableCell className="text-dashboard-muted">
                          {appointment.booking_channel === "staff" ? "Staff" : "Storefront"}
                        </TableCell>
                        <TableCell className="text-dashboard-muted">
                          {appointment.garment_names.join(", ") || "—"}
                        </TableCell>
                        <TableCell className="pr-5">
                          <StatusBadge status={appointment.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {overview.upcoming_fitting_appointments.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-dashboard-muted">
                          No upcoming fitting appointments in this window.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {overview.upcoming_fitting_appointments.truncated && (
                <p className="border-t border-dashboard-border px-5 py-3 text-xs text-dashboard-muted">
                  Showing 5 of {overview.upcoming_fitting_appointments.total} appointments.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b border-dashboard-border px-5 py-5">
              <div>
                <CardTitle as="h2" className="text-base text-dashboard-navy">
                  Business Performance
                </CardTitle>
                <p className="mt-1 text-xs text-dashboard-muted">
                  Completed rental value excludes deposits; new customers are tenant-wide.
                </p>
              </div>
              <CardAction>
                <Badge variant="outline" className="whitespace-nowrap">
                  {formatMonth(overview.window.current_month.start, overview.window.timezone)}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4 px-5 pb-5 pt-5">
              <div className="grid grid-cols-2 gap-3">
                <PerformanceMetric
                  label="Completed Rental Value"
                  value={formatMoneyMinor(
                    overview.business_performance.completed_rental_value.current_minor,
                    overview.business_performance.currency
                  )}
                  comparison={compareMoney(
                    overview.business_performance.completed_rental_value.current_minor,
                    overview.business_performance.completed_rental_value.previous_minor
                  )}
                />
                <PerformanceMetric
                  label="Completed Rentals"
                  value={overview.business_performance.completed_rentals.current.toLocaleString(
                    "en-PH"
                  )}
                  comparison={compareCounts(
                    overview.business_performance.completed_rentals.current,
                    overview.business_performance.completed_rentals.previous
                  )}
                />
                <PerformanceMetric
                  label="Average Rental Value"
                  value={
                    overview.business_performance.average_rental_value.current_minor === null
                      ? "—"
                      : formatMoneyMinor(
                          overview.business_performance.average_rental_value.current_minor,
                          overview.business_performance.currency
                        )
                  }
                  comparison={compareOptionalMoney(
                    overview.business_performance.average_rental_value.current_minor,
                    overview.business_performance.average_rental_value.previous_minor
                  )}
                />
                <PerformanceMetric
                  label="New Customers"
                  value={overview.business_performance.new_customers.current.toLocaleString(
                    "en-PH"
                  )}
                  comparison={compareCounts(
                    overview.business_performance.new_customers.current,
                    overview.business_performance.new_customers.previous
                  )}
                />
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function ScheduleRow({
  event,
  timezone,
}: {
  event: DashboardOverviewScheduleEvent;
  timezone: string;
}) {
  const type: ScheduleEventType =
    event.event_type === "fitting"
      ? "Fitting"
      : event.event_type === "pickup"
        ? "Pickup"
        : "Return";

  return (
    <TableRow>
      <TableCell className="text-sm font-medium text-dashboard-muted">
        <div className="flex items-center gap-2">
          <Clock3 className="hidden h-4 w-4 text-dashboard-navy sm:block" aria-hidden="true" />
          <span>{formatTime(event.period.start, timezone)}</span>
        </div>
      </TableCell>
      <TableCell>
        <EventBadge type={type} />
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="min-w-28">
          <p className="truncate text-xs text-dashboard-muted">
            {event.customer_phone ?? "No phone on file"}
          </p>
          <p className="truncate text-sm font-semibold text-dashboard-navy">
            {event.customer_name}
          </p>
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="min-w-40 space-y-2">
          {event.source === "reservation" ? (
            event.rental_items.length > 0 ? (
              event.rental_items.map((item, index) => (
                <div key={`${item.name}-${index}`}>
                  <p className="text-sm font-medium text-dashboard-navy">{item.name}</p>
                  <p className="text-xs text-dashboard-muted">
                    {formatRentalItemPrice(item.rental_minor, item.currency)} / {event.rental_days}{" "}
                    {event.rental_days === 1 ? "day" : "days"}
                  </p>
                </div>
              ))
            ) : (
              <span className="text-sm text-dashboard-muted">Rental</span>
            )
          ) : event.item_names.length > 0 ? (
            event.item_names.map((name, index) => (
              <p className="text-sm font-medium text-dashboard-navy" key={`${name}-${index}`}>
                {name}
              </p>
            ))
          ) : (
            <span className="text-sm text-dashboard-muted">Fitting appointment</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={event.status} />
      </TableCell>
    </TableRow>
  );
}

function PerformanceMetric({
  label,
  value,
  comparison,
}: {
  label: string;
  value: string;
  comparison: string;
}) {
  return (
    <div className="rounded-lg border border-dashboard-border bg-dashboard-surface px-3 py-3">
      <p className="text-lg font-semibold leading-tight text-dashboard-navy">{value}</p>
      <p className="mt-1 text-xs font-medium text-dashboard-navy/80">{label}</p>
      <p className="mt-1 text-xs text-dashboard-accent">{comparison}</p>
    </div>
  );
}

function formatDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateRange(start: string, end: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-PH", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

function formatMonth(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: timezone,
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatMoneyMinor(value: string, currency: string): string {
  return formatMoneyMinorWithFractionDigits(value, currency, 2);
}

function formatRentalItemPrice(value: string, currency: string): string {
  const fractionDigits = BigInt(value) % 100n === 0n ? 0 : 2;
  return formatMoneyMinorWithFractionDigits(value, currency, fractionDigits);
}

function formatMoneyMinorWithFractionDigits(
  value: string,
  currency: string,
  fractionDigits: number
): string {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const fraction = (amount % 100n).toString().padStart(2, "0");
  const locale = "en-PH";
  const currencyParts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).formatToParts(0);
  const groupedWhole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
  let insertedInteger = false;
  return currencyParts
    .map((part) => {
      if (part.type === "integer") {
        if (insertedInteger) return "";
        insertedInteger = true;
        return groupedWhole;
      }
      if (part.type === "group") return "";
      if (part.type === "fraction") return fraction;
      return part.value;
    })
    .join("");
}

function compareMoney(current: string, previous: string): string {
  return compareBigInt(BigInt(current), BigInt(previous));
}

function compareOptionalMoney(current: string | null, previous: string | null): string {
  if (current === null) return "No completed rentals this month";
  if (previous === null) return "No prior-month baseline";
  return compareBigInt(BigInt(current), BigInt(previous));
}

function compareCounts(current: number, previous: number): string {
  if (previous === 0) return "No prior-month baseline";
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change > 0 ? "+" : ""}${change}% vs previous month`;
}

function compareBigInt(current: bigint, previous: bigint): string {
  if (previous === 0n) return "No prior-month baseline";
  const change = ((current - previous) * 100n) / previous;
  return `${change > 0n ? "+" : ""}${change}% vs previous month`;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function toDashboardError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("The dashboard could not be loaded. Please try again.", { status: 503 });
}
