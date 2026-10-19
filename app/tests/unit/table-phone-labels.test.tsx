import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function Orders({ rows }: { rows: Array<{ id: string; name: string; total: string }> }) {
  return (
    <Table aria-label="Orders">
      <TableHeader>
        <TableRow>
          <TableHead>Customer</TableHead>
          <TableHead>Total</TableHead>
          <TableHead>
            <span className="sr-only" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell data-label="Amount due">{row.total}</TableCell>
            <TableCell>Edit</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={3}>No orders</TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

describe("Table phone labels", () => {
  it("copies column headers onto body cells, keeps explicit labels, and skips empty headers", async () => {
    render(<Orders rows={[{ id: "1", name: "Maria Santos", total: "₱1,200" }]} />);

    await waitFor(() => expect(screen.getByText("Maria Santos")).toHaveAttribute("data-label", "Customer"));
    expect(screen.getByText("₱1,200")).toHaveAttribute("data-label", "Amount due");
    expect(screen.getByText("Edit")).not.toHaveAttribute("data-label");
  });

  it("labels rows that arrive later and leaves spanning empty-state cells unlabelled", async () => {
    const { rerender } = render(<Orders rows={[]} />);
    expect(screen.getByText("No orders")).not.toHaveAttribute("data-label");

    rerender(<Orders rows={[{ id: "2", name: "Ana Cruz", total: "₱800" }]} />);
    await waitFor(() => expect(screen.getByText("Ana Cruz")).toHaveAttribute("data-label", "Customer"));
  });
});
