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
});
