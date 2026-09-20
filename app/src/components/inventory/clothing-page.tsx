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
  SlidersHorizontal,
  Tags,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { CatalogueCategory, ClothingListItem } from "@drezivo/contracts";

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
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;
const SIZE_OPTIONS = ["All Sizes", "XS", "S", "M", "L", "XL", "XXL"] as const;

type PageMeta = {
  next_cursor: string | null;
  has_more: boolean;
};

export function ClothingPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [categoryId, setCategoryId] = useState<CatalogueCategory["id"] | null>(null);
  const [size, setSize] = useState<(typeof SIZE_OPTIONS)[number]>("All Sizes");
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [rows, setRows] = useState<ClothingListItem[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>({ next_cursor: null, has_more: false });
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<DrezivoApiError | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const currentCursor = pageCursors[pageIndex] ?? null;

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
        sort: "name_asc",
        ...(currentCursor ? { cursor: currentCursor } : {}),
        ...(deferredQuery ? { search: deferredQuery } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(size !== "All Sizes" ? { size_label: size } : {}),
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

  const updateSize = (value: (typeof SIZE_OPTIONS)[number]) => {
    setSize(value);
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
            <Button
              variant="ghost"
              className="justify-start border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active lg:ml-auto"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              More Filters
            </Button>
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
            <Table>
              <TableHeader>
                <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
                  <TableHead className="w-14">Photo</TableHead>
                  <TableHead>Clothing</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Sizes</TableHead>
                  <TableHead>Rental Price</TableHead>
                  <TableHead>Active Pieces</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-16 text-center text-dashboard-muted">
                      Loading clothing…
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-14 text-center">
                      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
                        <div>
                          <p className="font-medium text-dashboard-navy">Could not load clothing</p>
                          <p className="mt-1 text-sm text-dashboard-muted">{error.message}</p>
                          {error.requestId ? (
                            <p className="mt-1 text-xs text-dashboard-muted">
                              Support reference: {error.requestId}
                            </p>
                          ) : null}
                        </div>
                        <Button type="button" onClick={() => setReloadVersion((value) => value + 1)}>
                          Try again
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-16 text-center text-dashboard-muted">
                      No clothing items match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((item) => <ClothingRow key={item.product_id} item={item} />)
                )}
              </TableBody>
            </Table>

            <div className="flex flex-col gap-3 border-t border-dashboard-border px-4 py-3 text-xs text-dashboard-muted sm:flex-row sm:items-center sm:justify-between">
              <p>
                Page {pageIndex + 1} · {rows.length} {rows.length === 1 ? "style" : "styles"} loaded
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous clothing page"
                  disabled={pageIndex === 0 || isLoading}
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
                  disabled={!pageMeta.has_more || isLoading}
                  onClick={goNext}
                  className="h-8 w-8"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ClothingRow({ item }: { item: ClothingListItem }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex h-12 w-10 items-center justify-center overflow-hidden rounded-lg bg-dashboard-active text-xs font-semibold text-dashboard-accent">
          {item.primary_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed catalogue URLs are dynamic and are not configured as stable next/image remote patterns.
            <img
              src={item.primary_image_url}
              alt={`${item.name} catalogue photo`}
              className="h-full w-full object-cover"
            />
          ) : (
            initials(item.name)
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <div>
            <p className="font-semibold text-dashboard-navy">{item.name}</p>
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
      </TableCell>
      <TableCell className="text-dashboard-muted">{item.category?.name ?? "Uncategorized"}</TableCell>
      <TableCell>
        <p className="text-sm font-medium text-dashboard-navy">
          {item.size_labels.length > 0 ? item.size_labels.join(" · ") : "—"}
        </p>
        <p className="mt-1 text-xs text-dashboard-muted">
          {item.size_labels.length} {item.size_labels.length === 1 ? "size" : "sizes"}
        </p>
      </TableCell>
      <TableCell>
        <p className="font-semibold text-dashboard-navy">
          {formatMinorMoney(item.price_from_minor, item.currency)}
        </p>
        <p className="mt-1 text-xs text-dashboard-muted">from listed variants</p>
      </TableCell>
      <TableCell>
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
      <TableCell>
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
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>{item.product_status === "archived" ? "Restore" : "Archive"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
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
