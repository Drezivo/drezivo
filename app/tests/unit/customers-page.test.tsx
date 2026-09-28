import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CustomersPage } from "@/components/customers/customers-page";

describe("CustomersPage", () => {
  it("renders the customer directory page shell", () => {
    render(<CustomersPage />);

    expect(screen.getByRole("heading", { name: "Customers" })).toBeVisible();
    expect(
      screen.getByText("View customer profiles and their reservation and fitting activity.")
    ).toBeVisible();
  });

  it("renders the four customer dashboard metrics", () => {
    render(<CustomersPage />);

    expect(screen.getByText("All Customers")).toBeVisible();
    expect(screen.getByText("New This Month")).toBeVisible();
    expect(screen.getByText("Returning Customers")).toBeVisible();
    expect(screen.getByText("Upcoming Customers")).toBeVisible();
    expect(screen.getByText("128")).toBeVisible();
    expect(screen.getByText("14")).toBeVisible();
    expect(screen.getByText("42")).toBeVisible();
    expect(screen.getByText("19")).toBeVisible();
  });

  it("uses Active as the default customer filter and can clear toolbar filters", async () => {
    render(<CustomersPage />);

    const search = screen.getByRole("textbox", { name: "Search customers" });
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: "Status: Active" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Maria" } });
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeVisible();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Status: Active" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archived" }));
    expect(screen.getByRole("button", { name: "Status: Archived" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: "Status: Active" })).toBeVisible();
  });
});
