import type { ReactNode } from "react";

export interface TableColumn<TRow> {
  key: string;
  header: string;
  render: (row: TRow) => ReactNode;
  /** Right-align numeric/money columns. */
  align?: "left" | "right";
}

export interface TableProps<TRow> {
  columns: TableColumn<TRow>[];
  rows: TRow[];
  /** Stable row identity for React keys — never array index (rows can reorder on refetch). */
  getRowId: (row: TRow) => string;
  onRowClick?: (row: TRow) => void;
  caption: string;
}

export function Table<TRow>({ columns, rows, getRowId, onRowClick, caption }: TableProps<TRow>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-300 bg-white">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-ink-300 bg-ink-100 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={["px-4 py-3", column.align === "right" ? "text-right" : "text-left"].join(" ")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowId = getRowId(row);
            return (
              <tr
                key={rowId}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={[
                  "border-b border-ink-100 last:border-b-0",
                  onRowClick ? "cursor-pointer hover:bg-brand-50" : "",
                ].join(" ")}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={["px-4 py-3 text-ink-900", column.align === "right" ? "text-right" : "text-left"].join(
                      " "
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
