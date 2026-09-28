import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("renders the customer directory table from approved list fields", () => {
    render(<CustomersPage />);

    const table = screen.getByRole("table", { name: "Customers" });
    expect(within(table).getByText("Maria Santos")).toBeVisible();
    expect(within(table).getByText("maria.santos@example.test")).toBeVisible();
    expect(within(table).getByText("0917 555 0101")).toBeVisible();
    expect(within(table).queryByText("Diana Ramos")).not.toBeInTheDocument();

    const mariaRow = within(table).getByText("Maria Santos").closest("tr");
    expect(mariaRow).not.toBeNull();
    if (!mariaRow) return;
    expect(within(mariaRow).getByText("4")).toBeVisible();
    expect(within(mariaRow).getByText("2")).toBeVisible();
    expect(within(mariaRow).getByText("Active")).toBeVisible();
  });

  it("filters the prototype table by customer name, phone, or email", () => {
    render(<CustomersPage />);

    const search = screen.getByRole("textbox", { name: "Search customers" });
    fireEvent.change(search, { target: { value: "nicole.mendoza@example.test" } });

    expect(screen.getByText("Nicole Mendoza")).toBeVisible();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
  });
});
