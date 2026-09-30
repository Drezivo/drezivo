"use client";

import { useAuth } from "@clerk/nextjs";
import type {
  ClothingAvailabilityTimelineAgenda,
  ClothingAvailabilityTimelineResponse,
  ClothingAvailabilityTimelineRow,
  ClothingAvailabilityTimelineStatus,
  PhysicalAssetSummary,
  UpdatePhysicalAssetStateResponse,
} from "@drezivo/contracts";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Search,
  Shirt,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  ManagePhysicalAssetDialog,
  physicalAssetUpdateSuccessMessage,
} from "@/components/inventory/manage-physical-asset-dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

import {
  AVAILABILITY_WINDOW_DAYS,
  addCalendarDays,
  agendaPlacement,
  availabilityStatusLabel,
  buildAvailabilityDays,
  formatAgendaDateRange,
  formatAvailabilityRange,
  formatBoundaryDateTime,
  formatBoundarySummary,
  formatMinorMoney,
  initials,
  todayInTimeZone,
  unavailableReasonLabel,
  type AvailabilityDay,
} from "./calendar-availability-data";

const availabilityTone: Record<ClothingAvailabilityTimelineStatus, string> = {
  reserved: "availability-state-reserved",
  rented: "availability-state-rented",
  unavailable: "availability-state-unavailable",
};

const STATUS_OPTIONS: ReadonlyArray<{
  label: string;
  value: ClothingAvailabilityTimelineStatus | "";
}> = [
  { label: "All Statuses", value: "" },
  { label: "Reserved", value: "reserved" },
  { label: "Rented", value: "rented" },
  { label: "Unavailable", value: "unavailable" },
];

type SelectedAgenda = {
  assetId: string;
  agendaId: string;
};

type TimelineFacets = ClothingAvailabilityTimelineResponse["facets"];

export function CalendarAvailabilityPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const [isContextResolved, setIsContextResolved] = useState(false);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [selectedAgenda, setSelectedAgenda] = useState<SelectedAgenda | null>(null);
  const [managedAsset, setManagedAsset] = useState<PhysicalAssetSummary | null>(null);
  const [managedAssetSize, setManagedAssetSize] = useState<string | null>(null);
  const [isLoadingManagedAsset, setIsLoadingManagedAsset] = useState(false);
  const [manageReadinessError, setManageReadinessError] = useState<string | null>(null);
  const [readinessNotice, setReadinessNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [categoryId, setCategoryId] = useState<
    TimelineFacets["categories"][number]["id"] | null
  >(null);
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ClothingAvailabilityTimelineStatus | null>(null);
  const [pageSize, setPageSize] = useState<25 | 50>(25);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [timeline, setTimeline] = useState<ClothingAvailabilityTimelineResponse | null>(null);
  const [facets, setFacets] = useState<TimelineFacets>({ categories: [], size_labels: [], has_free_size: false });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<DrezivoApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const assetLookupGeneration = useRef(0);

  const currentCursor = pageCursors[pageIndex] ?? null;
  const windowEnd = windowStart
    ? addCalendarDays(windowStart, AVAILABILITY_WINDOW_DAYS - 1)
    : null;
  const days = useMemo(
    () => (windowStart ? buildAvailabilityDays(windowStart) : []),
    [windowStart]
  );
  const rangeLabel =
    windowStart && windowEnd ? formatAvailabilityRange(windowStart, windowEnd) : "Loading dates…";
  const categoryLabel =
    (categoryId ? facets.categories.find((category) => category.id === categoryId)?.name : null) ??
    "All Categories";
  const statusLabel = statusFilter ? availabilityStatusLabel(statusFilter) : "All Statuses";
  const hasCatalogueFilter = Boolean(deferredQuery || categoryId || sizeFilter);
  const permissionRestricted = error?.status === 403 || error?.code === "FORBIDDEN";

  const resetPagination = useCallback(() => {
    assetLookupGeneration.current += 1;
    setIsLoadingManagedAsset(false);
    setManageReadinessError(null);
    setPageIndex(0);
    setPageCursors([null]);
    setSelectedAgenda(null);
  }, []);

  const manageReadiness = async (item: ClothingAvailabilityTimelineRow) => {
    const generation = ++assetLookupGeneration.current;
    setManagedAsset(null);
    setManagedAssetSize(null);
    setManageReadinessError(null);
    setIsLoadingManagedAsset(true);

    try {
      const result = await createDrezivoApiClient(getToken).getCatalogueClothingDetail(
        item.product.id
      );
      if (assetLookupGeneration.current !== generation) return;

      const matchingVariant = result.data.variants.find((variant) =>
        variant.assets.some((asset) => asset.id === item.asset.id)
      );
      const asset = matchingVariant?.assets.find((candidate) => candidate.id === item.asset.id);
      if (!asset || !matchingVariant) {
        throw new DrezivoApiError(
          "This physical piece could not be found. Refresh the calendar and try again.",
          { status: 404 }
        );
      }

      setManagedAsset(asset);
      setManagedAssetSize(matchingVariant.size_label);
    } catch (caughtError) {
      if (assetLookupGeneration.current !== generation) return;
      setManageReadinessError(toDrezivoApiError(caughtError).message);
    } finally {
      if (assetLookupGeneration.current === generation) {
        setIsLoadingManagedAsset(false);
      }
    }
  };

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    const fallbackTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    void createDrezivoApiClient(getToken)
      .getActorContext()
      .then((result) => {
        if (cancelled) return;
        const activeBranch = result.data.branches.find(
          (branch) => branch.id === result.data.active_branch_id
        );
        const resolvedTimeZone = activeBranch?.timezone ?? result.data.tenant.timezone;
        setTimeZone(resolvedTimeZone);
        setWindowStart(todayInTimeZone(resolvedTimeZone));
      })
      .catch(() => {
        if (cancelled) return;
        setTimeZone(fallbackTimeZone);
        setWindowStart(todayInTimeZone(fallbackTimeZone));
      })
      .finally(() => {
        if (!cancelled) setIsContextResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (
      !isLoaded ||
      !isSignedIn ||
      !isContextResolved ||
      !windowStart ||
      !windowEnd
    ) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setTimeline(null);

    void createDrezivoApiClient(getToken)
      .getClothingAvailabilityTimeline({
        start_date: windowStart,
        end_date: windowEnd,
        limit: pageSize,
        ...(currentCursor ? { cursor: currentCursor } : {}),
        ...(deferredQuery ? { search: deferredQuery } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(sizeFilter ? { size_label: sizeFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      })
      .then((result) => {
        if (cancelled) return;
        setTimeline(result.data);
        setFacets(result.data.facets);
      })
      .catch((caughtError) => {
        if (cancelled) return;
        setError(toDrezivoApiError(caughtError));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    categoryId,
    currentCursor,
    deferredQuery,
    getToken,
    isContextResolved,
    isLoaded,
    isSignedIn,
    pageSize,
    reloadVersion,
    sizeFilter,
    statusFilter,
    windowEnd,
    windowStart,
  ]);

  const selectedItem = selectedAgenda
    ? timeline?.rows.find((row) => row.asset.id === selectedAgenda.assetId) ?? null
    : null;
  const selectedBlock =
    selectedItem && selectedAgenda
      ? selectedItem.agendas.find((agenda) => agenda.id === selectedAgenda.agendaId) ?? null
      : null;
  const effectiveTimeZone = timeline?.timezone ?? timeZone;

  const shiftDateRange = (direction: -1 | 1) => {
    if (!windowStart) return;
    setWindowStart(addCalendarDays(windowStart, direction * AVAILABILITY_WINDOW_DAYS));
    resetPagination();
  };

  const resetDateRange = () => {
    setWindowStart(todayInTimeZone(timeZone));
    resetPagination();
  };

  const goNextPage = () => {
    const nextCursor = timeline?.page_meta.next_cursor;
    if (!timeline?.page_meta.has_more || !nextCursor) return;
    setPageCursors((current) => {
      const next = current.slice(0, pageIndex + 1);
      next[pageIndex + 1] = nextCursor;
      return next;
    });
    setPageIndex((current) => current + 1);
    setSelectedAgenda(null);
  };

  const goPreviousPage = () => {
    setPageIndex((current) => Math.max(0, current - 1));
    setSelectedAgenda(null);
  };

  return (
    <div className="min-h-full bg-dashboard-canvas px-3 py-5 sm:px-4 lg:px-5">
      <div className="flex w-full max-w-none flex-col gap-4">
        <AvailabilityHeading />
        {readinessNotice ? (
          <p
            role="status"
            className="rounded-lg border border-dashboard-border bg-dashboard-surface px-4 py-3 text-sm text-dashboard-navy"
          >
            {readinessNotice}
          </p>
        ) : null}
        <AvailabilityControls
          categoryFilter={categoryLabel}
          categoryOptions={facets.categories.map((category) => ({
            label: category.name,
            value: category.id,
          }))}
          dateRangeLabel={rangeLabel}
          query={query}
          sizeFilter={sizeFilter ?? "All Sizes"}
          sizeOptions={facets.size_labels}
          statusFilter={statusLabel}
          hasCatalogueFilter={hasCatalogueFilter}
          dateNavigationDisabled={!windowStart}
          onQueryChange={(value) => {
            setQuery(value);
            resetPagination();
          }}
          onCategoryChange={(value) => {
            const selectedCategory = facets.categories.find((category) => category.id === value);
            setCategoryId(selectedCategory?.id ?? null);
            resetPagination();
          }}
          onSizeChange={(value) => {
            setSizeFilter(value || null);
            resetPagination();
          }}
          onStatusChange={(value) => {
            setStatusFilter((value || null) as ClothingAvailabilityTimelineStatus | null);
            resetPagination();
          }}
          onPreviousRange={() => shiftDateRange(-1)}
          onNextRange={() => shiftDateRange(1)}
          onResetRange={resetDateRange}
        />

        <AvailabilityTimeline
          currentPage={pageIndex + 1}
          days={days}
          error={error}
          hasCatalogueFilter={hasCatalogueFilter}
          hasMore={timeline?.page_meta.has_more ?? false}
          isLoading={isLoading}
          items={timeline?.rows ?? []}
          onNextPage={goNextPage}
          onOpenAgenda={(assetId, agendaId) => {
            assetLookupGeneration.current += 1;
            setIsLoadingManagedAsset(false);
            setManageReadinessError(null);
            setSelectedAgenda({ assetId, agendaId });
          }}
          onPageSizeChange={(value) => {
            setPageSize(value);
            resetPagination();
          }}
          onPreviousPage={goPreviousPage}
          onRetry={() => setReloadVersion((value) => value + 1)}
          pageIndex={pageIndex}
          pageSize={pageSize}
          permissionRestricted={permissionRestricted}
          rangeLabel={rangeLabel}
          todayKey={todayInTimeZone(effectiveTimeZone)}
          timeZone={effectiveTimeZone}
          windowEnd={windowEnd}
          windowStart={windowStart}
        />
      </div>

      <AvailabilityDetailsSheet
        item={selectedItem}
        selectedBlock={selectedBlock}
        open={Boolean(selectedItem && selectedBlock)}
        rangeLabel={rangeLabel}
        timeZone={effectiveTimeZone}
        canManageReadiness={
          selectedBlock?.type === "unavailable" && selectedItem?.asset.readiness !== "ready"
        }
        isLoadingManagedAsset={isLoadingManagedAsset}
        manageReadinessError={manageReadinessError}
        onManageReadiness={() => {
          if (selectedItem) void manageReadiness(selectedItem);
        }}
        onOpenChange={(open) => {
          if (!open) {
            assetLookupGeneration.current += 1;
            setIsLoadingManagedAsset(false);
            setManageReadinessError(null);
            setSelectedAgenda(null);
          }
        }}
      />

      <ManagePhysicalAssetDialog
        asset={managedAsset}
        sizeLabel={managedAssetSize}
        open={managedAsset !== null}
        onOpenChange={(open) => {
          if (!open) {
            setManagedAsset(null);
            setManagedAssetSize(null);
          }
        }}
        onUpdated={(result: UpdatePhysicalAssetStateResponse) => {
          assetLookupGeneration.current += 1;
          setManagedAsset(null);
          setManagedAssetSize(null);
          setSelectedAgenda(null);
          setReloadVersion((value) => value + 1);
          setReadinessNotice(physicalAssetUpdateSuccessMessage(result));
        }}
      />
    </div>
  );
}

function AvailabilityHeading() {
  return (
    <section
      aria-labelledby="availability-heading"
      className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-dashboard-muted">Calendar</p>
        <h1
          id="availability-heading"
          className="mt-1 font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl"
        >
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
          className="flex min-h-11 min-w-44 items-center justify-center gap-2 px-5 text-sm font-medium text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30"
        >
          <CalendarDays className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
          Schedule
        </Link>
        <Link
          href="/calendar/availability"
          aria-current="page"
          className="flex min-h-11 min-w-52 items-center justify-center gap-2 border-t border-dashboard-accent bg-dashboard-active px-5 text-sm font-semibold text-dashboard-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dashboard-accent/30 sm:border-l sm:border-t-0"
        >
          <Shirt className="h-4 w-4" aria-hidden="true" />
          Clothing Availability
        </Link>
      </nav>
    </section>
  );
}

function AvailabilityControls({
  categoryFilter,
  categoryOptions,
  dateNavigationDisabled,
  dateRangeLabel,
  hasCatalogueFilter,
  onCategoryChange,
  onNextRange,
  onPreviousRange,
  onQueryChange,
  onResetRange,
  onSizeChange,
  onStatusChange,
  query,
  sizeFilter,
  sizeOptions,
  statusFilter,
}: {
  categoryFilter: string;
  categoryOptions: ReadonlyArray<{ label: string; value: string }>;
  dateNavigationDisabled: boolean;
  dateRangeLabel: string;
  hasCatalogueFilter: boolean;
  onCategoryChange: (value: string) => void;
  onNextRange: () => void;
  onPreviousRange: () => void;
  onQueryChange: (value: string) => void;
  onResetRange: () => void;
  onSizeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  query: string;
  sizeFilter: string;
  sizeOptions: readonly string[];
  statusFilter: string;
}) {
  const categories = [{ label: "All Categories", value: "" }, ...categoryOptions];
  const sizes = [
    { label: "All Sizes", value: "" },
    ...sizeOptions.map((size) => ({ label: size, value: size })),
  ];

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search clothing availability</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted"
            />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search clothing by name or category..."
              className="pl-9"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous date range"
              disabled={dateNavigationDisabled}
              onClick={onPreviousRange}
              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next date range"
              disabled={dateNavigationDisabled}
              onClick={onNextRange}
              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              aria-label="Return to the current date range"
              disabled={dateNavigationDisabled}
              onClick={onResetRange}
              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {dateRangeLabel}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <FilterMenu label={categoryFilter} options={categories} onSelect={onCategoryChange} />
            <FilterMenu label={sizeFilter} options={sizes} onSelect={onSizeChange} />
            <FilterMenu
              label={statusFilter}
              options={STATUS_OPTIONS}
              onSelect={onStatusChange}
            />
            <span className="text-xs text-dashboard-muted">
              {hasCatalogueFilter
                ? "Matching clothing may include items with no blocking activity in this range"
                : "Showing only clothing with activity in this date range"}
            </span>
          </div>

          <AvailabilityLegend />
        </div>
      </CardContent>
    </Card>
  );
}

function FilterMenu({
  label,
  onSelect,
  options,
}: {
  label: string;
  onSelect: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="min-w-32 justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
        >
          {label}
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-dashboard-muted" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem key={option.value || "all"} onSelect={() => onSelect(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AvailabilityLegend() {
  const items: ClothingAvailabilityTimelineStatus[] = ["reserved", "rented", "unavailable"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-dashboard-muted">
      {items.map((item) => (
        <span key={item} className="inline-flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", availabilityTone[item])} />
          {availabilityStatusLabel(item)}
        </span>
      ))}
    </div>
  );
}

function AvailabilityTimeline({
  currentPage,
  days,
  error,
  hasCatalogueFilter,
  hasMore,
  isLoading,
  items,
  onNextPage,
  onOpenAgenda,
  onPageSizeChange,
  onPreviousPage,
  onRetry,
  pageIndex,
  pageSize,
  permissionRestricted,
  rangeLabel,
  todayKey,
  timeZone,
  windowEnd,
  windowStart,
}: {
  currentPage: number;
  days: readonly AvailabilityDay[];
  error: DrezivoApiError | null;
  hasCatalogueFilter: boolean;
  hasMore: boolean;
  isLoading: boolean;
  items: readonly ClothingAvailabilityTimelineRow[];
  onNextPage: () => void;
  onOpenAgenda: (assetId: string, agendaId: string) => void;
  onPageSizeChange: (pageSize: 25 | 50) => void;
  onPreviousPage: () => void;
  onRetry: () => void;
  pageIndex: number;
  pageSize: 25 | 50;
  permissionRestricted: boolean;
  rangeLabel: string;
  todayKey: string;
  timeZone: string;
  windowEnd: string | null;
  windowStart: string | null;
}) {
  const firstShown = items.length === 0 ? 0 : pageIndex * pageSize + 1;
  const lastShown = pageIndex * pageSize + items.length;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <div
          aria-label="Clothing availability timeline"
          className="max-h-[clamp(34rem,64vh,46rem)] overflow-auto"
        >
          <div className="min-w-[58rem] sm:min-w-[68rem] lg:min-w-[78rem]">
            <div className="sticky top-0 z-30 grid grid-cols-[7.5rem_repeat(14,minmax(3.25rem,1fr))] border-b border-dashboard-border bg-dashboard-surface shadow-sm sm:grid-cols-[9rem_repeat(14,minmax(3.5rem,1fr))] lg:grid-cols-[12rem_repeat(14,minmax(3.5rem,1fr))]">
              <div className="sticky left-0 z-40 flex items-center border-r border-dashboard-border bg-dashboard-surface px-2 py-3 text-xs font-semibold text-dashboard-navy sm:px-3 sm:text-sm lg:px-4">
                Clothing Item
              </div>
              {days.map((day) => (
                <div
                  key={day.date}
                  aria-current={day.date === todayKey ? "date" : undefined}
                  className={cn(
                    "border-r border-dashboard-border bg-dashboard-surface px-2 py-3 text-center last:border-r-0",
                    day.date === todayKey && "bg-dashboard-gold-soft/70"
                  )}
                >
                  <p
                    className={cn(
                      "text-xs font-semibold text-dashboard-navy",
                      day.date === todayKey && "text-dashboard-gold-text"
                    )}
                  >
                    {day.label}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-[0.7rem] text-dashboard-muted",
                      day.date === todayKey && "font-semibold text-dashboard-gold-text"
                    )}
                  >
                    {day.dateLabel}
                  </p>
                </div>
              ))}
            </div>

            {isLoading ? (
              <TimelineLoadingState />
            ) : error ? (
              <TimelineState
                title={
                  permissionRestricted
                    ? "Calendar availability access is restricted"
                    : "Could not load clothing availability"
                }
                message={
                  permissionRestricted
                    ? "Your current branch permissions do not allow reservation operations. Ask a workspace owner to update your access."
                    : error.message
                }
                requestId={error.requestId}
                {...(!permissionRestricted ? { actionLabel: "Try again", onAction: onRetry } : {})}
              />
            ) : items.length === 0 ? (
              <TimelineState
                title={hasCatalogueFilter ? "No clothing matches these filters" : "No activity in this date range"}
                message={
                  hasCatalogueFilter
                    ? "Adjust the search, category, size, or status filter to see other clothing."
                    : "Reservation and unavailable activity will appear here when it overlaps this range."
                }
              />
            ) : windowStart && windowEnd ? (
              items.map((item) => (
                <AvailabilityRow
                  key={item.asset.id}
                  days={days}
                  hasCatalogueFilter={hasCatalogueFilter}
                  item={item}
                  rangeLabel={rangeLabel}
                  todayKey={todayKey}
                  timeZone={timeZone}
                  windowEnd={windowEnd}
                  windowStart={windowStart}
                  onOpenAgenda={onOpenAgenda}
                />
              ))
            ) : null}
          </div>
        </div>

        {!isLoading && !error && items.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-dashboard-border px-4 py-3 text-xs text-dashboard-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing {firstShown}–{lastShown} clothing items · Page {currentPage}
            </p>

            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous clothing page"
                disabled={pageIndex === 0}
                onClick={onPreviousPage}
                className="h-8 w-8"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>

              <span className="min-w-16 px-2 text-center text-xs font-medium text-dashboard-navy">
                Page {currentPage}
              </span>

              <Button
                variant="ghost"
                size="icon"
                aria-label="Next clothing page"
                disabled={!hasMore}
                onClick={onNextPage}
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    aria-label="Clothing rows per page"
                    className="ml-2 h-8 border border-dashboard-border bg-dashboard-surface px-3 text-dashboard-muted hover:bg-dashboard-active"
                  >
                    {pageSize} / page
                    <ChevronRight className="h-3.5 w-3.5 rotate-90" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onPageSizeChange(25)}>25 / page</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onPageSizeChange(50)}>50 / page</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AvailabilityRow({
  days,
  hasCatalogueFilter,
  item,
  onOpenAgenda,
  rangeLabel,
  todayKey,
  timeZone,
  windowEnd,
  windowStart,
}: {
  days: readonly AvailabilityDay[];
  hasCatalogueFilter: boolean;
  item: ClothingAvailabilityTimelineRow;
  onOpenAgenda: (assetId: string, agendaId: string) => void;
  rangeLabel: string;
  todayKey: string;
  timeZone: string;
  windowEnd: string;
  windowStart: string;
}) {
  const laneCount = Math.max(1, ...item.agendas.map((agenda) => agenda.display_lane + 1));

  return (
    <div className="grid grid-cols-[7.5rem_repeat(14,minmax(3.25rem,1fr))] border-b border-dashboard-border last:border-b-0 sm:grid-cols-[9rem_repeat(14,minmax(3.5rem,1fr))] lg:grid-cols-[12rem_repeat(14,minmax(3.5rem,1fr))]">
      <div className="sticky left-0 z-20 flex min-h-20 items-center gap-2 border-r border-dashboard-border bg-dashboard-surface px-2 text-left shadow-[4px_0_8px_-8px_var(--color-dashboard-muted)] sm:gap-3 sm:px-3">
        <ClothingThumbnail item={item} compact />
        <span className="min-w-0">
          <span className="block truncate text-[0.7rem] font-semibold text-dashboard-navy sm:text-xs">
            {item.product.name}
          </span>
          <span className="mt-1 block text-[0.64rem] text-dashboard-muted sm:hidden">
            Size {item.variant.size_label}
          </span>
          <span className="mt-1 hidden text-[0.68rem] text-dashboard-muted sm:block">
            {item.variant.color_label ?? "No color label"}
          </span>
          <span className="mt-1 hidden text-[0.68rem] text-dashboard-muted sm:block">
            Size {item.variant.size_label} · {formatMinorMoney(item.variant.rental_price_minor, item.variant.currency)}
          </span>
          <span
            className={cn(
              "mt-1 hidden w-fit rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium sm:inline-flex",
              assetReadinessTone(item.asset.readiness)
            )}
          >
            {assetReadinessLabel(item.asset.readiness)}
          </span>
        </span>
      </div>

      <div className="relative col-span-14 bg-dashboard-surface">
        <div className="pointer-events-none absolute inset-0 grid grid-cols-14" aria-hidden="true">
          {days.map((day, index) => (
            <div
              key={`${item.asset.id}-${day.date}`}
              className={cn(
                "border-r border-dashboard-border/70",
                day.date === todayKey && "bg-dashboard-active/40",
                index === days.length - 1 && "border-r-0"
              )}
            />
          ))}
        </div>

        <div
          className="relative z-10 grid min-h-20 grid-cols-14"
          style={{ gridTemplateRows: `repeat(${laneCount}, minmax(4rem, auto))` }}
        >
          {item.agendas.length === 0 && hasCatalogueFilter ? (
            <div className="col-span-14 m-2 flex min-h-16 items-center justify-center rounded-lg border border-dashed border-dashboard-border bg-dashboard-active/40 px-4 text-center text-xs text-dashboard-muted">
              No projected blocking activity in this date range · {rangeLabel}
            </div>
          ) : null}

          {item.agendas.map((agenda) => {
            const placement = agendaPlacement(agenda, windowStart, windowEnd, timeZone);
            if (!placement) return null;
            const boundarySummary = formatBoundarySummary(agenda);
            return (
              <button
                key={agenda.id}
                type="button"
                aria-label={`Open ${item.product.name} ${availabilityStatusLabel(agenda.type)} details`}
                onClick={() => onOpenAgenda(item.asset.id, agenda.id)}
                style={{
                  gridColumn: `${placement.startColumn} / span ${placement.span}`,
                  gridRow: String(agenda.display_lane + 1),
                }}
                className={cn(
                  "z-10 m-1 min-w-0 rounded-lg border px-1.5 py-2 text-left text-[0.64rem] leading-4 transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-dashboard-accent/40 sm:px-2 sm:text-[0.68rem]",
                  availabilityTone[agenda.type]
                )}
              >
                <span className="block truncate font-semibold">
                  {availabilityStatusLabel(agenda.type)}
                </span>
                {agenda.customer_name ? <span className="block truncate">{agenda.customer_name}</span> : null}
                {boundarySummary ? <span className="block truncate opacity-80">{boundarySummary}</span> : null}
                {agenda.type === "unavailable" && agenda.unavailable_reason ? (
                  <span className="block truncate opacity-80">
                    {unavailableReasonLabel(agenda.unavailable_reason)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimelineLoadingState() {
  return (
    <div aria-label="Loading clothing availability" className="animate-pulse">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="grid min-h-20 grid-cols-[7.5rem_repeat(14,minmax(3.25rem,1fr))] border-b border-dashboard-border sm:grid-cols-[9rem_repeat(14,minmax(3.5rem,1fr))] lg:grid-cols-[12rem_repeat(14,minmax(3.5rem,1fr))]"
        >
          <div className="sticky left-0 z-20 border-r border-dashboard-border bg-dashboard-surface p-3">
            <div className="h-3 w-3/4 rounded bg-dashboard-active" />
            <div className="mt-3 h-2 w-1/2 rounded bg-dashboard-active" />
          </div>
          <div className="col-span-14 m-3 rounded-lg bg-dashboard-active/70" />
        </div>
      ))}
    </div>
  );
}

function TimelineState({
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
    <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
      <p className="text-sm font-semibold text-dashboard-navy">{title}</p>
      <p className="max-w-xl text-xs text-dashboard-muted">{message}</p>
      {requestId ? <p className="text-[0.65rem] text-dashboard-muted">Request ID: {requestId}</p> : null}
      {actionLabel && onAction ? (
        <Button variant="secondary" size="sm" onClick={onAction} className="mt-2">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function AvailabilityDetailsSheet({
  canManageReadiness,
  isLoadingManagedAsset,
  item,
  manageReadinessError,
  onManageReadiness,
  onOpenChange,
  open,
  rangeLabel,
  selectedBlock,
  timeZone,
}: {
  canManageReadiness: boolean;
  isLoadingManagedAsset: boolean;
  item: ClothingAvailabilityTimelineRow | null;
  manageReadinessError: string | null;
  onManageReadiness: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  rangeLabel: string;
  selectedBlock: ClothingAvailabilityTimelineAgenda | null;
  timeZone: string;
}) {
  const reservationAgendas =
    item?.agendas.filter(
      (agenda) =>
        agenda.source_type === "reservation" &&
        (agenda.type === "reserved" || agenda.type === "rented") &&
        agenda.customer_name
    ) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-dashboard-border bg-dashboard-surface p-0 sm:max-w-lg lg:max-w-xl"
      >
        {item && selectedBlock ? (
          <div className="flex min-h-full flex-col">
            <header className="border-b border-dashboard-border px-5 py-5 pr-14">
              <div className="flex items-start gap-3">
                <ClothingThumbnail item={item} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="truncate text-lg">{item.product.name}</SheetTitle>
                    <Badge
                      variant="outline"
                      className={cn("px-2 py-1 text-xs", availabilityTone[selectedBlock.type])}
                    >
                      {availabilityStatusLabel(selectedBlock.type)}
                    </Badge>
                  </div>
                  <SheetDescription className="mt-1">
                    {item.variant.color_label ?? "No color label"}
                  </SheetDescription>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary" className="px-2 py-1 text-xs">
                      Size {item.variant.size_label}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn("px-2 py-1 text-xs", assetReadinessTone(item.asset.readiness))}
                    >
                      {assetReadinessLabel(item.asset.readiness)}
                    </Badge>
                    <span className="text-sm font-semibold text-dashboard-navy">
                      {formatMinorMoney(item.variant.rental_price_minor, item.variant.currency)}
                    </span>
                  </div>
                </div>
              </div>

              <div className={cn("mt-4 rounded-lg border px-4 py-3", availabilityTone[selectedBlock.type])}>
                <p className="text-xs font-semibold">
                  {availabilityStatusLabel(selectedBlock.type)} · {formatAgendaDateRange(selectedBlock, timeZone)}
                </p>
                <p className="mt-1 text-xs opacity-90">
                  {selectedBlock.customer_name ??
                    unavailableReasonLabel(selectedBlock.unavailable_reason) ??
                    availabilityStatusLabel(selectedBlock.type)}
                </p>
              </div>
            </header>

            <div className="flex flex-1 flex-col gap-3 p-4">
              {(selectedBlock.pickup || selectedBlock.return) ? (
                <Card className="gap-0 py-0">
                  <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
                    <BoundaryDetail
                      label="Pickup"
                      value={formatBoundaryDateTime(selectedBlock.pickup, timeZone) ?? "Not recorded"}
                    />
                    <BoundaryDetail
                      label="Return"
                      value={formatBoundaryDateTime(selectedBlock.return, timeZone) ?? "Not scheduled"}
                    />
                  </CardContent>
                </Card>
              ) : null}

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-dashboard-navy">Availability</h3>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-dashboard-navy">{rangeLabel}</p>
                  <div className="mt-3 overflow-hidden rounded-lg border border-dashboard-border">
                    {item.agendas.map((agenda) => {
                      const isSelected = agenda.id === selectedBlock.id;
                      const reason = unavailableReasonLabel(agenda.unavailable_reason);
                      return (
                        <div
                          key={agenda.id}
                          className={cn(
                            "flex items-start gap-3 border-b border-dashboard-border px-3 py-3 last:border-b-0",
                            isSelected && "bg-dashboard-active"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                              availabilityTone[agenda.type]
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-xs font-semibold text-dashboard-navy">
                                {formatAgendaDateRange(agenda, timeZone)}
                              </p>
                              {isSelected ? (
                                <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-dashboard-accent">
                                  Selected
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-dashboard-muted">
                              {availabilityStatusLabel(agenda.type)}
                              {agenda.customer_name ? ` · ${agenda.customer_name}` : ""}
                              {reason ? ` · ${reason}` : ""}
                            </p>
                            {formatBoundarySummary(agenda) ? (
                              <p className="mt-1 text-[0.68rem] text-dashboard-muted">
                                {formatBoundarySummary(agenda)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-start gap-3 px-3 py-3">
                      <span className="availability-state-available mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" />
                      <div>
                        <p className="text-xs font-semibold text-dashboard-navy">Other dates</p>
                        <p className="mt-1 text-xs text-dashboard-muted">
                          No blocking agenda is projected for uncovered dates in this selected range.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-dashboard-navy">Quick Actions</h3>
                  <div className="mt-3 space-y-2">
                    {canManageReadiness ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isLoadingManagedAsset}
                        aria-busy={isLoadingManagedAsset}
                        onClick={onManageReadiness}
                        className="h-10 w-full justify-start border border-dashboard-border bg-dashboard-surface px-4 text-dashboard-navy hover:bg-dashboard-active"
                      >
                        {isLoadingManagedAsset ? (
                          <LoaderCircle className="h-4 w-4 animate-spin text-dashboard-accent" aria-hidden="true" />
                        ) : (
                          <Shirt className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
                        )}
                        Manage readiness
                      </Button>
                    ) : null}
                    {manageReadinessError ? (
                      <p
                        role="alert"
                        className="rounded-md border border-dashboard-danger/30 bg-dashboard-danger/10 px-3 py-2 text-xs text-dashboard-danger"
                      >
                        {manageReadinessError}
                      </p>
                    ) : null}
                    {canManageReadiness ? (
                      <p className="text-xs text-dashboard-muted">
                        Marking a piece Ready does not remove reservation or maintenance blocks.
                      </p>
                    ) : null}
                    <QuickLink href={`/inventory/${item.product.id}`} icon={Shirt} label="View Clothing Details" />
                    <QuickLink href="/reservations" icon={CalendarDays} label="View Reservations" />
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-dashboard-navy">Reservations in this range</h3>
                  {reservationAgendas.length > 0 ? (
                    <div className="mt-3 space-y-1">
                      {reservationAgendas.map((agenda) => (
                        <div
                          key={agenda.id}
                          className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-dashboard-active"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dashboard-active text-[0.65rem] font-semibold text-dashboard-accent">
                            {initials(agenda.customer_name ?? "Customer")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-dashboard-navy">
                              {agenda.customer_name}
                            </p>
                            <p className="mt-0.5 text-[0.68rem] text-dashboard-muted">
                              {formatAgendaDateRange(agenda, timeZone)}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn("px-2 py-1 text-[0.68rem]", availabilityTone[agenda.type])}
                          >
                            {availabilityStatusLabel(agenda.type)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-dashboard-muted">
                      No reservation-backed activity is projected for this clothing item in the selected range.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ClothingThumbnail({
  compact = false,
  item,
}: {
  compact?: boolean;
  item: ClothingAvailabilityTimelineRow;
}) {
  return (
    <span
      className={cn(
        "shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dashboard-active font-semibold text-dashboard-accent",
        compact ? "hidden h-12 w-10 text-xs sm:flex" : "flex h-20 w-16 text-sm"
      )}
    >
      {item.product.primary_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- catalogue images use short-lived signed URLs that cannot be configured as stable Next.js image hosts.
        <img
          src={item.product.primary_image_url}
          alt={`${item.product.name} catalogue photo`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        initials(item.product.name)
      )}
    </span>
  );
}

function BoundaryDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.68rem] font-medium uppercase tracking-wide text-dashboard-muted">{label}</p>
      <p className="mt-1 text-xs font-semibold text-dashboard-navy">{value}</p>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Shirt;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex h-10 w-full items-center justify-start gap-2 rounded-md border border-dashboard-border bg-dashboard-surface px-4 text-sm font-medium text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
    >
      <Icon className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
      {label}
    </Link>
  );
}

function assetReadinessLabel(
  readiness: ClothingAvailabilityTimelineRow["asset"]["readiness"]
): string {
  switch (readiness) {
    case "ready":
      return "Ready";
    case "needs_cleaning":
      return "Needs cleaning";
    case "needs_repair":
      return "Needs repair";
    case "unready":
      return "Unready";
  }
}

function assetReadinessTone(
  readiness: ClothingAvailabilityTimelineRow["asset"]["readiness"]
): string {
  return cn(
    readiness === "ready" && "dashboard-tone-mint",
    readiness === "needs_cleaning" && "dashboard-tone-orange",
    readiness === "needs_repair" && "reservation-status-danger",
    readiness === "unready" && "bg-dashboard-neutral-soft text-dashboard-neutral-text"
  );
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  return error instanceof DrezivoApiError
    ? error
    : new DrezivoApiError("We could not load clothing availability. Please try again.", {
        status: 500,
      });
}
