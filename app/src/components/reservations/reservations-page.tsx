"use client";

import { useAuth } from "@clerk/nextjs";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Shirt,
  UserRound,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import type {
  PermissionCode,
  ReservationDetail,
  ReservationListItem,
  ReservationState,
} from "@drezivo/contracts";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

import { NewReservationSheet } from "./new-reservation-sheet";
import { ReservationDetailsSheet } from "./reservation-details-sheet";
import {
  PAYMENT_EVIDENCE_LABELS,
  PAYMENT_STATUS_CLASSES,
  PAYMENT_STATUS_LABELS,
  RESERVATION_STATUS_CLASSES,
  RESERVATION_STATUS_FILTERS,
  RESERVATION_STATUS_LABELS,
} from "./reservations-data";

const PAGE_SIZE = 10;
const MAX_PICKUP_WINDOW_DAYS = 31;

type PageMeta = {
  next_cursor: string | null;
  has_more: boolean;
};

type DateRange = {
  from: string;
  to: string;
};

export function ReservationsPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const deferredQuery = useDeferredValue(query.trim());
  const [status, setStatus] = useState<ReservationState | null>(() =>
    parseReservationStatus(searchParams.get("status"))
  );
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: parseDate(searchParams.get("from")),
    to: parseDate(searchParams.get("to")),
  }));
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const [isTimeZoneResolved, setIsTimeZoneResolved] = useState(false);
  const [rows, setRows] = useState<ReservationListItem[]>([]);
  const [permissionCodes, setPermissionCodes] = useState<PermissionCode[]>([]);
  const [isNewReservationOpen, setIsNewReservationOpen] = useState(false);
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<ReservationDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<DrezivoApiError | null>(null);
  const [detailReloadVersion, setDetailReloadVersion] = useState(0);
  const [pageMeta, setPageMeta] = useState<PageMeta>({ next_cursor: null, has_more: false });
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<DrezivoApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const currentCursor = pageCursors[pageIndex] ?? null;
  const dateRangeError = validateDateRange(dateRange);
  const dateFilterTimeZoneReady = !dateRange.from && !dateRange.to ? true : isTimeZoneResolved;
  const dateQuery = useMemo(
    () => (dateRangeError ? null : toPickupInstantRange(dateRange, timeZone)),
    [dateRange, dateRangeError, timeZone]
  );
  const hasActiveFilters = Boolean(deferredQuery || status || dateRange.from || dateRange.to);
  const permissionRestricted = error?.status === 403 || error?.code === "FORBIDDEN";

  useEffect(() => {
    const params = new URLSearchParams();
    if (deferredQuery) params.set("q", deferredQuery);
    if (status) params.set("status", status);
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);

    const nextSearch = params.toString();
    if (nextSearch === searchParams.toString()) return;
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false });
  }, [dateRange.from, dateRange.to, deferredQuery, pathname, router, searchParams, status]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;

    void createDrezivoApiClient(getToken)
      .getActorContext()
      .then((result) => {
        if (cancelled) return;
        const activeBranch = result.data.branches.find(
          (branch) => branch.id === result.data.active_branch_id
        );
        const activeGrant = result.data.branch_grants.find(
          (grant) => grant.branch_id === result.data.active_branch_id
        );
        setTimeZone(activeBranch?.timezone ?? result.data.tenant.timezone);
        setPermissionCodes(activeGrant?.permission_codes ?? []);
      })
      .catch(() => {
        // The reservation request remains authoritative. A failed context refresh only means
        // date formatting falls back to the browser timezone for this render.
      })
      .finally(() => {
        if (!cancelled) setIsTimeZoneResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedReservationId) return;
    let cancelled = false;
    setIsDetailLoading(true);
    setDetailError(null);
    setSelectedReservation(null);

    void createDrezivoApiClient(getToken)
      .getReservationDetail(selectedReservationId)
      .then((result) => {
        if (!cancelled) setSelectedReservation(result.data);
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
  }, [detailReloadVersion, getToken, isLoaded, isSignedIn, selectedReservationId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || dateRangeError || !dateFilterTimeZoneReady) {
      if (dateRangeError) {
        setRows([]);
        setPageMeta({ next_cursor: null, has_more: false });
        setIsLoading(false);
      }
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void createDrezivoApiClient(getToken)
      .getReservations({
        limit: PAGE_SIZE,
        sort: "created_desc",
        ...(currentCursor ? { cursor: currentCursor } : {}),
        ...(deferredQuery ? { search: deferredQuery } : {}),
        ...(status ? { status } : {}),
        ...(dateQuery
          ? {
              pickup_start: dateQuery.start,
              pickup_end: dateQuery.end,
            }
          : {}),
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
  }, [
    currentCursor,
    dateQuery,
    dateRangeError,
    deferredQuery,
    getToken,
    isLoaded,
    isSignedIn,
    dateFilterTimeZoneReady,
    reloadVersion,
    status,
  ]);

  const resetPagination = useCallback(() => {
    setPageIndex(0);
    setPageCursors([null]);
  }, []);

  const updateSearch = (value: string) => {
    setQuery(value);
    resetPagination();
  };

  const updateStatus = (value: ReservationState | null) => {
    setStatus(value);
    resetPagination();
  };

  const updateDate = (field: keyof DateRange, value: string) => {
    setDateRange((current) => ({ ...current, [field]: value }));
    resetPagination();
  };

  const clearFilters = () => {
    setQuery("");
    setStatus(null);
    setDateRange({ from: "", to: "" });
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

  const goPrevious = () => {
    setPageIndex((current) => Math.max(0, current - 1));
  };

  return (
    <div className="min-h-[calc(100svh-4.5rem)] bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <PageHeading
          canCreate={permissionCodes.includes("reservations.manage")}
          onNewReservation={() => setIsNewReservationOpen(true)}
        />

        <Card className="gap-0 overflow-visible py-0">
          <CardContent className="p-0">
            <ReservationToolbar
              query={query}
              dateRange={dateRange}
              dateRangeError={dateRangeError}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
              onDateChange={updateDate}
              onQueryChange={updateSearch}
            />
            <ReservationStatusTabs activeStatus={status} onChange={updateStatus} />

            {isLoading ? (
              <ReservationListState
                title="Loading reservations…"
                message="Fetching the latest reservations for this workspace."
              />
            ) : dateRangeError ? (
              <ReservationListState
                title="Check the pickup date range"
                message={dateRangeError}
                actionLabel="Clear dates"
                onAction={() => {
                  setDateRange({ from: "", to: "" });
                  resetPagination();
                }}
              />
            ) : error ? (
              permissionRestricted ? (
                <ReservationListState
                  title="Reservation access is restricted"
                  message="Your current branch permissions do not allow reservation management. Ask a workspace owner to update your access."
                />
              ) : (
                <ReservationListState
                  title="Could not load reservations"
                  message={error.message}
                  requestId={error.requestId}
                  actionLabel="Try again"
                  onAction={() => setReloadVersion((value) => value + 1)}
                />
              )
            ) : rows.length === 0 ? (
              <ReservationListState
                title={
                  hasActiveFilters ? "No reservations match these filters" : "No reservations yet"
                }
                message={
                  hasActiveFilters
                    ? "Clear or adjust the search, status, or pickup dates to see other reservations."
                    : "Reservations created by staff or the storefront will appear here."
                }
                {...(hasActiveFilters
                  ? { actionLabel: "Clear filters", onAction: clearFilters }
                  : {})}
              />
            ) : (
              <ReservationTable
                reservations={rows}
                timeZone={timeZone}
                onSelect={setSelectedReservationId}
              />
            )}

            {!isLoading && !error && !dateRangeError && rows.length > 0 ? (
              <ReservationPagination
                pageIndex={pageIndex}
                shown={rows.length}
                hasMore={pageMeta.has_more}
                onNext={goNext}
                onPrevious={goPrevious}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <NewReservationSheet
        open={isNewReservationOpen}
        permissionCodes={permissionCodes}
        timeZone={timeZone}
        onOpenChange={setIsNewReservationOpen}
        onReservationChanged={() => setReloadVersion((value) => value + 1)}
        onViewReservation={(reservationId) => {
          setReloadVersion((value) => value + 1);
          setSelectedReservationId(reservationId);
          setDetailReloadVersion((value) => value + 1);
        }}
      />

      <ReservationDetailsSheet
        reservationId={selectedReservationId}
        detail={selectedReservation}
        error={detailError}
        isLoading={isDetailLoading}
        permissionCodes={permissionCodes}
        timeZone={timeZone}
        onRetry={() => setDetailReloadVersion((value) => value + 1)}
        onMutationSuccess={() => {
          setReloadVersion((value) => value + 1);
          setDetailReloadVersion((value) => value + 1);
        }}
        onRefreshRequired={() => {
          setReloadVersion((value) => value + 1);
          setDetailReloadVersion((value) => value + 1);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedReservationId(null);
            setSelectedReservation(null);
            setDetailError(null);
          }
        }}
      />
    </div>
  );
}

function PageHeading({
  canCreate,
  onNewReservation,
}: {
  canCreate: boolean;
  onNewReservation: () => void;
}) {
  return (
    <section
      aria-labelledby="reservations-heading"
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <h1
          id="reservations-heading"
          className="text-2xl font-bold tracking-tight text-dashboard-navy"
        >
          Reservations
        </h1>
        <p className="mt-1 text-sm text-dashboard-muted">
          Manage customer bookings and follow each rental through its operational lifecycle.
        </p>
      </div>
      {canCreate ? (
        <Button type="button" onClick={onNewReservation} className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Reservation
        </Button>
      ) : null}
    </section>
  );
}

function ReservationToolbar({
  dateRange,
  dateRangeError,
  hasActiveFilters,
  onClearFilters,
  onDateChange,
  onQueryChange,
  query,
}: {
  dateRange: DateRange;
  dateRangeError: string | null;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onDateChange: (field: keyof DateRange, value: string) => void;
  onQueryChange: (value: string) => void;
  query: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-dashboard-border p-4 xl:flex-row xl:items-end">
      <label className="relative min-w-0 flex-1 xl:max-w-xl">
        <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
          Search reservations
        </span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-dashboard-muted"
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Reference, customer, contact, or clothing..."
          className="pl-9"
        />
      </label>

      <div className="grid gap-2 sm:grid-cols-2 xl:w-auto">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Pickup from</span>
          <DatePickerField
            ariaLabel="Pickup from"
            value={dateRange.from}
            placeholder="Select start date"
            invalid={Boolean(dateRangeError)}
            onChange={(value) => onDateChange("from", value)}
          />
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">
            Pickup through
          </span>
          <DatePickerField
            ariaLabel="Pickup through"
            value={dateRange.to}
            placeholder="Select end date"
            invalid={Boolean(dateRangeError)}
            onChange={(value) => onDateChange("to", value)}
          />
        </div>
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

function ReservationStatusTabs({
  activeStatus,
  onChange,
}: {
  activeStatus: ReservationState | null;
  onChange: (status: ReservationState | null) => void;
}) {
  return (
    <div className="border-b border-dashboard-border px-4 py-3">
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Reservation status"
      >
        {RESERVATION_STATUS_FILTERS.map((option) => {
          const selected = activeStatus === option.value;
          return (
            <button
              key={option.label}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30",
                selected
                  ? "border-dashboard-accent bg-dashboard-active text-dashboard-accent"
                  : "border-dashboard-border bg-dashboard-surface text-dashboard-muted hover:bg-dashboard-active hover:text-dashboard-navy"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReservationTable({
  onSelect,
  reservations,
  timeZone,
}: {
  onSelect: (reservationId: string) => void;
  reservations: readonly ReservationListItem[];
  timeZone: string;
}) {
  return (
    <Table aria-label="Reservations">
      <TableHeader>
        <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
          <TableHead className="pl-4">Reservation</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Clothing</TableHead>
          <TableHead className="hidden md:table-cell">Pickup</TableHead>
          <TableHead className="hidden lg:table-cell">Return</TableHead>
          <TableHead className="hidden lg:table-cell">Fulfillment</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead className="pr-4">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reservations.map((reservation) => (
          <TableRow
            key={reservation.id}
            role="button"
            tabIndex={0}
            aria-label={`Open reservation ${reservation.reference_code}`}
            onClick={() => onSelect(reservation.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(reservation.id);
              }
            }}
            className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30"
          >
            <TableCell className="pl-4 align-top">
              <p className="font-semibold text-dashboard-navy">{reservation.reference_code}</p>
              <p className="mt-1 text-xs text-dashboard-muted">
                Created {formatDateTime(reservation.created_at, timeZone)}
              </p>
            </TableCell>
            <TableCell className="align-top">
              <CustomerCell reservation={reservation} />
            </TableCell>
            <TableCell className="align-top">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
                  <Shirt className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="max-w-52 truncate font-medium text-dashboard-navy">
                    {reservation.line.name_snapshot}
                  </p>
                  <p className="mt-1 text-xs text-dashboard-muted">
                    {formatMinorMoney(reservation.line.rental_minor, reservation.line.currency)}{" "}
                    rental
                  </p>
                  <p className="mt-1 text-xs text-dashboard-muted md:hidden">
                    Pickup {formatDateTime(reservation.pickup_at, timeZone)}
                  </p>
                </div>
              </div>
            </TableCell>
            <TableCell className="hidden align-top md:table-cell">
              <DateCell value={reservation.pickup_at} timeZone={timeZone} />
            </TableCell>
            <TableCell className="hidden align-top lg:table-cell">
              <DateCell value={reservation.due_at} timeZone={timeZone} />
            </TableCell>
            <TableCell className="hidden align-top capitalize text-dashboard-muted lg:table-cell">
              {reservation.fulfillment_method === "pickup" ? "Pickup" : "Delivery"}
            </TableCell>
            <TableCell className="align-top">
              <PaymentCell reservation={reservation} />
            </TableCell>
            <TableCell className="pr-4 align-top">
              <StatusBadge
                label={RESERVATION_STATUS_LABELS[reservation.status]}
                className={RESERVATION_STATUS_CLASSES[reservation.status]}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CustomerCell({ reservation }: { reservation: ReservationListItem }) {
  const customer = reservation.customer.snapshot;
  if (!customer) {
    return (
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashboard-border bg-dashboard-active text-dashboard-muted">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="font-medium text-dashboard-navy">Customer not added yet</p>
          <p className="mt-1 text-xs text-dashboard-muted">Short staff hold</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-8 w-8 border border-dashboard-border">
        <AvatarFallback className="bg-dashboard-active text-xs font-semibold text-dashboard-accent">
          {initials(customer.full_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="max-w-48 truncate font-semibold text-dashboard-navy">{customer.full_name}</p>
        <p className="mt-1 max-w-48 truncate text-xs text-dashboard-muted">
          {customer.phone ?? customer.email ?? "Contact unavailable"}
        </p>
      </div>
    </div>
  );
}

function PaymentCell({ reservation }: { reservation: ReservationListItem }) {
  const payment = reservation.payment;
  if (!payment) {
    return <span className="text-xs text-dashboard-muted">No payment yet</span>;
  }

  return (
    <div className="space-y-1">
      <StatusBadge
        label={PAYMENT_STATUS_LABELS[payment.status]}
        className={PAYMENT_STATUS_CLASSES[payment.status]}
      />
      <p className="text-xs text-dashboard-muted">
        {PAYMENT_EVIDENCE_LABELS[payment.evidence_status]}
      </p>
      <p className="text-xs font-medium text-dashboard-navy">
        {formatMinorMoney(payment.amount_minor, payment.currency)}
      </p>
    </div>
  );
}

function DateCell({ value, timeZone }: { value: string; timeZone: string }) {
  const date = new Date(value);
  return (
    <div>
      <p className="font-medium text-dashboard-navy">
        {new Intl.DateTimeFormat("en-PH", {
          day: "numeric",
          month: "short",
          timeZone,
          year: "numeric",
        }).format(date)}
      </p>
      <p className="mt-1 text-xs text-dashboard-muted">
        {new Intl.DateTimeFormat("en-PH", {
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        }).format(date)}
      </p>
    </div>
  );
}

function ReservationPagination({
  hasMore,
  onNext,
  onPrevious,
  pageIndex,
  shown,
}: {
  hasMore: boolean;
  onNext: () => void;
  onPrevious: () => void;
  pageIndex: number;
  shown: number;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-dashboard-border px-4 py-3 text-xs text-dashboard-muted sm:flex-row sm:items-center sm:justify-between">
      <p>
        Page {pageIndex + 1} · {shown} {shown === 1 ? "reservation" : "reservations"} loaded
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous reservations page"
          disabled={pageIndex === 0}
          onClick={onPrevious}
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="min-w-8 px-2 text-center font-medium text-dashboard-navy">
          {pageIndex + 1}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next reservations page"
          disabled={!hasMore}
          onClick={onNext}
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function ReservationListState({
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
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent">
        <CalendarDays className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="max-w-md">
        <p className="font-semibold text-dashboard-navy">{title}</p>
        <p className="mt-1 text-sm text-dashboard-muted">{message}</p>
        {requestId ? (
          <p className="mt-2 text-xs text-dashboard-muted">Request ID: {requestId}</p>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <Button type="button" variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function StatusBadge({ className, label }: { className: string; label: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap px-2 py-1 text-xs", className)}>
      {label}
    </Badge>
  );
}

function parseReservationStatus(value: string | null): ReservationState | null {
  return RESERVATION_STATUS_FILTERS.some((option) => option.value === value)
    ? (value as ReservationState)
    : null;
}

function parseDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function validateDateRange(range: DateRange): string | null {
  if (!range.from && !range.to) return null;
  if (!range.from || !range.to) return "Choose both the start and end pickup dates.";

  const start = parseCalendarDate(range.from);
  const end = parseCalendarDate(range.to);
  if (!start || !end) return "Choose valid pickup dates.";
  if (end.epochDay < start.epochDay)
    return "The end pickup date must be on or after the start date.";

  const inclusiveDays = end.epochDay - start.epochDay + 1;
  if (inclusiveDays > MAX_PICKUP_WINDOW_DAYS) {
    return `Pickup date filters can cover at most ${MAX_PICKUP_WINDOW_DAYS} days.`;
  }
  return null;
}

function toPickupInstantRange(
  range: DateRange,
  timeZone: string
): { start: string; end: string } | null {
  if (!range.from || !range.to) return null;
  return {
    start: zonedStartOfDay(range.from, timeZone).toISOString(),
    end: zonedStartOfDay(addCalendarDays(range.to, 1), timeZone).toISOString(),
  };
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

function parseCalendarDate(value: string): {
  year: number;
  month: number;
  day: number;
  epochDay: number;
} | null {
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
  return { year, month, day, epochDay: Math.floor(timestamp / 86_400_000) };
}

function formatDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    year: "numeric",
  }).format(new Date(value));
}

function formatMinorMoney(value: string, currency: string): string {
  return new Intl.NumberFormat("en-PH", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(Number(value) / 100);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("Could not load reservations. Please try again.", { status: 503 });
}
