import { ArrowRight, ChevronRight, Clock3 } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  DASHBOARD_METRICS,
  TODAY_SCHEDULE,
  UPCOMING_RENTALS,
  type DashboardTone,
  type ScheduleEventType,
  type ScheduleStatus,
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
  Reservation: "dashboard-event-reservation",
};

const statusToneClasses: Record<ScheduleStatus, string> = {
  Confirmed: "dashboard-status-confirmed",
  Upcoming: "dashboard-status-upcoming",
  Pending: "dashboard-status-pending",
};

function EventBadge({ type, prototype }: { type: ScheduleEventType; prototype?: boolean }) {
  return (
    <Badge variant="outline" className={eventToneClasses[type]}>
      {prototype ? `${type} · Prototype` : type}
    </Badge>
  );
}

function StatusBadge({ status }: { status: ScheduleStatus }) {
  return (
    <Badge variant="outline" className={statusToneClasses[status]}>
      {status}
    </Badge>
  );
}

export function DashboardOverview() {
  return (
    <div className="min-h-[calc(100svh-72px)] px-10 py-5 sm:py-6">
      <div className="mx-auto space-y-5">
        <section
          aria-labelledby="dashboard-greeting"
          className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"
        >
          <div>
            <h1
              id="dashboard-greeting"
              className="text-[24px] font-bold tracking-[-0.03em] text-dashboard-navy"
            >
              Good morning, Maria!
            </h1>
            <p className="mt-1 text-sm text-dashboard-muted">
              Here&apos;s what&apos;s happening with your rental business today.
            </p>
          </div>
          <p className="text-sm font-medium text-dashboard-muted">Tue, Sep 10, 2025</p>
        </section>

        <section aria-label="Today's overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {DASHBOARD_METRICS.map((metric) => {
            const Icon = metric.icon;
            return (
              <Card key={metric.label} className="min-h-[166px] justify-between py-5">
                <CardContent className="flex h-full flex-col justify-between px-5">
                  <div className="flex items-center justify-between">
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-xl",
                        metricToneClasses[metric.tone]
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.8} />
                    </div>
                    <ChevronRight className="h-5 w-5 text-dashboard-navy" aria-hidden="true" />
                  </div>
                  <div className="mt-5">
                    <CardTitle as="h2" className="text-sm font-medium text-dashboard-navy/80">
                      {metric.label}
                    </CardTitle>
                    <p className="mt-1 text-[30px] font-semibold leading-none tracking-[-0.04em] text-dashboard-navy">
                      {metric.value}
                    </p>
                    <p className="mt-1.5 text-sm text-dashboard-muted">{metric.description}</p>
                  </div>
                </CardContent>
              </Card>
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
                <span className="flex items-center gap-1 text-sm font-semibold text-dashboard-accent">
                  View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              <div className="relative w-full overflow-x-auto">
                <ul aria-label="Today's schedule" className="min-w-[560px]">
                  {TODAY_SCHEDULE.map((event) => (
                    <li
                      key={`${event.time}-${event.customer}`}
                      className="grid grid-cols-[48px_76px_minmax(0,1fr)_auto_16px] items-center gap-2 border-b border-dashboard-border px-5 py-3.5 last:border-b-0 sm:grid-cols-[56px_90px_minmax(0,1fr)_auto_16px] sm:gap-3"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-dashboard-muted">
                        <Clock3
                          className="hidden h-4 w-4 text-dashboard-navy sm:block"
                          aria-hidden="true"
                        />
                        <span>{event.time}</span>
                      </div>
                      <EventBadge type={event.type} prototype={event.prototype ?? false} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-dashboard-navy">
                          {event.customer}
                        </p>
                        <p className="truncate text-sm text-dashboard-muted">{event.clothing}</p>
                      </div>
                      <StatusBadge status={event.status} />
                      <ChevronRight className="h-4 w-4 text-dashboard-navy" aria-hidden="true" />
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b border-dashboard-border px-5 py-5">
              <CardTitle as="h2" className="text-base text-dashboard-navy">
                Upcoming Rentals
              </CardTitle>
              <CardAction>
                <span className="flex items-center gap-1 text-sm font-semibold text-dashboard-accent">
                  View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
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
                  {UPCOMING_RENTALS.map((rental) => (
                    <TableRow key={rental.customer}>
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-3">
                          <Avatar className={cn("h-8 w-8", metricToneClasses[rental.avatarTone])}>
                            <AvatarFallback
                              className={cn("text-xs", metricToneClasses[rental.avatarTone])}
                            >
                              {rental.initials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-dashboard-navy">{rental.customer}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-dashboard-muted">{rental.clothing}</TableCell>
                      <TableCell className="text-dashboard-navy/80">
                        {rental.rentalPeriod}
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
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
