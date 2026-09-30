"use client";

import { useAuth } from "@clerk/nextjs";
import {
  Archive,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Layers3,
  MoreHorizontal,
  Plus,
  Search,
  Shirt,
  Tags,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  CatalogueCategory,
  ClothingListItem,
  ClothingListSort,
  ClothingProductLifecycle,
} from "@drezivo/contracts";

import { ArchiveClothingDialog, archiveSuccessMessage } from "@/components/inventory/archive-clothing-dialog";
import { RestoreClothingDialog, restoreSuccessMessage } from "@/components/inventory/restore-clothing-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { displayProductSizeCount, displayProductSizes } from "@/lib/catalogue-display";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;
const SIZE_OPTIONS = ["All Sizes", "XS", "S", "M", "L", "XL", "XXL"] as const;
const STATUS_OPTIONS = ["All Statuses", "Active", "Draft", "Archived"] as const;
const SORT_OPTIONS: ReadonlyArray<{ label: string; value: ClothingListSort }> = [
  { label: "New", value: "newest" },
  { label: "Oldest", value: "oldest" },
  { label: "Name A–Z", value: "name_asc" },
  { label: "Name Z–A", value: "name_desc" },
  { label: "Code A–Z", value: "code_asc" },
];
type SizeFilter = (typeof SIZE_OPTIONS)[number];
type StatusFilter = (typeof STATUS_OPTIONS)[number];

type PageMeta = {
  next_cursor: string | null;
  has_more: boolean;
};

export function ClothingPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const deferredQuery = useDeferredValue(query.trim());
  const [categoryId, setCategoryId] = useState<CatalogueCategory["id"] | null>(() =>
    parseCategoryFilter(searchParams.get("category"))
  );
  const [size, setSize] = useState<SizeFilter>(() => parseSizeFilter(searchParams.get("size")));
  const [status, setStatus] = useState<StatusFilter>(() => parseStatusFilter(searchParams.get("status")));
  const [sort, setSort] = useState<ClothingListSort>(() => parseSort(searchParams.get("sort")));
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [rows, setRows] = useState<ClothingListItem[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>({ next_cursor: null, has_more: false });
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<DrezivoApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const currentCursor = pageCursors[pageIndex] ?? null;
  const productStatus = status === "All Statuses" ? null : (status.toLowerCase() as ClothingProductLifecycle);
  const permissionRestricted = error?.status === 403 || error?.code === "FORBIDDEN";

  useEffect(() => {
    const savedNotice = sessionStorage.getItem("drezivo:inventory-notice");
    if (savedNotice === "draft-saved" || savedNotice === "clothing-added") {
      setNotice(savedNotice === "draft-saved" ? "Draft saved" : "Clothing added");
      sessionStorage.removeItem("drezivo:inventory-notice");
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (deferredQuery) params.set("q", deferredQuery);
    if (categoryId) params.set("category", categoryId);
    if (size !== "All Sizes") params.set("size", size);
    if (status !== "All Statuses") params.set("status", status.toLowerCase());
    if (sort !== "newest") params.set("sort", sort);

    const nextSearch = params.toString();
    if (nextSearch === searchParams.toString()) return;
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false });
  }, [categoryId, deferredQuery, pathname, router, searchParams, size, sort, status]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;

    void createDrezivoApiClient(getToken)
      .getCatalogueCategories()
      .then((result) => {
        if (!cancelled) setCategories(result.data.items);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const api = createDrezivoApiClient(getToken);
    void api
      .getCatalogueClothing({
        limit: PAGE_SIZE,
        sort,
        ...(currentCursor ? { cursor: currentCursor } : {}),
        ...(deferredQuery ? { search: deferredQuery } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(size !== "All Sizes" ? { size_label: size } : {}),
        ...(productStatus ? { product_status: productStatus } : {}),
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
    categoryId,
    currentCursor,
    deferredQuery,
    getToken,
    isLoaded,
    isSignedIn,
    reloadVersion,
    size,
    sort,
    productStatus,
  ]);

  const resetPagination = useCallback(() => {
    setPageIndex(0);
    setPageCursors([null]);
  }, []);

  const updateSearch = (value: string) => {
    setQuery(value);
    resetPagination();
  };

  const updateCategory = (value: CatalogueCategory["id"] | null) => {
    setCategoryId(value);
    resetPagination();
  };

  const updateSize = (value: SizeFilter) => {
    setSize(value);
    resetPagination();
  };

  const updateStatus = (value: StatusFilter) => {
    setStatus(value);
    resetPagination();
  };

  const updateSort = (value: ClothingListSort) => {
    setSort(value);
    resetPagination();
  };

  const hasActiveFilters = Boolean(deferredQuery || categoryId || size !== "All Sizes" || status !== "All Statuses");

  const clearFilters = () => {
    setQuery("");
    setCategoryId(null);
    setSize("All Sizes");
    setStatus("All Statuses");
    resetPagination();
  };

  const handleArchived = (result: Parameters<typeof archiveSuccessMessage>[0]) => {
    setNotice(archiveSuccessMessage(result));
    resetPagination();
    setReloadVersion((value) => value + 1);
  };

  const handleRestored = (result: Parameters<typeof restoreSuccessMessage>[0]) => {
    setNotice(restoreSuccessMessage(result));
    resetPagination();
    setReloadVersion((value) => value + 1);
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

  const pageMetrics = useMemo(
    () => ({
      styles: rows.length,
      pieces: rows.reduce((total, item) => total + item.readiness.active_assets, 0),
      archived: rows.filter((item) => item.product_status === "archived").length,
    }),
    [rows]
  );

  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">
              Clothing
            </h1>
            <p className="mt-1 text-sm text-dashboard-muted">
              Manage the clothing styles, variants, and serialized pieces in this workspace.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href="/inventory/categories"
              className={buttonVariants({ variant: "secondary" })}
            >
              <Tags className="h-4 w-4" aria-hidden="true" />
              Manage Categories
            </Link>
            <Link href="/inventory/new" className={buttonVariants()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Clothing
            </Link>
          </div>
        </div>

        {notice ? (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-lg border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm font-medium text-success-500"
          >
            <span>{notice}</span>
            <button
              type="button"
              aria-label="Dismiss inventory message"
              onClick={() => setNotice(null)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-success-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success-500/40"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <Card className="gap-0 py-0">
          <CardContent className="flex flex-col gap-2 p-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1 lg:max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dashboard-muted"
                aria-hidden="true"
              />
              <Input
                aria-label="Search clothing"
                value={query}
                onChange={(event) => updateSearch(event.target.value)}
                placeholder="Search clothing by name or code..."
                className="pl-9"
              />
            </div>
            <CategoryFilterMenu
              categories={categories}
              selected={selectedCategory}
              onSelect={updateCategory}
            />
            <FilterMenu
              label={size}
              options={SIZE_OPTIONS}
              onSelect={updateSize}
            />
            <FilterMenu
              label={status}
              options={STATUS_OPTIONS}
              onSelect={updateStatus}
            />
            <SortMenu value={sort} onSelect={updateSort} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <MetricCard label="Styles This Page" value={pageMetrics.styles} icon={Shirt} tone="blue" />
          <MetricCard label="Active Pieces This Page" value={pageMetrics.pieces} icon={Boxes} tone="mint" />
          <MetricCard label="Categories" value={categories.length} icon={Tags} tone="purple" />
          <MetricCard label="Archived This Page" value={pageMetrics.archived} icon={Archive} tone="neutral" />
        </div>

        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="p-0">
            {isLoading ? (
              <CatalogueListState title="Loading clothing…" message="Fetching the latest catalogue for this workspace." />
            ) : error ? (
              permissionRestricted ? (
                <CatalogueListState
                  title="Clothing access is restricted"
                  message="Your current branch permissions do not allow catalogue management. Ask a workspace owner to update your access."
                />
              ) : (
                <CatalogueListState
                  title="Could not load clothing"
                  message={error.message}
                  requestId={error.requestId}
                  actionLabel="Try again"
                  onAction={() => setReloadVersion((value) => value + 1)}
                />
              )
            ) : rows.length === 0 ? (
              <CatalogueListState
                title={hasActiveFilters ? "No clothing matches these filters" : "No clothing yet"}
                message={
                  hasActiveFilters
                    ? "Clear or adjust the search and filters to see other catalogue items."
                    : "Add your first clothing style to start building this workspace catalogue."
                }
                actionLabel={hasActiveFilters ? "Clear filters" : undefined}
                onAction={hasActiveFilters ? clearFilters : undefined}
              />
            ) : (
              <Table aria-label="Clothing catalogue">
                <TableHeader>
                  <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
                    <TableHead className="w-14 px-2 sm:px-4">Photo</TableHead>
                    <TableHead className="px-2 sm:px-4">Clothing</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead className="hidden md:table-cell">Sizes</TableHead>
                    <TableHead className="hidden lg:table-cell">Availability</TableHead>
                    <TableHead className="hidden xl:table-cell">Rental Price</TableHead>
                    <TableHead className="hidden xl:table-cell">Active Pieces</TableHead>
                    <TableHead className="w-12 px-2 sm:px-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => (
                    <ClothingRow
                      key={item.product_id}
                      item={item}
                      onArchived={handleArchived}
                      onRestored={handleRestored}
                    />
                  ))}
                </TableBody>
              </Table>
            )}

            {!isLoading && !error && rows.length > 0 ? (
              <div className="flex flex-col gap-3 border-t border-dashboard-border px-4 py-3 text-xs text-dashboard-muted sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Page {pageIndex + 1} · {rows.length} {rows.length === 1 ? "style" : "styles"} loaded
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Previous clothing page"
                    disabled={pageIndex === 0}
                    onClick={goPrevious}
                    className="h-8 w-8"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-8 px-2 text-center font-medium text-dashboard-navy">
                    {pageIndex + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Next clothing page"
                    disabled={!pageMeta.has_more}
                    onClick={goNext}
                    className="h-8 w-8"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ClothingRow({
  item,
  onArchived,
  onRestored,
}: {
  item: ClothingListItem;
  onArchived: Parameters<typeof ArchiveClothingDialog>[0]["onArchived"];
  onRestored: Parameters<typeof RestoreClothingDialog>[0]["onRestored"];
}) {
  const displayedSizes = displayProductSizes({
    hasFreeSize: item.has_free_size,
    sizeLabels: item.size_labels,
  });
  const displayedSizeCount = displayProductSizeCount({
    hasFreeSize: item.has_free_size,
    sizeLabels: item.size_labels,
  });

  return (
    <TableRow>
      <TableCell className="px-2 sm:px-4">
        <div className="flex h-12 w-10 items-center justify-center overflow-hidden rounded-lg bg-dashboard-active text-xs font-semibold text-dashboard-accent">
          {item.primary_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed catalogue URLs are dynamic and are not configured as stable next/image remote patterns.
            <img
              src={item.primary_image_url}
              alt={`${item.name} catalogue photo`}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            initials(item.name)
          )}
        </div>
      </TableCell>
      <TableCell className="min-w-0 px-2 sm:px-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-dashboard-navy">{item.name}</p>
            <p className="mt-1 text-xs text-dashboard-muted">{item.code}</p>
          </div>
          {item.product_status === "archived" ? (
            <span className="rounded-full bg-dashboard-neutral-soft px-2 py-1 text-[0.65rem] font-medium text-dashboard-neutral-text">
              Archived
            </span>
          ) : null}
          {item.product_status === "draft" ? (
            <span className="rounded-full bg-dashboard-active px-2 py-1 text-[0.65rem] font-medium text-dashboard-muted">
              Draft
            </span>
          ) : null}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs md:hidden">
          <div className="min-w-0">
            <dt className="text-dashboard-muted">Category</dt>
            <dd className="mt-0.5 truncate font-medium text-dashboard-navy">{item.category?.name ?? "Uncategorized"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-dashboard-muted">Sizes</dt>
            <dd className="mt-0.5 truncate font-medium text-dashboard-navy">
              {displayedSizes.length > 0 ? displayedSizes.join(" · ") : "—"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-dashboard-muted">From</dt>
            <dd className="mt-0.5 truncate font-medium text-dashboard-navy">
              {formatMinorMoney(item.price_from_minor, item.currency)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-dashboard-muted">Availability</dt>
            <dd className="mt-0.5 font-medium text-dashboard-navy">
              {item.availability.available_assets}/{item.availability.active_assets} available
            </dd>
          </div>
        </dl>
      </TableCell>
      <TableCell className="hidden text-dashboard-muted md:table-cell">{item.category?.name ?? "Uncategorized"}</TableCell>
      <TableCell className="hidden md:table-cell">
        <p className="text-sm font-medium text-dashboard-navy">
          {displayedSizes.length > 0 ? displayedSizes.join(" · ") : "—"}
        </p>
        <p className="mt-1 text-xs text-dashboard-muted">
          {displayedSizeCount} {displayedSizeCount === 1 ? "size" : "sizes"}
        </p>
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <p className="font-semibold text-dashboard-navy">
          {item.availability.available_assets}/{item.availability.active_assets} available
        </p>
        <p className="mt-1 text-xs text-dashboard-muted">
          {availabilityWindowLabel(item.availability.window.start, item.availability.window.end)}
        </p>
      </TableCell>
      <TableCell className="hidden xl:table-cell">
        <p className="font-semibold text-dashboard-navy">
          {formatMinorMoney(item.price_from_minor, item.currency)}
        </p>
        <p className="mt-1 text-xs text-dashboard-muted">from listed variants</p>
      </TableCell>
      <TableCell className="hidden xl:table-cell">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
            <Layers3 className="h-4 w-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-dashboard-navy">
              {item.readiness.active_assets}
            </span>
            <span className="mt-0.5 block text-xs text-dashboard-muted">active pieces</span>
          </span>
        </div>
      </TableCell>
      <TableCell className="px-2 sm:px-4">
        <ClothingActions item={item} onArchived={onArchived} onRestored={onRestored} />
      </TableCell>
    </TableRow>
  );
}

function CatalogueListState({
  actionLabel,
  message,
  onAction,
  requestId,
  title,
}: {
  actionLabel?: string | undefined;
  message: string;
  onAction?: (() => void) | undefined;
  requestId?: string | null | undefined;
  title: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-5 py-10 text-center">
      <div>
        <p className="font-medium text-dashboard-navy">{title}</p>
        <p className="mt-1 max-w-md text-sm text-dashboard-muted">{message}</p>
        {requestId ? (
          <p className="mt-1 text-xs text-dashboard-muted">Support reference: {requestId}</p>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <Button type="button" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function ClothingActions({
  item,
  onArchived,
  onRestored,
}: {
  item: ClothingListItem;
  onArchived: Parameters<typeof ArchiveClothingDialog>[0]["onArchived"];
  onRestored: Parameters<typeof RestoreClothingDialog>[0]["onRestored"];
}) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Open actions for ${item.name}`}
            className="h-8 w-8"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/inventory/${item.product_id}`}>View details</Link>
          </DropdownMenuItem>
          {item.product_status !== "archived" ? (
            <>
              <DropdownMenuItem asChild>
                <Link href={`/inventory/${item.product_id}/edit`}>Edit</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-dashboard-danger focus:text-dashboard-danger"
                onSelect={() => setArchiveOpen(true)}
              >
                Archive
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => setRestoreOpen(true)}>
              Restore to Draft
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {item.product_status !== "archived" ? (
        <ArchiveClothingDialog
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          productId={item.product_id}
          name={item.name}
          updatedAt={item.updated_at}
          onArchived={onArchived}
        />
      ) : (
        <RestoreClothingDialog
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
          productId={item.product_id}
          name={item.name}
          updatedAt={item.updated_at}
          onRestored={onRestored}
        />
      )}
    </div>
  );
}

function CategoryFilterMenu({
  categories,
  selected,
  onSelect,
}: {
  categories: CatalogueCategory[];
  selected: CatalogueCategory | null;
  onSelect: (value: CatalogueCategory["id"] | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="min-w-36 justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
        >
          {selected?.name ?? "All Categories"}
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-dashboard-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onSelect(null)}>All Categories</DropdownMenuItem>
        {categories.map((category) => (
          <DropdownMenuItem key={category.id} onSelect={() => onSelect(category.id)}>
            {category.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterMenu<Option extends string>({
  label,
  options,
  onSelect,
}: {
  label: string;
  options: readonly Option[];
  onSelect: (value: Option) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="min-w-36 justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
        >
          {label}
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-dashboard-muted" />
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

function SortMenu({
  onSelect,
  value,
}: {
  onSelect: (value: ClothingListSort) => void;
  value: ClothingListSort;
}) {
  const selected = SORT_OPTIONS.find((option) => option.value === value) ?? SORT_OPTIONS[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Sort clothing"
          className="min-w-32 justify-between border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
        >
          {selected.label}
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-dashboard-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {SORT_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onSelect(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function availabilityWindowLabel(start: string, end: string): string {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  const durationHours = (endTime - startTime) / (60 * 60 * 1000);
  if (Math.abs(durationHours - 24) < 0.01) return "Next 24 hours";

  const formatter = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(start))} → ${formatter.format(new Date(end))}`;
}

function parseCategoryFilter(value: string | null): CatalogueCategory["id"] | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? (value as CatalogueCategory["id"])
    : null;
}

function parseSizeFilter(value: string | null): SizeFilter {
  if (!value) return "All Sizes";
  return SIZE_OPTIONS.includes(value as SizeFilter) ? (value as SizeFilter) : "All Sizes";
}

function parseStatusFilter(value: string | null): StatusFilter {
  if (!value) return "All Statuses";
  const normalized = value.toLowerCase();
  if (normalized === "active") return "Active";
  if (normalized === "draft") return "Draft";
  if (normalized === "archived") return "Archived";
  return "All Statuses";
}

function parseSort(value: string | null): ClothingListSort {
  if (!value) return "newest";
  return SORT_OPTIONS.some((option) => option.value === value) ? (value as ClothingListSort) : "newest";
}

function formatMinorMoney(value: string, currency: string) {
  const amount = Number(value) / 100;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not load clothing. Please try again.", { status: 500 });
}

function MetricCard({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: typeof Shirt;
  label: string;
  tone: "blue" | "mint" | "purple" | "neutral";
  value: number;
}) {
  const toneClass = {
    blue: "dashboard-tone-blue",
    mint: "dashboard-tone-mint",
    purple: "dashboard-tone-purple",
    neutral: "bg-dashboard-neutral-soft text-dashboard-neutral-text",
  }[tone];

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex min-h-20 items-center gap-3 p-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", toneClass)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-xs text-dashboard-muted">{label}</span>
          <span className="mt-1 block text-xl font-semibold text-dashboard-navy">{value}</span>
        </span>
      </CardContent>
    </Card>
  );
}
