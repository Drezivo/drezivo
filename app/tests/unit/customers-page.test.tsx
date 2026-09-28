import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("renders ten customers per page and keeps cursor-style previous and next navigation", () => {
    render(<CustomersPage />);

    const firstPageTable = screen.getByRole("table", { name: "Customers" });
    expect(within(firstPageTable).getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText("Page 1 · 10 customers loaded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous customers page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next customers page" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next customers page" }));

    expect(screen.getByText("Page 2 · 4 customers loaded")).toBeVisible();
    expect(screen.getByText("Trisha Garcia")).toBeVisible();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous customers page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next customers page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous customers page" }));
    expect(screen.getByText("Page 1 · 10 customers loaded")).toBeVisible();
    expect(screen.getByText("Maria Santos")).toBeVisible();
  });

  it("exposes only the approved row actions and opens customer details with both histories", async () => {
    render(<CustomersPage />);

    const actions = screen.getByRole("button", { name: "Actions for Maria Santos" });
    actions.focus();
    fireEvent.keyDown(actions, { key: "ArrowDown" });

    expect(await screen.findByRole("menuitem", { name: "View details" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeVisible();
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "View details" }));
    expect(await screen.findByRole("heading", { name: "Maria Santos" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Reservation History" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Fitting History" })).toBeVisible();
    expect(screen.getByText("RSV-260924-018")).toBeVisible();
    expect(screen.getByText("Emerald Filipiniana Gown · Size S")).toBeVisible();
  });

  it("keeps address optional but requires at least one customer contact", async () => {
    render(<CustomersPage />);

    const actions = screen.getByRole("button", { name: "Actions for Maria Santos" });
    actions.focus();
    fireEvent.keyDown(actions, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));

    const phone = await screen.findByDisplayValue("0917 555 0101");
    const email = screen.getByDisplayValue("maria.santos@example.test");
    const address = screen.getByDisplayValue("24 Sampaguita Street, Quezon City, Metro Manila");

    fireEvent.change(address, { target: { value: "" } });
    fireEvent.change(phone, { target: { value: "" } });
    fireEvent.change(email, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Customer" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add at least a phone number or email address.");

    fireEvent.change(email, { target: { value: "maria.updated@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Customer" }));
    await waitFor(() => expect(screen.getByText("maria.updated@example.test")).toBeVisible());
  });

  it("uses preservation copy for archive and never presents a hard-delete action", async () => {
    render(<CustomersPage />);

    const actions = screen.getByRole("button", { name: "Actions for Maria Santos" });
    actions.focus();
    fireEvent.keyDown(actions, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));

    expect(await screen.findByText("Archive Maria Santos?")).toBeVisible();
    expect(screen.getByText(/Reservation and fitting history will remain unchanged/i)).toBeVisible();
    expect(screen.getByText(/no longer be selectable for new bookings/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Archive Customer" })).toBeVisible();
    expect(screen.queryByText(/delete customer/i)).not.toBeInTheDocument();
  });

  it("resets pagination to page one when the directory filters change", () => {
    render(<CustomersPage />);

    fireEvent.click(screen.getByRole("button", { name: "Next customers page" }));
    expect(screen.getByText("Page 2 · 4 customers loaded")).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: "Search customers" }), {
      target: { value: "Maria" },
    });
    expect(screen.getByText("Page 1 · 1 customer loaded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous customers page" })).toBeDisabled();
  });
});
