"use client";

import {
  CalendarClock,
  ChevronDown,
  CircleAlert,
  Clock3,
  Info,
  Plus,
  Search,
  Shirt,
  UserCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  FITTING_PROTOTYPE_APPOINTMENTS,
  FITTING_PROTOTYPE_ROUTES,
  FITTING_PROTOTYPE_TODAY,
  type FittingPrototypeAppointment,
  type FittingPrototypeAttentionKind,
  type FittingPrototypePaymentState,
  type FittingPrototypeStatus,
} from "./fitting-prototype-data";

type FittingDateFilter = "all" | "today" | "upcoming";
type FittingPrototypeViewState = "ready" | "loading" | "error";

type FittingsPageProps = {
  appointments?: readonly FittingPrototypeAppointment[];
  initialViewState?: FittingPrototypeViewState;
};

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

const STATUS_CLASSES: Record<FittingPrototypeStatus, string> = {
  Pending: "reservation-status-pending",
  Confirmed: "reservation-status-confirmed",
  Completed: "reservation-status-completed",
  Cancelled: "reservation-status-cancelled",
  Rejected: "reservation-status-danger",
  "No-show": "reservation-status-danger",
};

const PAYMENT_CLASSES: Record<FittingPrototypePaymentState, string> = {
  "Not required": "reservation-status-completed",
  "Pending review": "reservation-status-pending",
  Verified: "reservation-status-confirmed",
};

const APPOINTMENT_DATE_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Manila",
});

const APPOINTMENT_TIME_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

const PHP_FORMATTER = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function FittingsPage({
  appointments = FITTING_PROTOTYPE_APPOINTMENTS,
  initialViewState = "ready",
}: FittingsPageProps = {}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<FittingPrototypeStatus | null>(null);
  const [dateFilter, setDateFilter] = useState<FittingDateFilter>("all");
  const [viewState, setViewState] = useState<FittingPrototypeViewState>(initialViewState);
  const [selectedAppointment, setSelectedAppointment] =
    useState<FittingPrototypeAppointment | null>(null);

  const summary = useMemo(
    () => ({
      today: appointments.filter(
        (appointment) => appointmentDate(appointment) === FITTING_PROTOTYPE_TODAY
      ).length,
      upcoming: appointments.filter(
        (appointment) => appointmentDate(appointment) > FITTING_PROTOTYPE_TODAY
      ).length,
      pending: appointments.filter((appointment) => appointment.status === "Pending").length,
    }),
    [appointments]
  );

  const visibleAppointments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return appointments.filter((appointment) => {
      if (normalizedQuery && !matchesSearch(appointment, normalizedQuery)) return false;
      if (status && appointment.status !== status) return false;

      const date = appointmentDate(appointment);
      if (dateFilter === "today" && date !== FITTING_PROTOTYPE_TODAY) return false;
      if (dateFilter === "upcoming" && date <= FITTING_PROTOTYPE_TODAY) return false;

      return true;
    });
  }, [appointments, dateFilter, query, status]);

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

        <SummarySection summary={summary} viewState={viewState} />

        <Card className="gap-0 overflow-visible py-0">
          <CardContent className="p-0">
            <FittingsToolbar
              query={query}
              status={status}
              dateFilter={dateFilter}
              hasActiveFilters={hasActiveFilters}
              onQueryChange={setQuery}
              onStatusChange={setStatus}
              onDateFilterChange={setDateFilter}
              onClearFilters={clearFilters}
            />

            {viewState === "loading" ? (
              <AppointmentLoadingState />
            ) : viewState === "error" ? (
              <AppointmentState
                title="Could not load fitting appointments"
                message="The fitting prototype could not be displayed. Try loading the local data again."
                actionLabel="Try again"
                onAction={() => setViewState("ready")}
              />
            ) : appointments.length === 0 && !hasActiveFilters ? (
              <AppointmentState
                title="No fitting appointments yet"
                message="New fittings will appear here once the appointment workflow is in use."
              />
            ) : visibleAppointments.length === 0 ? (
              <AppointmentState
                title="No fittings match these filters"
                message="Clear or adjust the search, status, or date filter to see other fittings."
                actionLabel="Clear filters"
                onAction={clearFilters}
              />
            ) : (
              <AppointmentList
                appointments={visibleAppointments}
                onSelect={setSelectedAppointment}
              />
            )}

            {viewState === "ready" && visibleAppointments.length > 0 ? (
              <div
                className="border-t border-dashboard-border px-4 py-3 text-sm text-dashboard-muted"
                aria-live="polite"
              >
                Showing {visibleAppointments.length} of {appointments.length} appointments
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <FittingDetailsPreviewSheet
        appointment={selectedAppointment}
        onOpenChange={(open) => {
          if (!open) setSelectedAppointment(null);
        }}
      />
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

function SummarySection({
  summary,
  viewState,
}: {
  summary: { today: number; upcoming: number; pending: number };
  viewState: FittingPrototypeViewState;
}) {
  return (
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
                {viewState === "loading" ? (
                  <span className="mb-1 block h-5 w-8 animate-pulse rounded bg-dashboard-active" />
                ) : (
                  <span className="block text-xl font-semibold leading-none text-dashboard-navy">
                    {viewState === "error" ? "—" : summary[item.key]}
                  </span>
                )}
                <span className="mt-1 block text-xs text-dashboard-muted">{item.label}</span>
              </span>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function FittingsToolbar({
  dateFilter,
  hasActiveFilters,
  onClearFilters,
  onDateFilterChange,
  onQueryChange,
  onStatusChange,
  query,
  status,
}: {
  dateFilter: FittingDateFilter;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onDateFilterChange: (value: FittingDateFilter) => void;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: FittingPrototypeStatus | null) => void;
  query: string;
  status: FittingPrototypeStatus | null;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-dashboard-border p-4 xl:flex-row xl:items-end">
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
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Customer or garment..."
          className="pl-9"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:flex xl:items-end">
        <FilterMenu
          label="Status"
          value={status ?? "All statuses"}
          options={["All statuses", ...STATUS_OPTIONS]}
          onSelect={(value) =>
            onStatusChange(value === "All statuses" ? null : (value as FittingPrototypeStatus))
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
            onDateFilterChange(next ?? "all");
          }}
        />
      </div>

      {hasActiveFilters ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onClearFilters}
          className="shrink-0 text-dashboard-muted hover:text-dashboard-navy"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function AppointmentList({
  appointments,
  onSelect,
}: {
  appointments: readonly FittingPrototypeAppointment[];
  onSelect: (appointment: FittingPrototypeAppointment) => void;
}) {
  return (
    <section aria-label="Fitting appointments">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[minmax(9rem,1fr)_minmax(10rem,1.1fr)_minmax(12rem,1.4fr)_minmax(9rem,1fr)_minmax(7.5rem,0.8fr)_minmax(9rem,1fr)] gap-4 border-b border-dashboard-border bg-dashboard-surface px-4 py-3 text-xs font-semibold text-dashboard-muted lg:grid"
      >
        <span>Date &amp; time</span>
        <span>Customer</span>
        <span>Garments</span>
        <span>Fee / payment</span>
        <span>Status</span>
        <span>Attention</span>
      </div>

      <ul className="divide-y divide-dashboard-border" aria-label="Fitting appointments">
        {appointments.map((appointment) => (
          <li key={appointment.id}>
            <button
              type="button"
              onClick={() => onSelect(appointment)}
              aria-label={`Open fitting for ${appointment.customer.name} on ${formatAppointmentDate(appointment.startsAt)}`}
              className="grid w-full grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-left transition-colors hover:bg-dashboard-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30 lg:grid-cols-[minmax(9rem,1fr)_minmax(10rem,1.1fr)_minmax(12rem,1.4fr)_minmax(9rem,1fr)_minmax(7.5rem,0.8fr)_minmax(9rem,1fr)] lg:items-start lg:gap-4"
            >
              <AppointmentCell label="Date & time" className="col-span-2 lg:col-span-1">
                <p className="font-semibold text-dashboard-navy">
                  {formatAppointmentDate(appointment.startsAt)}
                </p>
                <p className="mt-1 text-xs text-dashboard-muted">
                  {formatAppointmentTimeRange(appointment)}
                </p>
              </AppointmentCell>

              <AppointmentCell label="Customer" className="col-span-2 lg:col-span-1">
                <p className="font-medium text-dashboard-navy">{appointment.customer.name}</p>
                <p className="mt-1 text-xs text-dashboard-muted">Fitting appointment</p>
              </AppointmentCell>

              <AppointmentCell label="Garments" className="col-span-2 lg:col-span-1">
                <GarmentSummary appointment={appointment} />
              </AppointmentCell>

              <AppointmentCell label="Fee / payment" className="col-span-1">
                <PaymentSummary appointment={appointment} />
              </AppointmentCell>

              <AppointmentCell label="Status" className="col-span-1">
                <Badge variant="outline" className={STATUS_CLASSES[appointment.status]}>
                  {appointment.status}
                </Badge>
              </AppointmentCell>

              <AppointmentCell label="Attention" className="col-span-2 lg:col-span-1">
                <AttentionSummary attention={appointment.attention} />
              </AppointmentCell>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AppointmentCell({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="mb-1 block text-[0.7rem] font-semibold uppercase tracking-wide text-dashboard-muted lg:hidden">
        {label}
      </span>
      {children}
    </div>
  );
}

function GarmentSummary({ appointment }: { appointment: FittingPrototypeAppointment }) {
  const firstGarment = appointment.garments[0];
  if (!firstGarment) {
    return <span className="text-sm text-dashboard-muted">No garments added</span>;
  }

  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
        <Shirt className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-dashboard-navy">
          {firstGarment.productName}
          {appointment.garments.length > 1 ? ` +${appointment.garments.length - 1} more` : ""}
        </span>
        <span className="mt-1 block truncate text-xs text-dashboard-muted">
          {firstGarment.variantLabel}
        </span>
      </span>
    </div>
  );
}

function PaymentSummary({ appointment }: { appointment: FittingPrototypeAppointment }) {
  return (
    <div className="space-y-1.5">
      <p className="font-medium text-dashboard-navy">
        {appointment.feeMinor === null ? "No fee" : formatPhpMoney(appointment.feeMinor)}
      </p>
      <Badge variant="outline" className={PAYMENT_CLASSES[appointment.paymentState]}>
        {appointment.paymentState}
      </Badge>
    </div>
  );
}

function AttentionSummary({ attention }: { attention: readonly FittingPrototypeAttentionKind[] }) {
  if (attention.length === 0) {
    return <span className="text-sm text-dashboard-muted">None</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {attention.map((item) => {
        const Icon = item === "Payment review" ? CircleAlert : Info;
        return (
          <Badge
            key={item}
            variant="outline"
            className={
              item === "Payment review"
                ? "reservation-status-pending gap-1"
                : "dashboard-event-fitting gap-1"
            }
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {item}
          </Badge>
        );
      })}
    </div>
  );
}

function AppointmentLoadingState() {
  return (
    <div className="p-4" role="status" aria-label="Loading fittings">
      <span className="sr-only">Loading fittings…</span>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="grid animate-pulse grid-cols-2 gap-3 rounded-lg border border-dashboard-border p-4 lg:grid-cols-6"
          >
            {Array.from({ length: 6 }).map((__, cellIndex) => (
              <div key={cellIndex} className="space-y-2">
                <div className="h-3 w-16 rounded bg-dashboard-active" />
                <div className="h-4 w-full max-w-28 rounded bg-dashboard-active" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AppointmentState({
  actionLabel,
  message,
  onAction,
  title,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent">
        <CalendarClock className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-dashboard-navy">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-dashboard-muted">{message}</p>
      {actionLabel && onAction ? (
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function FittingDetailsPreviewSheet({
  appointment,
  onOpenChange,
}: {
  appointment: FittingPrototypeAppointment | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(appointment)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {appointment ? (
          <>
            <header className="border-b border-dashboard-border px-6 py-5 pr-14">
              <SheetTitle>Fitting Details</SheetTitle>
              <SheetDescription className="mt-1">
                {appointment.customer.name} · {formatAppointmentDate(appointment.startsAt)} ·{" "}
                {formatAppointmentTimeRange(appointment)}
              </SheetDescription>
            </header>

            <div className="space-y-5 px-6 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={STATUS_CLASSES[appointment.status]}>
                  {appointment.status}
                </Badge>
                <Badge variant="outline" className={PAYMENT_CLASSES[appointment.paymentState]}>
                  {appointment.paymentState}
                </Badge>
              </div>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-dashboard-muted">
                  Customer
                </h3>
                <p className="mt-2 font-medium text-dashboard-navy">{appointment.customer.name}</p>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-dashboard-muted">
                  Garments
                </h3>
                <div className="mt-2 space-y-2">
                  {appointment.garments.map((garment) => (
                    <div key={garment.id} className="rounded-lg border border-dashboard-border p-3">
                      <p className="font-medium text-dashboard-navy">{garment.productName}</p>
                      <p className="mt-1 text-xs text-dashboard-muted">{garment.variantLabel}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-dashboard-muted">
                  Fee
                </h3>
                <p className="mt-2 font-medium text-dashboard-navy">
                  {appointment.feeMinor === null
                    ? "No fitting fee"
                    : formatPhpMoney(appointment.feeMinor)}
                </p>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
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

function formatAppointmentDate(value: string): string {
  return APPOINTMENT_DATE_FORMATTER.format(new Date(value));
}

function formatAppointmentTimeRange(appointment: FittingPrototypeAppointment): string {
  return `${APPOINTMENT_TIME_FORMATTER.format(new Date(appointment.startsAt))}–${APPOINTMENT_TIME_FORMATTER.format(new Date(appointment.endsAt))}`;
}

function formatPhpMoney(minor: number): string {
  return PHP_FORMATTER.format(minor / 100);
}
