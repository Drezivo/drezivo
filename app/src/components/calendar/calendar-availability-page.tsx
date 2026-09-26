"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  Search,
  Shirt,
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
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  AVAILABILITY_DAYS,
  AVAILABILITY_ITEMS,
  type AvailabilityBlock,
  type AvailabilityItem,
  type AvailabilityState,
} from "./calendar-availability-data";

const availabilityTone: Record<AvailabilityState, string> = {
  Reserved: "availability-state-reserved",
  Rented: "availability-state-rented",
  Pickup: "availability-state-pickup",
  Return: "availability-state-return",
  Fitting: "availability-state-fitting",
  Unavailable: "availability-state-unavailable",
  Cleaning: "availability-state-unavailable",
  Maintenance: "availability-state-unavailable",
  Available: "availability-state-available",
};

type SelectedAgenda = {
  itemId: string;
  blockIndex: number;
};

export function CalendarAvailabilityPage() {
  const [selectedAgenda, setSelectedAgenda] = useState<SelectedAgenda | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All Categories");
  const [sizeFilter, setSizeFilter] = useState("All Sizes");
  const [statusFilter, setStatusFilter] = useState<"All Statuses" | AvailabilityState>(
    "All Statuses"
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50>(25);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return AVAILABILITY_ITEMS.filter((item) => {
      const hasAgendaInRange = item.blocks.length > 0;
      const queryMatches =
        normalizedQuery.length === 0 ||
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.code.toLowerCase().includes(normalizedQuery) ||
        item.category.toLowerCase().includes(normalizedQuery);
      const categoryMatches = categoryFilter === "All Categories" || item.category === categoryFilter;
      const sizeMatches = sizeFilter === "All Sizes" || item.size === sizeFilter;
      const statusMatches =
        statusFilter === "All Statuses" || item.blocks.some((block) => block.state === statusFilter);

      return (
        (normalizedQuery.length > 0 || hasAgendaInRange) &&
        queryMatches &&
        categoryMatches &&
        sizeMatches &&
        statusMatches
      );
    });
  }, [categoryFilter, query, sizeFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedItems = visibleItems.slice(pageStart, pageStart + pageSize);

  const selectedItem = selectedAgenda
    ? AVAILABILITY_ITEMS.find((item) => item.id === selectedAgenda.itemId) ?? null
    : null;
  const selectedBlock =
    selectedItem && selectedAgenda ? selectedItem.blocks[selectedAgenda.blockIndex] ?? null : null;

  return (
    <div className="min-h-full bg-dashboard-canvas px-3 py-5 sm:px-4 lg:px-5">
      <div className="flex w-full max-w-none flex-col gap-4">
        <AvailabilityHeading />
        <AvailabilityControls
          categoryFilter={categoryFilter}
          query={query}
          sizeFilter={sizeFilter}
          statusFilter={statusFilter}
          onQueryChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          onCategoryChange={(value) => {
            setCategoryFilter(value);
            setPage(1);
          }}
          onSizeChange={(value) => {
            setSizeFilter(value);
            setPage(1);
          }}
          onStatusChange={(value) => {
            setStatusFilter(value);
            setPage(1);
          }}
        />

        <AvailabilityTimeline
          currentPage={currentPage}
          items={paginatedItems}
          pageSize={pageSize}
          pageStart={pageStart}
          totalItems={visibleItems.length}
          totalPages={totalPages}
          isSearching={query.trim().length > 0}
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setPageSize(value);
            setPage(1);
          }}
          onOpenAgenda={(itemId, blockIndex) => setSelectedAgenda({ itemId, blockIndex })}
        />
      </div>

      <AvailabilityDetailsSheet
        item={selectedItem}
        selectedBlock={selectedBlock}
        open={Boolean(selectedItem && selectedBlock)}
        onOpenChange={(open) => {
          if (!open) setSelectedAgenda(null);
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
  onCategoryChange,
  onQueryChange,
  onSizeChange,
  onStatusChange,
  query,
  sizeFilter,
  statusFilter,
}: {
  categoryFilter: string;
  onCategoryChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onSizeChange: (value: string) => void;
  onStatusChange: (value: "All Statuses" | AvailabilityState) => void;
  query: string;
  sizeFilter: string;
  statusFilter: "All Statuses" | AvailabilityState;
}) {
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
              placeholder="Search clothing by name, code, or category..."
              className="pl-9"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous date range"
              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next date range"
              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              Sep 8 – Sep 21, 2025
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <FilterMenu
              label={categoryFilter}
              options={["All Categories", "Gowns", "Dresses", "Wedding", "Filipiniana", "Barong"]}
              onSelect={onCategoryChange}
            />
            <FilterMenu
              label={sizeFilter}
              options={["All Sizes", "S", "M", "L"]}
              onSelect={onSizeChange}
            />
            <FilterMenu
              label={statusFilter}
              options={["All Statuses", "Reserved", "Rented", "Pickup", "Return", "Fitting", "Unavailable", "Cleaning", "Maintenance"]}
              onSelect={(value) => onStatusChange(value as "All Statuses" | AvailabilityState)}
            />
            <span className="text-xs text-dashboard-muted">
              {query.trim()
                ? "Searching the full clothing catalogue"
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
  options: readonly string[];
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
          <DropdownMenuItem key={option} onSelect={() => onSelect(option)}>
            {option}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AvailabilityLegend() {
  const items: AvailabilityState[] = [
    "Reserved",
    "Rented",
    "Pickup",
    "Return",
    "Fitting",
    "Unavailable",
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-dashboard-muted">
      {items.map((item) => (
        <span key={item} className="inline-flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", availabilityTone[item])} />
          {item}
        </span>
      ))}
    </div>
  );
}

function AvailabilityTimeline({
  currentPage,
  isSearching,
  items,
  onOpenAgenda,
  onPageChange,
  onPageSizeChange,
  pageSize,
  pageStart,
  totalItems,
  totalPages,
}: {
  currentPage: number;
  isSearching: boolean;
  items: readonly AvailabilityItem[];
  onOpenAgenda: (itemId: string, blockIndex: number) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: 25 | 50) => void;
  pageSize: 25 | 50;
  pageStart: number;
  totalItems: number;
  totalPages: number;
}) {
  const firstShown = totalItems === 0 ? 0 : pageStart + 1;
  const lastShown = Math.min(pageStart + items.length, totalItems);
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="h-[clamp(34rem,64vh,46rem)] overflow-auto">
          <div className="min-w-[58rem] sm:min-w-[68rem] lg:min-w-[78rem]">
            <div className="sticky top-0 z-30 grid grid-cols-[7.5rem_repeat(14,minmax(3.25rem,1fr))] border-b border-dashboard-border bg-dashboard-surface shadow-sm sm:grid-cols-[9rem_repeat(14,minmax(3.5rem,1fr))] lg:grid-cols-[12rem_repeat(14,minmax(3.5rem,1fr))]">
              <div className="sticky left-0 z-40 flex items-center border-r border-dashboard-border bg-dashboard-surface px-2 py-3 text-xs font-semibold text-dashboard-navy sm:px-3 sm:text-sm lg:px-4">
                Clothing Item
              </div>
              {AVAILABILITY_DAYS.map((day) => (
                <div
                  key={`${day.label}-${day.date}`}
                  className="border-r border-dashboard-border bg-dashboard-surface px-2 py-3 text-center last:border-r-0"
                >
                  <p className="text-xs font-semibold text-dashboard-navy">{day.label}</p>
                  <p className="mt-1 text-[0.7rem] text-dashboard-muted">{day.date}</p>
                </div>
              ))}
            </div>

            {items.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-dashboard-muted">
                No clothing items match the selected filters.
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="grid min-h-16 grid-cols-[7.5rem_repeat(14,minmax(3.25rem,1fr))] border-b border-dashboard-border last:border-b-0 sm:min-h-20 sm:grid-cols-[9rem_repeat(14,minmax(3.5rem,1fr))] lg:grid-cols-[12rem_repeat(14,minmax(3.5rem,1fr))]"
                >
                  <div className="sticky left-0 z-20 flex min-h-16 items-center gap-2 border-r border-dashboard-border bg-dashboard-surface px-2 text-left shadow-[4px_0_8px_-8px_var(--color-dashboard-muted)] sm:min-h-20 sm:gap-3 sm:px-3">
                    <span className="hidden h-12 w-10 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-xs font-semibold text-dashboard-accent sm:flex">
                      {item.initials}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[0.7rem] font-semibold text-dashboard-navy sm:text-xs">
                        {item.name}
                      </span>
                      <span className="mt-1 block text-[0.64rem] text-dashboard-muted sm:hidden">
                        Size {item.size}
                      </span>
                      <span className="mt-1 hidden text-[0.68rem] text-dashboard-muted sm:block">{item.code}</span>
                      <span className="mt-1 hidden text-[0.68rem] text-dashboard-muted sm:block">
                        Size {item.size} · {item.pricePerDay}
                      </span>
                    </span>
                  </div>

                  <div className="relative col-span-14 grid min-h-16 grid-cols-14 bg-dashboard-surface sm:min-h-20">
                    {AVAILABILITY_DAYS.map((day, index) => (
                      <div
                        key={`${item.id}-${day.date}`}
                        className={cn(
                          "border-r border-dashboard-border/70",
                          index === AVAILABILITY_DAYS.length - 1 && "border-r-0"
                        )}
                      />
                    ))}

                    {item.blocks.length === 0 && isSearching ? (
                      <div className="absolute inset-2 z-10 flex items-center justify-center rounded-lg border border-dashed border-dashboard-border bg-dashboard-active/40 px-4 text-center text-xs text-dashboard-muted">
                        No scheduled activity in this date range · Available Sep 8 – Sep 21
                      </div>
                    ) : null}

                    {item.blocks.map((block, index) => (
                      <button
                        key={`${item.id}-${block.state}-${index}`}
                        type="button"
                        aria-label={`Open ${item.name} ${block.state} details`}
                        onClick={() => onOpenAgenda(item.id, index)}
                        style={{
                          gridColumn: `${block.start} / span ${block.span}`,
                          gridRow: "1",
                        }}
                        className={cn(
                          "z-10 m-1 min-w-0 rounded-lg border px-1.5 py-2 text-left text-[0.64rem] leading-4 transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-dashboard-accent/40 sm:px-2 sm:text-[0.68rem]", 
                          availabilityTone[block.state]
                        )}
                      >
                        <span className="block truncate font-semibold">{block.state}</span>
                        {block.customer ? <span className="block truncate">{block.customer}</span> : null}
                        {block.note ? <span className="block truncate opacity-80">{block.note}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-dashboard-border px-4 py-3 text-xs text-dashboard-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            Showing {firstShown}–{lastShown} of {totalItems} clothing items
            {isSearching ? "" : " with activity"}
          </p>

          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous clothing page"
              disabled={currentPage === 1}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>

            {pages.map((pageNumber) => (
              <Button
                key={pageNumber}
                variant="ghost"
                aria-current={pageNumber === currentPage ? "page" : undefined}
                onClick={() => onPageChange(pageNumber)}
                className={cn(
                  "h-8 min-w-8 px-2",
                  pageNumber === currentPage
                    ? "bg-dashboard-active text-dashboard-accent hover:bg-dashboard-active"
                    : "text-dashboard-muted"
                )}
              >
                {pageNumber}
              </Button>
            ))}

            <Button
              variant="ghost"
              size="icon"
              aria-label="Next clothing page"
              disabled={currentPage === totalPages || totalItems === 0}
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
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
      </CardContent>
    </Card>
  );
}

function AvailabilityDetailsSheet({
  item,
  onOpenChange,
  open,
  selectedBlock,
}: {
  item: AvailabilityItem | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedBlock: AvailabilityBlock | null;
}) {
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
                <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-sm font-semibold text-dashboard-accent">
                  {item.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="truncate text-lg">{item.name}</SheetTitle>
                    <Badge
                      variant="outline"
                      className={cn("px-2 py-1 text-xs", availabilityTone[selectedBlock.state])}
                    >
                      {selectedBlock.state}
                    </Badge>
                  </div>
                  <SheetDescription className="mt-1">{item.code}</SheetDescription>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary" className="px-2 py-1 text-xs">
                      Size {item.size}
                    </Badge>
                    <span className="text-sm font-semibold text-dashboard-navy">{item.pricePerDay}</span>
                  </div>
                </div>
              </div>

              <div className={cn("mt-4 rounded-lg border px-4 py-3", availabilityTone[selectedBlock.state])}>
                <p className="text-xs font-semibold">{selectedBlock.note ?? selectedBlock.state}</p>
                <p className="mt-1 text-xs opacity-90">
                  {selectedBlock.customer
                    ? `${selectedBlock.state} · ${selectedBlock.customer}`
                    : selectedBlock.state}
                </p>
              </div>
            </header>

            <div className="flex flex-1 flex-col gap-3 p-4">
              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-dashboard-navy">Availability</h3>
                    </div>
                    <button type="button" className="text-xs font-medium text-dashboard-accent hover:underline">
                      View details →
                    </button>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-dashboard-navy">Sep 8 – Sep 21, 2025</p>
                  <div className="mt-3 overflow-hidden rounded-lg border border-dashboard-border">
                    {item.blocks.map((block, index) => {
                      const isSelected = block === selectedBlock;
                      return (
                        <div
                          key={`${block.state}-${index}`}
                          className={cn(
                            "flex items-start gap-3 border-b border-dashboard-border px-3 py-3 last:border-b-0",
                            isSelected && "bg-dashboard-active"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                              availabilityTone[block.state]
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold text-dashboard-navy">
                                {block.note ?? block.state}
                              </p>
                              {isSelected ? (
                                <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-dashboard-accent">
                                  Selected
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-dashboard-muted">
                              {block.state}{block.customer ? ` (${block.customer})` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-start gap-3 px-3 py-3">
                      <span className="availability-state-available mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" />
                      <div>
                        <p className="text-xs font-semibold text-dashboard-navy">Remaining dates</p>
                        <p className="mt-1 text-xs text-dashboard-muted">Available</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-dashboard-navy">Quick Actions</h3>
                  <div className="mt-3 space-y-2">
                    <QuickLink icon={Shirt} label="View Clothing Details" />
                    <QuickLink icon={CalendarDays} label="View All Reservations" />
                    <QuickLink icon={Eye} label="Check Availability" />
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-dashboard-navy">Upcoming Reservations</h3>
                    <button type="button" className="text-xs font-medium text-dashboard-accent hover:underline">
                      View all →
                    </button>
                  </div>
                  <div className="mt-3 space-y-1">
                    {item.upcoming.map((reservation) => (
                      <div
                        key={`${reservation.customer}-${reservation.date}`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-dashboard-active"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dashboard-active text-[0.65rem] font-semibold text-dashboard-accent">
                          {reservation.customer
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .slice(0, 2)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-dashboard-navy">{reservation.customer}</p>
                          <p className="mt-0.5 text-[0.68rem] text-dashboard-muted">{reservation.date}</p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn("px-2 py-1 text-[0.68rem]", availabilityTone[reservation.state])}
                        >
                          {reservation.state}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function QuickLink({ icon: Icon, label }: { icon: typeof Shirt; label: string }) {
  return (
    <Button
      variant="ghost"
      className="w-full justify-start border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
    >
      <Icon className="h-4 w-4 text-dashboard-accent" aria-hidden="true" />
      {label}
    </Button>
  );
}
