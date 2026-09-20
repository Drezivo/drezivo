"use client";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  CLOTHING_CATEGORIES,
  CLOTHING_ITEMS,
  CLOTHING_SIZES,
  type ClothingItem,
} from "./clothing-data";

const PAGE_SIZE = 10;

export function ClothingPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [size, setSize] = useState("All Sizes");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return CLOTHING_ITEMS.filter((item) => {
      const searchMatch =
        !normalized ||
        item.name.toLowerCase().includes(normalized) ||
        item.code.toLowerCase().includes(normalized) ||
        item.category.toLowerCase().includes(normalized);
      const categoryMatch = category === "All Categories" || item.category === category;
      const sizeMatch = size === "All Sizes" || item.sizes.includes(size);
      return searchMatch && categoryMatch && sizeMatch;
    });
  }, [category, query, size]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  const updateFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const physicalGarments = CLOTHING_ITEMS.reduce((sum, item) => sum + item.physicalUnits, 0);
  const categoryCount = new Set(CLOTHING_ITEMS.map((item) => item.category)).size;
  const archivedCount = CLOTHING_ITEMS.filter((item) => item.archived).length;

  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">
              Clothing
            </h1>
            <p className="mt-1 text-sm text-dashboard-muted">
              Manage the clothing styles, variants, and total pieces your business offers.
            </p>
          </div>
          <Link href="/inventory/new" className={buttonVariants()}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Clothing
          </Link>
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
                onChange={(event) => updateFilter(() => setQuery(event.target.value))}
                placeholder="Search clothing by name, code, or category..."
                className="pl-9"
              />
            </div>
            <FilterMenu
              label={category}
              options={CLOTHING_CATEGORIES}
              onSelect={(value) => updateFilter(() => setCategory(value))}
            />
            <FilterMenu
              label={size}
              options={CLOTHING_SIZES}
              onSelect={(value) => updateFilter(() => setSize(value))}
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
          <MetricCard label="Total Styles" value={CLOTHING_ITEMS.length} icon={Shirt} tone="blue" />
          <MetricCard label="Total Pieces" value={physicalGarments} icon={Boxes} tone="mint" />
          <MetricCard label="Categories" value={categoryCount} icon={Tags} tone="purple" />
          <MetricCard label="Archived" value={archivedCount} icon={Archive} tone="neutral" />
        </div>

        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
                  <TableHead className="w-14">Photo</TableHead>
                  <TableHead>Clothing</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Sizes / Variants</TableHead>
                  <TableHead>Rental Price</TableHead>
                  <TableHead>Total Pieces</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-16 text-center text-dashboard-muted">
                      No clothing items match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((item) => (
                    <ClothingRow key={item.id} item={item} />
                  ))
                )}
              </TableBody>
            </Table>

            <div className="flex flex-col gap-3 border-t border-dashboard-border px-4 py-3 text-xs text-dashboard-muted sm:flex-row sm:items-center sm:justify-between">
              <p>
                Showing {filtered.length === 0 ? 0 : start + 1}–
                {Math.min(start + rows.length, filtered.length)} of {filtered.length} clothing styles
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous clothing page"
                  disabled={currentPage === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="h-8 w-8"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                  <Button
                    key={pageNumber}
                    variant="ghost"
                    aria-current={pageNumber === currentPage ? "page" : undefined}
                    onClick={() => setPage(pageNumber)}
                    className={cn(
                      "h-8 min-w-8 px-2",
                      pageNumber === currentPage
                        ? "bg-dashboard-active text-dashboard-accent"
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
                  disabled={currentPage === pageCount}
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
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

function ClothingRow({ item }: { item: ClothingItem }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex h-12 w-10 items-center justify-center rounded-lg bg-dashboard-active text-xs font-semibold text-dashboard-accent">
          {item.initials}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <div>
            <p className="font-semibold text-dashboard-navy">{item.name}</p>
            <p className="mt-1 text-xs text-dashboard-muted">{item.code}</p>
          </div>
          {item.archived ? (
            <span className="rounded-full bg-dashboard-neutral-soft px-2 py-1 text-[0.65rem] font-medium text-dashboard-neutral-text">
              Archived
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-dashboard-muted">{item.category}</TableCell>
      <TableCell>
        <p className="text-sm font-medium text-dashboard-navy">{item.sizes.join(" · ")}</p>
        <p className="mt-1 text-xs text-dashboard-muted">
          {item.variantCount} {item.variantCount === 1 ? "variant" : "variants"}
        </p>
      </TableCell>
      <TableCell>
        <p className="font-semibold text-dashboard-navy">{formatPrice(item)}</p>
        <p className="mt-1 text-xs text-dashboard-muted">per day</p>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
            <Layers3 className="h-4 w-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-dashboard-navy">{item.physicalUnits}</span>
            <span className="mt-0.5 block text-xs text-dashboard-muted">pieces</span>
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
            <DropdownMenuItem>View details</DropdownMenuItem>
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>{item.archived ? "Restore" : "Archive"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function formatPrice(item: ClothingItem) {
  const minimum = `₱${item.minPricePerDay.toLocaleString()}`;
  if (item.minPricePerDay === item.maxPricePerDay) return minimum;
  return `${minimum}–₱${item.maxPricePerDay.toLocaleString()}`;
}

function FilterMenu({
  label,
  options,
  onSelect,
}: {
  label: string;
  options: readonly string[];
  onSelect: (value: string) => void;
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
