import { render, screen } from "@testing-library/react";
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
});
