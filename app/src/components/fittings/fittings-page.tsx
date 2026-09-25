"use client";

import { CalendarClock, ChevronDown, Clock3, Plus, Search, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  FITTING_PROTOTYPE_APPOINTMENTS,
  FITTING_PROTOTYPE_ROUTES,
  FITTING_PROTOTYPE_TODAY,
  type FittingPrototypeAppointment,
  type FittingPrototypeStatus,
} from "./fitting-prototype-data";

type FittingDateFilter = "all" | "today" | "upcoming";

const STATUS_OPTIONS: readonly FittingPrototypeStatus[] = [
  "Pending",
  "Confirmed",
  "Completed",
  "Cancelled",
  "Rejected",
  "No-show",
];

const DATE_FILTER_LABELS: Record<FittingDateFilter, string> = {
  all: "All dates",
  today: "Today",
  upcoming: "Upcoming",
};

const SUMMARY_ITEMS = [
  { key: "today", label: "Today", icon: CalendarClock, tone: "dashboard-tone-blue" },
  { key: "upcoming", label: "Upcoming", icon: Clock3, tone: "dashboard-tone-mint" },
  { key: "pending", label: "Pending review", icon: UserCheck, tone: "dashboard-tone-purple" },
] as const;

export function FittingsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<FittingPrototypeStatus | null>(null);
  const [dateFilter, setDateFilter] = useState<FittingDateFilter>("all");

  const summary = useMemo(
    () => ({
      today: FITTING_PROTOTYPE_APPOINTMENTS.filter(
        (appointment) => appointmentDate(appointment) === FITTING_PROTOTYPE_TODAY
      ).length,
      upcoming: FITTING_PROTOTYPE_APPOINTMENTS.filter(
        (appointment) => appointmentDate(appointment) > FITTING_PROTOTYPE_TODAY
      ).length,
      pending: FITTING_PROTOTYPE_APPOINTMENTS.filter(
        (appointment) => appointment.status === "Pending"
      ).length,
    }),
    []
  );

  const visibleAppointments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return FITTING_PROTOTYPE_APPOINTMENTS.filter((appointment) => {
      if (normalizedQuery && !matchesSearch(appointment, normalizedQuery)) return false;
      if (status && appointment.status !== status) return false;

      const date = appointmentDate(appointment);
      if (dateFilter === "today" && date !== FITTING_PROTOTYPE_TODAY) return false;
      if (dateFilter === "upcoming" && date <= FITTING_PROTOTYPE_TODAY) return false;

      return true;
    });
  }, [dateFilter, query, status]);

  const hasActiveFilters = Boolean(query.trim() || status || dateFilter !== "all");

  const clearFilters = () => {
    setQuery("");
    setStatus(null);
    setDateFilter("all");
  };

  return (
    <div className="min-h-[calc(100svh-4.5rem)] bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <FittingsHeading />

        <section aria-label="Fitting workload" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SUMMARY_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.key} className="gap-0 py-0">
                <CardContent className="flex min-h-20 items-center gap-3 p-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      item.tone
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-xl font-semibold leading-none text-dashboard-navy">
                      {summary[item.key]}
                    </span>
                    <span className="mt-1 block text-xs text-dashboard-muted">{item.label}</span>
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <Card className="gap-0 overflow-visible py-0">
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 p-4 xl:flex-row xl:items-end">
              <label className="relative min-w-0 flex-1 xl:max-w-xl">
                <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
                  Search fittings
                </span>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-dashboard-muted"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Customer or garment..."
                  className="pl-9"
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:flex xl:items-end">
                <FilterMenu
                  label="Status"
                  value={status ?? "All statuses"}
                  options={["All statuses", ...STATUS_OPTIONS]}
                  onSelect={(value) =>
                    setStatus(value === "All statuses" ? null : (value as FittingPrototypeStatus))
                  }
                />

                <FilterMenu
                  label="Date"
                  value={DATE_FILTER_LABELS[dateFilter]}
                  options={["All dates", "Today", "Upcoming"]}
                  onSelect={(value) => {
                    const next = Object.entries(DATE_FILTER_LABELS).find(
                      ([, label]) => label === value
                    )?.[0] as FittingDateFilter | undefined;
                    setDateFilter(next ?? "all");
                  }}
                />
              </div>

              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearFilters}
                  className="shrink-0 text-dashboard-muted hover:text-dashboard-navy"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Clear filters
                </Button>
              ) : null}
            </div>

            <div
              className="border-t border-dashboard-border px-4 py-3 text-sm text-dashboard-muted"
              aria-live="polite"
            >
              {visibleAppointments.length === 0 ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>No fittings match these filters.</span>
                  <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </div>
              ) : (
                <span>
                  Showing {visibleAppointments.length} of {FITTING_PROTOTYPE_APPOINTMENTS.length}{" "}
                  appointments
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FittingsHeading() {
  return (
    <section
      aria-labelledby="fittings-heading"
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <h1 id="fittings-heading" className="text-2xl font-bold tracking-tight text-dashboard-navy">
          Fittings
        </h1>
        <p className="mt-1 text-sm text-dashboard-muted">
          Manage fitting appointments and today&apos;s schedule.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link
          href={FITTING_PROTOTYPE_ROUTES.schedule}
          className={cn(buttonVariants({ variant: "secondary" }), "w-full sm:w-auto")}
        >
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Schedule &amp; Availability
        </Link>
        <Button
          type="button"
          disabled
          aria-describedby="new-fitting-phase-note"
          className="w-full sm:w-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Fitting
        </Button>
        <span id="new-fitting-phase-note" className="sr-only">
          The New Fitting interaction is added in a later frontend prototype phase.
        </span>
      </div>
    </section>
  );
}

function FilterMenu({
  label,
  onSelect,
  options,
  value,
}: {
  label: string;
  onSelect: (value: string) => void;
  options: readonly string[];
  value: string;
}) {
  return (
    <div className="min-w-0 sm:min-w-36">
      <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active sm:min-w-36"
          >
            <span className="truncate">{value}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          {options.map((option) => (
            <DropdownMenuItem key={option} onSelect={() => onSelect(option)}>
              {option}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function appointmentDate(appointment: FittingPrototypeAppointment): string {
  return appointment.startsAt.slice(0, 10);
}

function matchesSearch(appointment: FittingPrototypeAppointment, query: string): boolean {
  if (appointment.customer.name.toLocaleLowerCase().includes(query)) return true;

  return appointment.garments.some(
    (garment) =>
      garment.productName.toLocaleLowerCase().includes(query) ||
      garment.variantLabel.toLocaleLowerCase().includes(query)
  );
}
