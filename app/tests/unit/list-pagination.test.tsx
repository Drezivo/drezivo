import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ListPagination } from "@/components/ui/list-pagination";

describe("list pagination ranges", () => {
  it("shows the matching total and keeps cursor navigation accessible", () => {
    const next = vi.fn();
    const previous = vi.fn();
    const { rerender } = render(<ListPagination label="Customers pagination" noun={{ one: "customer", other: "customers" }} pageIndex={1} pageSize={10} shown={2} total={12} hasMore={false} onNext={next} onPrevious={previous} />);
    expect(screen.getByText("Showing 11–12 of 12 customers")).toBeVisible();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(previous).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Previous customers page" })).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Next customers page" })).toHaveTextContent("");

    rerender(<ListPagination label="Customers pagination" noun={{ one: "customer", other: "customers" }} pageIndex={0} pageSize={10} shown={1} total={1} hasMore={false} onNext={next} onPrevious={previous} />);
    expect(screen.getByText("Showing 1–1 of 1 customer")).toBeVisible();
    rerender(<ListPagination label="Customers pagination" noun={{ one: "customer", other: "customers" }} pageIndex={0} pageSize={10} shown={0} total={0} hasMore={false} onNext={next} onPrevious={previous} />);
    expect(screen.getByText("Showing 0–0 of 0 customers")).toBeVisible();
  });
});
