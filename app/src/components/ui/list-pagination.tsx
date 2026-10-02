"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Cursor pagination footer shared by workspace lists. The API pages by cursor, so there is no
 * total count: the footer shows the page number and how many rows this page holds.
 */
export function ListPagination({
  label,
  noun,
  pageIndex,
  shown,
  hasMore,
  onNext,
  onPrevious,
}: {
  /** Accessible name of the pagination landmark, e.g. "Customers pagination". */
  label: string;
  noun: { one: string; other: string };
  pageIndex: number;
  shown: number;
  hasMore: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const currentPage = pageIndex + 1;

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-dashboard-border px-3 py-3 text-sm text-dashboard-muted sm:px-4"
    >
      <span aria-live="polite">
        Page {currentPage} · {shown} {shown === 1 ? noun.one : noun.other}
      </span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={pageIndex === 0} onClick={onPrevious}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
        </Button>
        <span aria-current="page" className="min-w-8 px-2 text-center font-medium text-dashboard-navy">
          <span className="sr-only">Page </span>
          {currentPage}
        </span>
        <Button type="button" variant="ghost" size="sm" disabled={!hasMore} onClick={onNext}>
          Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
