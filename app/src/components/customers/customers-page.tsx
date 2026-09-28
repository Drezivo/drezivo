"use client";

import { useAuth } from "@clerk/nextjs";
import type {
  CustomerActivity,
  CustomerListItem,
  CustomerListStatus,
  CustomerSummaryResponse,
} from "@drezivo/contracts";
import {
  AlertCircle,
  CalendarCheck2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  MoreHorizontal,
  RefreshCw,
  Repeat2,
  Search,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

import { ArchiveCustomerDialog } from "./archive-customer-dialog";

type CustomerStatusFilter = CustomerListStatus;
type CustomerPageMeta = { next_cursor: string | null; has_more: boolean };

const CUSTOMERS_PAGE_SIZE = 10;

const CUSTOMER_STATUS_LABELS: Record<CustomerStatusFilter, string> = {
  active: "Active",
  archived: "Archived",
  all: "All customers",
};

const SUMMARY_ITEMS = [
  {
    key: "all_customers",
    label: "All Customers",
    icon: UsersRound,
    tone: "dashboard-tone-blue",
  },
  {
    key: "new_this_month",
    label: "New This Month",
    icon: UserPlus,
    tone: "dashboard-tone-mint",
  },
  {
    key: "returning_customers",
    label: "Returning Customers",
    icon: Repeat2,
    tone: "dashboard-tone-orange",
  },
  {
    key: "upcoming_customers",
    label: "Upcoming Customers",
    icon: CalendarCheck2,
    tone: "dashboard-tone-purple",
  },
] as const;

export function CustomersPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CustomerStatusFilter>("active");
  const deferredQuery = useDeferredValue(query.trim());
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [rows, setRows] = useState<CustomerListItem[]>([]);
  const [pageMeta, setPageMeta] = useState<CustomerPageMeta>({
    next_cursor: null,
    has_more: false,
  });
  const [summary, setSummary] = useState<CustomerSummaryResponse | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<DrezivoApiError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<DrezivoApiError | null>(null);
  const [summaryReloadVersion, setSummaryReloadVersion] = useState(0);
  const [directoryReloadVersion, setDirectoryReloadVersion] = useState(0);
  const [archiveCustomer, setArchiveCustomer] = useState<CustomerListItem | null>(null);
  const [archiveIntentKey, setArchiveIntentKey] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<DrezivoApiError | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const currentCursor = pageCursors[pageIndex] ?? null;
  const hasActiveFilters = Boolean(deferredQuery || status !== "active");
  const permissionRestricted = error?.status === 403 || error?.code === "FORBIDDEN";

  const resetPagination = useCallback(() => {
    setPageIndex(0);
    setPageCursors([null]);
  }, []);

  const retrySummary = useCallback(() => {
    setSummaryReloadVersion((value) => value + 1);
  }, []);

  const retryDirectory = useCallback(() => {
    setDirectoryReloadVersion((value) => value + 1);
  }, []);

  const requestArchive = useCallback((customer: CustomerListItem) => {
    setArchiveCustomer(customer);
    setArchiveIntentKey(crypto.randomUUID());
    setArchiveError(null);
  }, []);

  const closeArchive = useCallback(() => {
    if (isArchiving) return;
    setArchiveCustomer(null);
    setArchiveIntentKey(null);
    setArchiveError(null);
  }, [isArchiving]);

  const confirmArchive = useCallback(async () => {
    if (!archiveCustomer || isArchiving) return;
    setIsArchiving(true);
    setArchiveError(null);
    try {
      const client = createDrezivoApiClient(getToken);
      const detail = await client.getCustomerDetail(archiveCustomer.id);
      await client.archiveCustomer(
        archiveCustomer.id,
        { expected_updated_at: detail.data.updated_at },
        archiveIntentKey ?? crypto.randomUUID()
      );
      setArchiveCustomer(null);
      setArchiveIntentKey(null);
      setNotice(`${archiveCustomer.full_name} was archived.`);
      retryDirectory();
      retrySummary();
    } catch (caughtError) {
      setArchiveError(toDrezivoApiError(caughtError));
    } finally {
      setIsArchiving(false);
    }
  }, [archiveCustomer, archiveIntentKey, getToken, isArchiving, retryDirectory, retrySummary]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;

    setIsSummaryLoading(true);
    setSummaryError(null);

    void createDrezivoApiClient(getToken)
      .getCustomerSummary()
      .then((result) => {
        if (!cancelled) setSummary(result.data);
      })
      .catch((caughtError) => {
        if (cancelled) return;
        setSummary(null);
        setSummaryError(toDrezivoApiError(caughtError));
      })
      .finally(() => {
        if (!cancelled) setIsSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, summaryReloadVersion]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    void createDrezivoApiClient(getToken)
      .getCustomers({
        limit: CUSTOMERS_PAGE_SIZE,
        status,
        ...(currentCursor ? { cursor: currentCursor } : {}),
        ...(deferredQuery ? { search: deferredQuery } : {}),
      })
      .then((result) => {
        if (cancelled) return;
        if (result.data.items.length === 0 && pageIndex > 0) {
          setRows([]);
          setPageMeta({ next_cursor: null, has_more: false });
          setPageCursors((current) => current.slice(0, pageIndex));
          setPageIndex((current) => Math.max(0, current - 1));
          return;
        }
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
    deferredQuery,
    directoryReloadVersion,
    getToken,
    isLoaded,
    isSignedIn,
    status,
  ]);

  const updateQuery = (value: string) => {
    setQuery(value);
    resetPagination();
  };

  const updateStatus = (value: CustomerStatusFilter) => {
    setStatus(value);
    resetPagination();
  };

  const clearFilters = () => {
    setQuery("");
    setStatus("active");
    resetPagination();
  };

  const goNext = () => {
    const nextCursor = pageMeta.next_cursor;
    if (!nextCursor) return;
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
    <div className="min-h-[calc(100svh-4.5rem)] overflow-x-hidden bg-dashboard-canvas px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <section aria-labelledby="customers-heading">
          <h1 id="customers-heading" className="text-2xl font-bold tracking-tight text-dashboard-navy">
            Customers
          </h1>
          <p className="mt-1 text-sm text-dashboard-muted">
            View customer profiles and their reservation and fitting activity.
          </p>
        </section>

        <CustomerSummarySection
          error={summaryError}
          loading={isSummaryLoading}
          onRetry={retrySummary}
          summary={summary}
        />

        {notice ? (
          <div role="status" aria-live="polite" className="rounded-lg border border-dashboard-border bg-dashboard-surface px-4 py-3 text-sm text-dashboard-muted">
            {notice}
          </div>
        ) : null}

        <Card className="gap-0 overflow-visible py-0">
          <CardContent className="p-0">
            {permissionRestricted ? (
              <CustomerDirectoryState
                icon={LockKeyhole}
                title="Customer access restricted"
                description="You do not have permission to view the customer directory for this workspace."
                requestId={error?.requestId}
              />
            ) : error ? (
              <CustomerDirectoryState
                icon={AlertCircle}
                title="Customers could not be loaded"
                description={error.message}
                actionLabel="Try again"
                onAction={retryDirectory}
                requestId={error.requestId}
              />
            ) : (
              <>
                <CustomerToolbar
                  query={query}
                  status={status}
                  hasActiveFilters={hasActiveFilters}
                  onQueryChange={updateQuery}
                  onStatusChange={updateStatus}
                  onClearFilters={clearFilters}
                />
                {isLoading ? (
                  <CustomersTableLoading />
                ) : (
                  <CustomersTable
                    customers={rows}
                    emptyFiltered={hasActiveFilters}
                    onArchive={requestArchive}
                  />
                )}
                {!isLoading && rows.length > 0 ? (
                  <CustomerPagination
                    pageIndex={pageIndex}
                    shown={rows.length}
                    hasMore={pageMeta.has_more}
                    onNext={goNext}
                    onPrevious={goPrevious}
                  />
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ArchiveCustomerDialog
        customer={archiveCustomer}
        isSubmitting={isArchiving}
        mutationError={archiveError?.message ?? null}
        onArchive={confirmArchive}
        onOpenChange={(open) => {
          if (!open) closeArchive();
        }}
        requestId={archiveError ? archiveError.requestId : null}
      />
    </div>
  );
}

function CustomerSummarySection({
  error,
  loading,
  onRetry,
  summary,
}: {
  error: DrezivoApiError | null;
  loading: boolean;
  onRetry: () => void;
  summary: CustomerSummaryResponse | null;
}) {
  return (
    <>
      <section aria-label="Customer overview" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
                    <span
                      className="block h-5 w-10 animate-pulse rounded bg-dashboard-active"
                      aria-label={`Loading ${item.label}`}
                    />
                  ) : (
                    <span className="block text-xl font-semibold leading-none text-dashboard-navy">
                      {summary?.[item.key] ?? "—"}
                    </span>
                  )}
                  <span className="mt-1 block text-xs text-dashboard-muted">{item.label}</span>
                </span>
              </CardContent>
            </Card>
          );
        })}
      </section>
      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-dashboard-danger/30 bg-dashboard-danger/10 px-4 py-3 text-sm text-dashboard-danger sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p>{error.message}</p>
            {error.requestId ? <p className="mt-1 text-xs">Request ID: {error.requestId}</p> : null}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : null}
    </>
  );
}

function CustomerToolbar({
  hasActiveFilters,
  onClearFilters,
  onQueryChange,
  onStatusChange,
  query,
  status,
}: {
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: CustomerStatusFilter) => void;
  query: string;
  status: CustomerStatusFilter;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-dashboard-border p-3 sm:p-4 xl:flex-row xl:items-end">
      <label className="relative min-w-0 flex-1 xl:max-w-xl">
        <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Search customers</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-dashboard-muted"
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search name, phone, or email..."
          className="pl-9"
        />
      </label>

      <div className="min-w-0 sm:min-w-40">
        <span className="mb-1.5 block text-xs font-medium text-dashboard-muted">Status</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Status: ${CUSTOMER_STATUS_LABELS[status]}`}
              className="w-full justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active sm:min-w-40"
            >
              <span className="truncate">{CUSTOMER_STATUS_LABELS[status]}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {(Object.entries(CUSTOMER_STATUS_LABELS) as Array<[CustomerStatusFilter, string]>).map(
              ([value, label]) => (
                <DropdownMenuItem key={value} onSelect={() => onStatusChange(value)}>
                  {label}
                </DropdownMenuItem>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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

function CustomerDirectoryState({
  actionLabel,
  description,
  icon: Icon,
  onAction,
  requestId,
  title,
}: {
  actionLabel?: string;
  description: string;
  icon: typeof AlertCircle;
  onAction?: () => void;
  requestId?: string | null;
  title: string;
}) {
  return (
    <div className="px-4 py-14 text-center sm:px-6">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-muted">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-4 font-semibold text-dashboard-navy">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-dashboard-muted">{description}</p>
      {requestId ? <p className="mt-2 text-xs text-dashboard-muted">Request ID: {requestId}</p> : null}
      {actionLabel && onAction ? (
        <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={onAction}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function CustomerEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="font-semibold text-dashboard-navy">
        {filtered ? "No customers match these filters" : "No active customers yet"}
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-dashboard-muted">
        {filtered
          ? "Adjust the customer search or status filter to see other profiles."
          : "Customers will appear here after they are created through a reservation or fitting workflow."}
      </p>
    </div>
  );
}

function CustomersTableLoading() {
  return (
    <div aria-label="Loading customers" aria-busy="true">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_repeat(2,minmax(5rem,0.65fr))_minmax(6rem,0.8fr)] gap-4 border-b border-dashboard-border px-4 py-3">
        {[0, 1, 2, 3, 4].map((cell) => (
          <div key={cell} className="h-3 animate-pulse rounded bg-dashboard-active" />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_repeat(2,minmax(5rem,0.65fr))_minmax(6rem,0.8fr)] gap-4 border-b border-dashboard-border/70 px-4 py-4 last:border-b-0">
          {[0, 1, 2, 3, 4].map((cell) => (
            <div key={cell} className="h-4 animate-pulse rounded bg-dashboard-active" />
          ))}
        </div>
      ))}
    </div>
  );
}

function CustomersTable({
  customers,
  emptyFiltered,
  onArchive,
}: {
  customers: readonly CustomerListItem[];
  emptyFiltered: boolean;
  onArchive: (customer: CustomerListItem) => void;
}) {
  if (customers.length === 0) {
    return <CustomerEmptyState filtered={emptyFiltered} />;
  }

  return (
    <Table aria-label="Customers">
      <TableHeader>
        <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
          <TableHead className="pl-4">Customer</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead className="text-center">Reservations</TableHead>
          <TableHead className="text-center">Fittings</TableHead>
          <TableHead className="hidden lg:table-cell">Last Activity</TableHead>
          <TableHead className="hidden xl:table-cell">Next Activity</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="pr-4 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => (
          <TableRow key={customer.id}>
            <TableCell className="pl-4 align-top">
              <div className="flex items-start gap-3">
                <Avatar className="h-9 w-9 border border-dashboard-border">
                  <AvatarFallback className="bg-dashboard-active text-xs font-semibold text-dashboard-accent">
                    {initials(customer.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="max-w-52 truncate font-semibold text-dashboard-navy">
                    {customer.full_name}
                  </p>
                  <p className="mt-1 text-xs text-dashboard-muted">
                    Customer since {formatCustomerSince(customer.created_at)}
                  </p>
                </div>
              </div>
            </TableCell>
            <TableCell className="align-top">
              <div className="space-y-1">
                <p className="max-w-52 truncate font-medium text-dashboard-navy">
                  {customer.phone ?? "No phone"}
                </p>
                <p className="max-w-52 truncate text-xs text-dashboard-muted">
                  {customer.email ?? "No email"}
                </p>
              </div>
            </TableCell>
            <TableCell className="text-center align-top font-medium text-dashboard-navy">
              {customer.reservation_count}
            </TableCell>
            <TableCell className="text-center align-top font-medium text-dashboard-navy">
              {customer.fitting_count}
            </TableCell>
            <TableCell className="hidden align-top lg:table-cell">
              <ActivityCell activity={customer.last_activity} fallback="No activity yet" />
            </TableCell>
            <TableCell className="hidden align-top xl:table-cell">
              <ActivityCell activity={customer.next_activity} fallback="None scheduled" />
            </TableCell>
            <TableCell className="align-top">
              <Badge
                variant="outline"
                className={cn(
                  "font-medium",
                  customer.status === "active"
                    ? "dashboard-tone-mint border-transparent"
                    : "border-dashboard-border bg-dashboard-canvas text-dashboard-muted"
                )}
              >
                {customer.status === "active" ? "Active" : "Archived"}
              </Badge>
            </TableCell>
            <TableCell className="pr-4 text-right align-top">
              <CustomerActions customer={customer} onArchive={onArchive} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CustomerActions({
  customer,
  onArchive,
}: {
  customer: CustomerListItem;
  onArchive: (customer: CustomerListItem) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${customer.full_name}`}
          className="h-8 w-8"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled>View details</DropdownMenuItem>
        <DropdownMenuItem disabled>Edit</DropdownMenuItem>
        {customer.status === "active" ? (
          <DropdownMenuItem
            className="text-dashboard-danger focus:text-dashboard-danger"
            onSelect={() => onArchive(customer)}
          >
            Archive
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CustomerPagination({
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
        Page {pageIndex + 1} · {shown} {shown === 1 ? "customer" : "customers"} loaded
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous customers page"
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
          aria-label="Next customers page"
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

function ActivityCell({
  activity,
  fallback,
}: {
  activity: CustomerActivity | null;
  fallback: string;
}) {
  if (!activity) return <span className="text-xs text-dashboard-muted">{fallback}</span>;

  return (
    <div>
      <p className="font-medium capitalize text-dashboard-navy">{activity.type}</p>
      <p className="mt-1 text-xs text-dashboard-muted">{formatActivityDateTime(activity.at)}</p>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatCustomerSince(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatActivityDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("Could not load customers. Please try again.", { status: 503 });
}
