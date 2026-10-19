"use client";

import { forwardRef, useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Phones (below 640px, globals.css) show every table as stacked rows: the first cell is the row's
 * title and each other cell reads "Header  value". The labels come from the table's own column
 * headers, copied onto each body cell as data-label, so no page has to repeat them. A cell that
 * already has a data-label keeps it; a cell under an empty header (actions) gets none.
 */
function labelCellsFromHeaders(table: HTMLTableElement) {
  const headerRow = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!headerRow) return;
  const labels: string[] = [];
  for (const cell of Array.from(headerRow.cells)) {
    const text = cell.textContent?.trim() ?? "";
    for (let span = 0; span < Math.max(1, cell.colSpan); span += 1) labels.push(text);
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        const label = labels[column];
        if (cell.dataset["autoLabel"] !== undefined || !cell.hasAttribute("data-label")) {
          if (label && cell.colSpan === 1) {
            cell.setAttribute("data-label", label);
            cell.dataset["autoLabel"] = "";
          } else if (cell.dataset["autoLabel"] !== undefined) {
            cell.removeAttribute("data-label");
          }
        }
        column += Math.max(1, cell.colSpan);
      }
    }
  }
}

const Table = forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(function Table(
  { className, ...props },
  ref
) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const setRef = useCallback(
    (node: HTMLTableElement | null) => {
      tableRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );

  // Rows arrive and change with data, so labels are re-applied whenever the table's rows change.
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    labelCellsFromHeaders(table);
    const observer = new MutationObserver(() => labelCellsFromHeaders(table));
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div data-slot="table-wrap" className="relative w-full overflow-x-auto">
      <table
        ref={setRef}
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
});

const TableHeader = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableHeader({ className, ...props }, ref) {
  return (
    <thead
      ref={ref}
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
});

const TableBody = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableBody({ className, ...props }, ref) {
  return (
    <tbody
      ref={ref}
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
});

const TableFooter = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableFooter({ className, ...props }, ref) {
  return (
    <tfoot
      ref={ref}
      data-slot="table-footer"
      className={cn(
        "border-t bg-dashboard-active/40 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  );
});

const TableRow = forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  function TableRow({ className, ...props }, ref) {
    return (
      <tr
        ref={ref}
        data-slot="table-row"
        className={cn(
          "border-b border-dashboard-border transition-colors hover:bg-dashboard-canvas",
          className
        )}
        {...props}
      />
    );
  }
);

const TableHead = forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  function TableHead({ className, ...props }, ref) {
    return (
      <th
        ref={ref}
        data-slot="table-head"
        className={cn(
          "h-12 whitespace-nowrap px-4 text-left align-middle text-xs font-semibold text-dashboard-muted [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
          className
        )}
        {...props}
      />
    );
  }
);

const TableCell = forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  function TableCell({ className, ...props }, ref) {
    return (
      <td
        ref={ref}
        data-slot="table-cell"
        className={cn(
          "whitespace-nowrap px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
          className
        )}
        {...props}
      />
    );
  }
);

const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(function TableCaption({ className, ...props }, ref) {
  return (
    <caption
      ref={ref}
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-dashboard-muted", className)}
      {...props}
    />
  );
});

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
