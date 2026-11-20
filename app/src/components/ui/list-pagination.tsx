"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Cursor pagination footer shared by workspace lists. Older APIs may omit the matching total.
 */
export function ListPagination({
  label,
  noun,
  controlLabel,
  pageIndex,
  shown,
  total,
  pageSize,
  hasMore,
  onNext,
  onPrevious,
}: {
  /** Accessible name of the pagination landmark, e.g. "Customers pagination". */
  label: string;
  noun: { one: string; other: string };
  controlLabel?: string;
  pageIndex: number;
  shown: number;
  total?: number | undefined;
  pageSize: number;
  hasMore: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const currentPage = pageIndex + 1;

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-dashboard-border px-4 py-3 text-xs text-dashboard-muted"
    >
      <span aria-live="polite">
        Showing {shown ? pageIndex * pageSize + 1 : 0}–{shown ? pageIndex * pageSize + shown : 0}
        {total === undefined ? "" : ` of ${total}`} {(total ?? shown) === 1 ? noun.one : noun.other}
      </span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" aria-label={`Previous ${controlLabel ?? noun.other} page`} className="h-8 w-8" disabled={pageIndex === 0} onClick={onPrevious}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span aria-current="page" className="min-w-8 px-2 text-center font-medium text-dashboard-navy">
          <span className="sr-only">Page </span>
          {currentPage}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label={`Next ${controlLabel ?? noun.other} page`} className="h-8 w-8" disabled={!hasMore} onClick={onNext}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
