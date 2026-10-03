"use client";

import { useAuth } from "@clerk/nextjs";
import type {
  CustomerDetailResponse,
  CustomerFittingHistoryItem,
  CustomerListItem,
  CustomerListStatus,
  CustomerReservationHistoryItem,
  CustomerSummaryResponse,
} from "@drezivo/contracts";
import {
  AlertCircle,
  CalendarCheck2,
  ChevronDown,
  LockKeyhole,
  MoreHorizontal,
  RefreshCw,
  Repeat2,
  Search,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { ListPagination } from "@/components/ui/list-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { useSubmitGuard } from "@/lib/use-submit-guard";

import { ArchiveCustomerDialog } from "./archive-customer-dialog";
import { CustomerDetailsSheet } from "./customer-details-sheet";
import { CustomerEditSheet, type CustomerEditValues } from "./customer-edit-sheet";

type CustomerStatusFilter = CustomerListStatus;
type CustomerPageMeta = { next_cursor: string | null; has_more: boolean };

const CUSTOMERS_PAGE_SIZE = 10;
const CUSTOMER_HISTORY_PAGE_SIZE = 10;

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
  const debouncedQuery = useDebouncedValue(query.trim());
  const isSearchPending = query.trim() !== debouncedQuery;
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
  const [archiveError, setArchiveError] = useState<DrezivoApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<DrezivoApiError | null>(null);
  const [detailReloadVersion, setDetailReloadVersion] = useState(0);
  const [reservationHistory, setReservationHistory] = useState<CustomerReservationHistoryItem[]>([]);
  const [reservationMeta, setReservationMeta] = useState<CustomerPageMeta>({ next_cursor: null, has_more: false });
  const [reservationCursors, setReservationCursors] = useState<Array<string | null>>([null]);
  const [reservationPageIndex, setReservationPageIndex] = useState(0);
  const [reservationLoading, setReservationLoading] = useState(false);
  const [reservationError, setReservationError] = useState<DrezivoApiError | null>(null);
  const [reservationReloadVersion, setReservationReloadVersion] = useState(0);
  const [fittingHistory, setFittingHistory] = useState<CustomerFittingHistoryItem[]>([]);
  const [fittingMeta, setFittingMeta] = useState<CustomerPageMeta>({ next_cursor: null, has_more: false });
  const [fittingCursors, setFittingCursors] = useState<Array<string | null>>([null]);
  const [fittingPageIndex, setFittingPageIndex] = useState(0);
  const [fittingLoading, setFittingLoading] = useState(false);
  const [fittingError, setFittingError] = useState<DrezivoApiError | null>(null);
  const [fittingReloadVersion, setFittingReloadVersion] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<DrezivoApiError | null>(null);
  const { isSubmitting: isArchiving, resetIntent: resetArchiveIntent, submit: submitArchive } = useSubmitGuard();
  const { isSubmitting: isSaving, resetIntent: resetEditIntent, submit: submitEdit } = useSubmitGuard();
  const currentCursor = pageCursors[pageIndex] ?? null;
  const reservationCursor = reservationCursors[reservationPageIndex] ?? null;
  const fittingCursor = fittingCursors[fittingPageIndex] ?? null;
  const hasActiveFilters = Boolean(query.trim() || status !== "active");
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
    resetArchiveIntent();
    setArchiveError(null);
  }, [resetArchiveIntent]);

  const openCustomerDetails = useCallback((customer: CustomerListItem, edit = false) => {
    setSelectedCustomerId(customer.id);
    setSelectedCustomer(null);
    setIsEditing(edit);
    setEditError(null);
    resetEditIntent();
    setDetailError(null);
    setReservationHistory([]);
    setReservationMeta({ next_cursor: null, has_more: false });
    setReservationCursors([null]);
    setReservationPageIndex(0);
    setReservationError(null);
    setFittingHistory([]);
    setFittingMeta({ next_cursor: null, has_more: false });
    setFittingCursors([null]);
    setFittingPageIndex(0);
    setFittingError(null);
  }, [resetEditIntent]);

  const beginCustomerEdit = useCallback(() => {
    if (!selectedCustomer) return;
    setEditError(null);
    resetEditIntent();
    setIsEditing(true);
  }, [resetEditIntent, selectedCustomer]);

  const cancelCustomerEdit = useCallback(() => {
    if (isSaving) return;
    setEditError(null);
    resetEditIntent();
    setIsEditing(false);
  }, [isSaving, resetEditIntent]);

  const refreshCustomerForEdit = useCallback(() => {
    setEditError(null);
    resetEditIntent();
    setDetailReloadVersion((value) => value + 1);
  }, [resetEditIntent]);

  const handleEditValuesChange = useCallback(() => {
    setEditError(null);
    resetEditIntent();
  }, [resetEditIntent]);

  const closeCustomerDetails = useCallback(() => {
    setSelectedCustomerId(null);
    setSelectedCustomer(null);
    setIsEditing(false);
    setEditError(null);
    resetEditIntent();
    setDetailError(null);
    setReservationHistory([]);
    setFittingHistory([]);
  }, [resetEditIntent]);

  const closeArchive = useCallback(() => {
    if (isArchiving) return;
    setArchiveCustomer(null);
    resetArchiveIntent();
    setArchiveError(null);
  }, [isArchiving, resetArchiveIntent]);

  const confirmArchive = useCallback(async () => {
    if (!archiveCustomer || isArchiving) return;
    setArchiveError(null);
    try {
      const result = await submitArchive(async (idempotencyKey) => {
        const client = createDrezivoApiClient(getToken);
        const detail = await client.getCustomerDetail(archiveCustomer.id);
        return client.archiveCustomer(
          archiveCustomer.id,
          { expected_updated_at: detail.data.updated_at },
          idempotencyKey
        );
      });
      if (!result) return;
      if (selectedCustomerId === archiveCustomer.id) closeCustomerDetails();
      setArchiveCustomer(null);
      resetArchiveIntent();
      setNotice(`${archiveCustomer.full_name} was archived.`);
      retryDirectory();
      retrySummary();
    } catch (caughtError) {
      setArchiveError(toDrezivoApiError(caughtError, "Could not archive this customer. Please try again."));
    }
  }, [archiveCustomer, closeCustomerDetails, getToken, isArchiving, resetArchiveIntent, retryDirectory, retrySummary, selectedCustomerId, submitArchive]);

  const saveCustomer = useCallback(async (values: CustomerEditValues) => {
    if (!selectedCustomer || isSaving) return;
    setEditError(null);

    const input = {
      full_name: values.full_name.trim(),
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      address: values.address.trim() || null,
      social_media: values.social_media.trim() || null,
      notes: values.notes.trim() || null,
      expected_updated_at: selectedCustomer.updated_at,
    };

    try {
      const result = await submitEdit((idempotencyKey) =>
        createDrezivoApiClient(getToken).updateCustomer(selectedCustomer.id, input, idempotencyKey)
      );
      if (!result) return;
      resetEditIntent();
      setSelectedCustomer(result.data.customer);
      setEditError(null);
      setIsEditing(false);
      retryDirectory();
      setNotice(`${result.data.customer.full_name} was updated.`);
    } catch (caughtError) {
      setEditError(toDrezivoApiError(caughtError, "Could not update this customer. Please try again."));
    }
  }, [getToken, isSaving, resetEditIntent, retryDirectory, selectedCustomer, submitEdit]);

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
    if (!isLoaded || !isSignedIn || !selectedCustomerId) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void createDrezivoApiClient(getToken)
      .getCustomerDetail(selectedCustomerId)
      .then((result) => { if (!cancelled) setSelectedCustomer(result.data); })
      .catch((caughtError) => { if (!cancelled) setDetailError(toDrezivoApiError(caughtError)); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [detailReloadVersion, getToken, isLoaded, isSignedIn, selectedCustomerId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedCustomerId || isEditing) return;
    let cancelled = false;
    setReservationLoading(true);
    setReservationError(null);
    void createDrezivoApiClient(getToken)
      .getCustomerReservations(selectedCustomerId, { limit: CUSTOMER_HISTORY_PAGE_SIZE, ...(reservationCursor ? { cursor: reservationCursor } : {}) })
      .then((result) => { if (!cancelled) { setReservationHistory(result.data.items); setReservationMeta(result.data.page_meta); } })
      .catch((caughtError) => { if (!cancelled) { setReservationHistory([]); setReservationMeta({ next_cursor: null, has_more: false }); setReservationError(toDrezivoApiError(caughtError)); } })
      .finally(() => { if (!cancelled) setReservationLoading(false); });
    return () => { cancelled = true; };
  }, [getToken, isEditing, isLoaded, isSignedIn, reservationCursor, reservationReloadVersion, selectedCustomerId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedCustomerId || isEditing) return;
    let cancelled = false;
    setFittingLoading(true);
    setFittingError(null);
    void createDrezivoApiClient(getToken)
      .getCustomerFittings(selectedCustomerId, { limit: CUSTOMER_HISTORY_PAGE_SIZE, ...(fittingCursor ? { cursor: fittingCursor } : {}) })
      .then((result) => { if (!cancelled) { setFittingHistory(result.data.items); setFittingMeta(result.data.page_meta); } })
      .catch((caughtError) => { if (!cancelled) { setFittingHistory([]); setFittingMeta({ next_cursor: null, has_more: false }); setFittingError(toDrezivoApiError(caughtError)); } })
      .finally(() => { if (!cancelled) setFittingLoading(false); });
    return () => { cancelled = true; };
  }, [fittingCursor, fittingReloadVersion, getToken, isEditing, isLoaded, isSignedIn, selectedCustomerId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (isSearchPending) {
      setIsLoading(true);
      return;
    }
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    void createDrezivoApiClient(getToken)
      .getCustomers({
        limit: CUSTOMERS_PAGE_SIZE,
        status,
        ...(currentCursor ? { cursor: currentCursor } : {}),
        ...(debouncedQuery ? { search: debouncedQuery } : {}),
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
    debouncedQuery,
    directoryReloadVersion,
    getToken,
    isLoaded,
    isSearchPending,
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

  const goHistoryNext = (kind: "reservation" | "fitting") => {
    if (kind === "reservation") {
      if (!reservationMeta.has_more || !reservationMeta.next_cursor) return;
      setReservationCursors((current) => [...current.slice(0, reservationPageIndex + 1), reservationMeta.next_cursor]);
      setReservationPageIndex((current) => current + 1);
    } else {
      if (!fittingMeta.has_more || !fittingMeta.next_cursor) return;
      setFittingCursors((current) => [...current.slice(0, fittingPageIndex + 1), fittingMeta.next_cursor]);
      setFittingPageIndex((current) => current + 1);
    }
  };

  const goHistoryPrevious = (kind: "reservation" | "fitting") => {
    if (kind === "reservation") setReservationPageIndex((current) => Math.max(0, current - 1));
    else setFittingPageIndex((current) => Math.max(0, current - 1));
  };

  return (
    <div className="min-h-[calc(100svh-4.5rem)] overflow-x-hidden bg-dashboard-canvas px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <section aria-labelledby="customers-heading">
          <h1 id="customers-heading" className="dashboard-page-title">
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
                    onEdit={(customer) => openCustomerDetails(customer, true)}
                    onView={openCustomerDetails}
                  />
                )}
                {!isLoading && rows.length > 0 ? (
                  <ListPagination
                    label="Customers pagination"
                    noun={{ one: "customer", other: "customers" }}
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
        mutationError={archiveError ? archiveErrorMessage(archiveError) : null}
        onArchive={confirmArchive}
        onOpenChange={(open) => {
          if (!open) closeArchive();
        }}
        requestId={archiveError ? archiveError.requestId : null}
      />

      <CustomerDetailsSheet
        open={selectedCustomerId !== null && !isEditing}
        detail={selectedCustomer}
        detailLoading={detailLoading}
        detailError={detailError}
        onRetryDetail={() => setDetailReloadVersion((value) => value + 1)}
        onEdit={beginCustomerEdit}
        onOpenChange={(open) => { if (!open) closeCustomerDetails(); }}
        reservationHistory={reservationHistory}
        reservationLoading={reservationLoading}
        reservationError={reservationError}
        reservationMeta={reservationMeta}
        onReservationRetry={() => setReservationReloadVersion((value) => value + 1)}
        onReservationNext={() => goHistoryNext("reservation")}
        onReservationPrevious={() => goHistoryPrevious("reservation")}
        reservationPageIndex={reservationPageIndex}
        fittingHistory={fittingHistory}
        fittingLoading={fittingLoading}
        fittingError={fittingError}
        fittingMeta={fittingMeta}
        onFittingRetry={() => setFittingReloadVersion((value) => value + 1)}
        onFittingNext={() => goHistoryNext("fitting")}
        onFittingPrevious={() => goHistoryPrevious("fitting")}
        fittingPageIndex={fittingPageIndex}
      />

      <CustomerEditSheet
        open={selectedCustomerId !== null && isEditing}
        customer={selectedCustomer}
        detailLoading={detailLoading}
        detailError={detailError}
        error={editError}
        isSubmitting={isSaving}
        onCancel={cancelCustomerEdit}
        onOpenChange={(open) => { if (!open) closeCustomerDetails(); }}
        onRefresh={refreshCustomerForEdit}
        onRetryDetail={refreshCustomerForEdit}
        onSave={saveCustomer}
        onValuesChange={handleEditValuesChange}
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
      <section aria-label="Customer overview" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
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
                    <span className="block text-ws-kpi font-semibold tabular-nums tracking-tight leading-none text-dashboard-navy">
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
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_repeat(2,minmax(5rem,0.65fr))_minmax(6rem,0.8fr)_minmax(4rem,0.5fr)] gap-4 border-b border-dashboard-border px-4 py-3">
        {[0, 1, 2, 3, 4, 5].map((cell) => (
          <div key={cell} className="h-3 animate-pulse rounded bg-dashboard-active" />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_repeat(2,minmax(5rem,0.65fr))_minmax(6rem,0.8fr)_minmax(4rem,0.5fr)] gap-4 border-b border-dashboard-border/70 px-4 py-4 last:border-b-0">
          {[0, 1, 2, 3, 4, 5].map((cell) => (
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
  onEdit,
  onView,
}: {
  customers: readonly CustomerListItem[];
  emptyFiltered: boolean;
  onArchive: (customer: CustomerListItem) => void;
  onEdit: (customer: CustomerListItem) => void;
  onView: (customer: CustomerListItem) => void;
}) {
  if (customers.length === 0) {
    return <CustomerEmptyState filtered={emptyFiltered} />;
  }

  return (
    <>
      {/* Phones: one card per customer, so every field stays reachable without sideways scrolling. */}
      <ul aria-label="Customers" className="divide-y divide-dashboard-border sm:hidden">
        {customers.map((customer) => (
          <li key={customer.id} className="flex items-start gap-3 px-4 py-4">
            <button
              type="button"
              onClick={() => onView(customer)}
              className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40"
            >
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-dashboard-navy">{customer.full_name}</span>
                <CustomerStatusBadge status={customer.status} />
              </span>
              <span className="mt-1 block truncate text-sm text-dashboard-muted">
                {[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact details"}
              </span>
              <span className="mt-2 flex gap-4 text-xs text-dashboard-muted">
                <span>
                  <span className="font-medium text-dashboard-navy">{customer.reservation_count}</span>{" "}
                  {customer.reservation_count === 1 ? "reservation" : "reservations"}
                </span>
                <span>
                  <span className="font-medium text-dashboard-navy">{customer.fitting_count}</span>{" "}
                  {customer.fitting_count === 1 ? "fitting" : "fittings"}
                </span>
              </span>
            </button>
            <CustomerActions customer={customer} onArchive={onArchive} onEdit={onEdit} onView={onView} />
          </li>
        ))}
      </ul>

      <Table aria-label="Customers" className="hidden sm:table">
        <TableHeader>
          <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
            <TableHead className="pl-4">Customer</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead className="text-center">Reservations</TableHead>
            <TableHead className="text-center">Fittings</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((customer) => (
            // The whole row opens details for pointer users; the name button is the keyboard path.
            <TableRow
              key={customer.id}
              onClick={() => onView(customer)}
              className="cursor-pointer hover:bg-dashboard-active/60"
            >
              <TableCell className="pl-4 align-top">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onView(customer);
                    }}
                    className="max-w-52 truncate rounded-sm text-left font-medium text-dashboard-navy hover:text-dashboard-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40"
                  >
                    {customer.full_name}
                  </button>
                  <p className="mt-1 text-xs text-dashboard-muted">
                    Customer since {formatCustomerSince(customer.created_at)}
                  </p>
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
              <TableCell className="align-top">
                <CustomerStatusBadge status={customer.status} />
              </TableCell>
              {/* Clicks inside the actions menu must not also open the details sheet. */}
              <TableCell className="pr-4 text-right align-top" onClick={(event) => event.stopPropagation()}>
                <CustomerActions customer={customer} onArchive={onArchive} onEdit={onEdit} onView={onView} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function CustomerStatusBadge({ status }: { status: CustomerListItem["status"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 font-medium",
        status === "active"
          ? "dashboard-tone-mint border-transparent"
          : "border-dashboard-border bg-dashboard-canvas text-dashboard-muted"
      )}
    >
      {status === "active" ? "Active" : "Archived"}
    </Badge>
  );
}

function CustomerActions({
  customer,
  onArchive,
  onEdit,
  onView,
}: {
  customer: CustomerListItem;
  onArchive: (customer: CustomerListItem) => void;
  onEdit: (customer: CustomerListItem) => void;
  onView: (customer: CustomerListItem) => void;
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
        <DropdownMenuItem onSelect={() => onView(customer)}>View details</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onEdit(customer)}>Edit</DropdownMenuItem>
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

function formatCustomerSince(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function toDrezivoApiError(error: unknown, fallbackMessage = "Could not load customers. Please try again."): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError(fallbackMessage, { status: 503 });
}

function archiveErrorMessage(error: DrezivoApiError): string {
  if (error.code === "STALE_VERSION") {
    return "This customer changed since the archive dialog opened. Refresh the customer and try again.";
  }
  return error.message;
}
