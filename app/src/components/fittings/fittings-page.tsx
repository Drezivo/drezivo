"use client";

import { useAuth } from "@clerk/nextjs";
import {
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import type {
  DashboardFittingSummaryResponse,
  FittingDetail,
  FittingListItem,
  FittingSettings,
  FittingState,
} from "@drezivo/contracts";

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
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

import {
  FITTING_PAYMENT_CLASSES,
  FITTING_STATUS_CLASSES,
  FITTING_STATUS_LABELS,
  fittingGarmentModeLabel,
  fittingPaymentLabel,
  fittingVariantLabel,
  formatFittingDate,
  formatFittingMoney,
  formatFittingTimeRange,
} from "./fittings-presentation";
import { FittingDetailsSheet } from "./fitting-details-sheet";
import { NewFittingSheet } from "./new-fitting-sheet";

type FittingDateFilter = "all" | "today" | "upcoming";

type PageMeta = {
  next_cursor: string | null;
  has_more: boolean;
};

const STATUS_OPTIONS: readonly FittingState[] = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "rejected",
  "no_show",
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

const FITTINGS_PAGE_SIZE = 10;

export function FittingsPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [status, setStatus] = useState<FittingState | null>(null);
  const [dateFilter, setDateFilter] = useState<FittingDateFilter>("all");
  const [rows, setRows] = useState<FittingListItem[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>({ next_cursor: null, has_more: false });
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [settings, setSettings] = useState<FittingSettings | null>(null);
  const [summary, setSummary] = useState<DashboardFittingSummaryResponse | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<DrezivoApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [isNewFittingOpen, setIsNewFittingOpen] = useState(false);
  const [selectedFittingId, setSelectedFittingId] = useState<string | null>(null);
  const [selectedFitting, setSelectedFitting] = useState<FittingDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<DrezivoApiError | null>(null);
  const [detailReloadVersion, setDetailReloadVersion] = useState(0);

  const currentCursor = pageCursors[pageIndex] ?? null;
  const timeZone = settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const period = useMemo(() => fittingPeriodFilter(dateFilter, timeZone), [dateFilter, timeZone]);
  const hasActiveFilters = Boolean(deferredQuery || status || dateFilter !== "all");
  const permissionRestricted = error?.status === 403 || error?.code === "FORBIDDEN";

  const resetPagination = useCallback(() => {
    setPageIndex(0);
    setPageCursors([null]);
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    setIsSummaryLoading(true);
    const api = createDrezivoApiClient(getToken);

    void Promise.allSettled([api.getFittingSettings(), api.getFittingDashboardSummary()]).then(
      ([settingsResult, summaryResult]) => {
        if (cancelled) return;
        if (settingsResult.status === "fulfilled") setSettings(settingsResult.value.data);
        if (summaryResult.status === "fulfilled") setSummary(summaryResult.value.data);
        setIsSummaryLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, reloadVersion]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void createDrezivoApiClient(getToken)
      .getFittings({
        limit: FITTINGS_PAGE_SIZE,
        sort: "starts_at_asc",
        ...(currentCursor ? { cursor: currentCursor } : {}),
        ...(deferredQuery ? { search: deferredQuery } : {}),
        ...(status ? { status } : {}),
        ...(period ? { period_start: period.start, period_end: period.end } : {}),
      })
      .then((result) => {
        if (cancelled) return;
        setRows(result.data.items);
        setPageMeta(result.data.page_meta);
      })
      .catch((caughtError) => {
        if (cancelled) return;
        setRows([]);
        setPageMeta({ next_cursor: null, has_more: false });
        setError(toDrezivoApiError(caughtError));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentCursor, deferredQuery, getToken, isLoaded, isSignedIn, period, reloadVersion, status]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedFittingId) return;
    let cancelled = false;
    setIsDetailLoading(true);
    setDetailError(null);
    setSelectedFitting(null);

    void createDrezivoApiClient(getToken)
      .getFittingDetail(selectedFittingId)
      .then((result) => {
        if (!cancelled) setSelectedFitting(result.data);
      })
      .catch((caughtError) => {
        if (!cancelled) setDetailError(toDrezivoApiError(caughtError));
      })
      .finally(() => {
        if (!cancelled) setIsDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailReloadVersion, getToken, isLoaded, isSignedIn, selectedFittingId]);

  const refreshProductionState = useCallback((detail?: FittingDetail) => {
    if (detail) {
      setSelectedFittingId(detail.id);
      setSelectedFitting(detail);
      setDetailError(null);
    }
    setReloadVersion((value) => value + 1);
  }, []);

  const updateSearch = (value: string) => {
    setQuery(value);
    resetPagination();
  };

  const updateStatus = (value: FittingState | null) => {
    setStatus(value);
    resetPagination();
  };

  const updateDateFilter = (value: FittingDateFilter) => {
    setDateFilter(value);
    resetPagination();
  };

  const clearFilters = () => {
    setQuery("");
    setStatus(null);
    setDateFilter("all");
    resetPagination();
  };

  const goNext = () => {
    if (!pageMeta.has_more || !pageMeta.next_cursor) return;
    const nextCursor = pageMeta.next_cursor;
    setPageCursors((current) => {
      const next = current.slice(0, pageIndex + 1);
      next[pageIndex + 1] = nextCursor;
      return next;
    });
    setPageIndex((current) => current + 1);
  };

  const goPrevious = () => setPageIndex((current) => Math.max(0, current - 1));

  return (
    <div className="min-h-[calc(100svh-4.5rem)] overflow-x-hidden bg-dashboard-canvas px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <FittingsHeading
          canCreate={!permissionRestricted && settings?.enabled === true}
          onNewFitting={() => setIsNewFittingOpen(true)}
        />

        <SummarySection summary={summary} loading={isSummaryLoading} />

        <Card className="gap-0 overflow-visible py-0">
          <CardContent className="p-0">
            <FittingsToolbar
              query={query}
              status={status}
              dateFilter={dateFilter}
              hasActiveFilters={hasActiveFilters}
              onQueryChange={updateSearch}
              onStatusChange={updateStatus}
              onDateFilterChange={updateDateFilter}
              onClearFilters={clearFilters}
            />

            {isLoading ? (
              <AppointmentLoadingState />
            ) : error ? (
              <AppointmentState
                title={
                  permissionRestricted
                    ? "Fitting access is restricted"
                    : "Could not load fitting appointments"
                }
                message={
                  permissionRestricted
                    ? "Your current branch permissions do not allow fitting operations. Ask a workspace owner to update your access."
                    : error.message
                }
                requestId={error.requestId}
                {...(!permissionRestricted
                  ? {
                      actionLabel: "Try again",
                      onAction: () => setReloadVersion((value) => value + 1),
                    }
                  : {})}
              />
            ) : rows.length === 0 ? (
              <AppointmentState
                title={
                  hasActiveFilters
                    ? "No fittings match these filters"
                    : "No fitting appointments yet"
                }
                message={
                  hasActiveFilters
                    ? "Clear or adjust the search, status, or date filter to see other fittings."
                    : "Fittings created by staff will appear here."
                }
                {...(hasActiveFilters
                  ? { actionLabel: "Clear filters", onAction: clearFilters }
                  : {})}
              />
            ) : (
              <AppointmentList
                appointments={rows}
                timeZone={timeZone}
                onSelect={(appointment) => setSelectedFittingId(appointment.id)}
              />
            )}

            {!isLoading && !error && rows.length > 0 ? (
              <AppointmentsPagination
                currentPage={pageIndex + 1}
                loadedCount={rows.length}
                hasMore={pageMeta.has_more}
                hasPrevious={pageIndex > 0}
                onNext={goNext}
                onPrevious={goPrevious}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <NewFittingSheet
        open={isNewFittingOpen}
        settings={settings}
        onOpenChange={setIsNewFittingOpen}
        onCreated={(fitting) => {
          setIsNewFittingOpen(false);
          refreshProductionState(fitting);
        }}
      />

      <FittingDetailsSheet
        fittingId={selectedFittingId}
        fitting={selectedFitting}
        loading={isDetailLoading}
        error={detailError}
        timeZone={timeZone}
        getToken={getToken}
        onChanged={refreshProductionState}
        onRetry={() => setDetailReloadVersion((value) => value + 1)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedFittingId(null);
            setSelectedFitting(null);
            setDetailError(null);
          }
        }}
      />
    </div>
  );
}

function FittingsHeading({
  canCreate,
  onNewFitting,
}: {
  canCreate: boolean;
  onNewFitting: () => void;
}) {
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
          href="/fittings/schedule"
          className={cn(buttonVariants({ variant: "secondary" }), "w-full sm:w-auto")}
        >
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Schedule &amp; Availability
        </Link>
        <Button
          type="button"
          onClick={onNewFitting}
          disabled={!canCreate}
          className="w-full sm:w-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Fitting
        </Button>
      </div>
    </section>
  );
}

function SummarySection({
  summary,
  loading,
}: {
  summary: DashboardFittingSummaryResponse | null;
  loading: boolean;
}) {
  const values = {
    today: summary?.fittings_today ?? 0,
    upcoming: summary?.fittings_upcoming ?? 0,
    pending: summary?.fittings_pending_review ?? 0,
  };

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
                {loading ? (
                  <span className="mb-1 block h-5 w-8 animate-pulse rounded bg-dashboard-active" />
                ) : (
                  <span className="block text-xl font-semibold leading-none text-dashboard-navy">
                    {summary ? values[item.key] : "—"}
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
  onStatusChange: (value: FittingState | null) => void;
  query: string;
  status: FittingState | null;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-dashboard-border p-3 sm:p-4 xl:flex-row xl:items-end">
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
          value={status ? FITTING_STATUS_LABELS[status] : "All statuses"}
          options={[
            "All statuses",
            ...STATUS_OPTIONS.map((option) => FITTING_STATUS_LABELS[option]),
          ]}
          onSelect={(value) => {
            const next =
              STATUS_OPTIONS.find((option) => FITTING_STATUS_LABELS[option] === value) ?? null;
            onStatusChange(next);
          }}
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
  timeZone,
}: {
  appointments: readonly FittingListItem[];
  onSelect: (appointment: FittingListItem) => void;
  timeZone: string;
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
        {appointments.map((appointment) => {
          const paymentLabel = fittingPaymentLabel(appointment.fee);
          const attention = fittingAttentionLabels(appointment);
          const firstGarment = appointment.garments[0];
          return (
            <li key={appointment.id}>
              <button
                type="button"
                onClick={() => onSelect(appointment)}
                aria-label={`Open fitting for ${appointment.customer.full_name} on ${formatFittingDate(appointment.period.start, timeZone)}`}
                className="grid w-full grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-left transition-colors hover:bg-dashboard-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30 lg:grid-cols-[minmax(9rem,1fr)_minmax(10rem,1.1fr)_minmax(12rem,1.4fr)_minmax(9rem,1fr)_minmax(7.5rem,0.8fr)_minmax(9rem,1fr)] lg:items-start lg:gap-4"
              >
                <AppointmentCell label="Date & time" className="col-span-2 lg:col-span-1">
                  <p className="font-semibold text-dashboard-navy">
                    {formatFittingDate(appointment.period.start, timeZone)}
                  </p>
                  <p className="mt-1 text-xs text-dashboard-muted">
                    {formatFittingTimeRange(
                      appointment.period.start,
                      appointment.period.end,
                      timeZone
                    )}
                  </p>
                </AppointmentCell>

                <AppointmentCell label="Customer" className="col-span-2 lg:col-span-1">
                  <p className="font-medium text-dashboard-navy">
                    {appointment.customer.full_name}
                  </p>
                  <p className="mt-1 text-xs text-dashboard-muted">Fitting appointment</p>
                </AppointmentCell>

                <AppointmentCell label="Garments" className="col-span-2 lg:col-span-1">
                  {firstGarment ? (
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
                        <Shirt className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-dashboard-navy">
                          {firstGarment.variant.product_name}
                          {appointment.garments.length > 1
                            ? ` +${appointment.garments.length - 1} more`
                            : ""}
                        </span>
                        <span className="mt-1 block truncate text-xs text-dashboard-muted">
                          {fittingVariantLabel(firstGarment)}
                        </span>
                      </span>
                    </div>
                  ) : null}
                </AppointmentCell>

                <AppointmentCell label="Fee / payment" className="col-span-1">
                  <div className="space-y-1.5">
                    <p className="font-medium text-dashboard-navy">
                      {BigInt(appointment.fee.fee_minor) === 0n
                        ? "No fee"
                        : formatFittingMoney(appointment.fee.fee_minor, appointment.fee.currency)}
                    </p>
                    <Badge variant="outline" className={FITTING_PAYMENT_CLASSES[paymentLabel]}>
                      {paymentLabel}
                    </Badge>
                  </div>
                </AppointmentCell>

                <AppointmentCell label="Status" className="col-span-1">
                  <Badge variant="outline" className={FITTING_STATUS_CLASSES[appointment.status]}>
                    {FITTING_STATUS_LABELS[appointment.status]}
                  </Badge>
                </AppointmentCell>

                <AppointmentCell label="Attention" className="col-span-2 lg:col-span-1">
                  <AttentionSummary attention={attention} />
                </AppointmentCell>
              </button>
            </li>
          );
        })}
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

function AttentionSummary({ attention }: { attention: readonly string[] }) {
  if (attention.length === 0) return <span className="text-sm text-dashboard-muted">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {attention.map((item) => {
        const urgent = item === "Payment review" || item === "Outcome required";
        const Icon = urgent ? CircleAlert : Info;
        return (
          <Badge
            key={item}
            variant="outline"
            className={
              urgent ? "reservation-status-pending gap-1" : "dashboard-event-fitting gap-1"
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

function AppointmentsPagination({
  currentPage,
  hasMore,
  hasPrevious,
  loadedCount,
  onNext,
  onPrevious,
}: {
  currentPage: number;
  hasMore: boolean;
  hasPrevious: boolean;
  loadedCount: number;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <nav
      aria-label="Fittings pagination"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-dashboard-border px-3 py-3 text-sm text-dashboard-muted sm:px-4"
    >
      <span aria-live="polite">
        Page {currentPage} · {loadedCount} fittings loaded
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Previous page"
          disabled={!hasPrevious}
          onClick={onPrevious}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
        </Button>
        <span
          aria-label={`Page ${currentPage}`}
          aria-current="page"
          className="px-2 font-medium text-dashboard-navy"
        >
          {currentPage}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Next page"
          disabled={!hasMore}
          onClick={onNext}
        >
          Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
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
  requestId,
  title,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  requestId?: string | null;
  title: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent">
        <CalendarClock className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-dashboard-navy">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-dashboard-muted">{message}</p>
      {requestId ? (
        <p className="mt-2 text-xs text-dashboard-muted">Request ID: {requestId}</p>
      ) : null}
      {actionLabel && onAction ? (
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
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
            aria-label={`${label}: ${value}`}
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

function fittingAttentionLabels(appointment: FittingListItem): string[] {
  const values: string[] = [];
  if (appointment.attention === "outcome_required") values.push("Outcome required");
  if (fittingPaymentLabel(appointment.fee) === "Pending review") values.push("Payment review");
  if (appointment.garments.some((garment) => garment.garment_mode === "preference")) {
    values.push("Preference only");
  }
  return values;
}

function fittingPeriodFilter(
  filter: FittingDateFilter,
  timeZone: string
): { start: string; end: string } | null {
  if (filter === "all") return null;
  const today = todayInTimeZone(timeZone);
  const startDate = filter === "today" ? today : addCalendarDays(today, 1);
  const endDate = filter === "today" ? addCalendarDays(today, 1) : addCalendarDays(startDate, 31);
  return {
    start: zonedStartOfDay(startDate, timeZone).toISOString(),
    end: zonedStartOfDay(endDate, timeZone).toISOString(),
  };
}

function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

function zonedStartOfDay(dateValue: string, timeZone: string): Date {
  const parsed = parseCalendarDate(dateValue);
  if (!parsed) return new Date(Number.NaN);
  const wallTimeUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0);
  let instant = new Date(wallTimeUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = timeZoneOffsetMs(instant, timeZone);
    instant = new Date(wallTimeUtc - offset);
  }
  return instant;
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return (
    Date.UTC(
      Number(values["year"]),
      Number(values["month"]) - 1,
      Number(values["day"]),
      Number(values["hour"]),
      Number(values["minute"]),
      Number(values["second"])
    ) - instant.getTime()
  );
}

function addCalendarDays(dateValue: string, days: number): string {
  const parsed = parseCalendarDate(dateValue);
  if (!parsed) return dateValue;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseCalendarDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("The fitting request could not be completed. Please try again.", {
        status: 500,
      });
}
