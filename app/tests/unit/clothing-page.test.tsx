import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClothingPage } from "@/components/inventory/clothing-page";

describe("ClothingPage", () => {
  it("renders the clothing page with search beside the filters", () => {
    render(<ClothingPage />);

    expect(screen.getByRole("heading", { name: "Clothing" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Search clothing" })).toBeVisible();
    expect(screen.getByRole("button", { name: "All Categories" })).toBeVisible();
    expect(screen.getByRole("button", { name: "All Sizes" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Sizes / Variants" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Total Pieces" })).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Availability" })).not.toBeInTheDocument();
    expect(screen.getByText("Black Satin Gown")).toBeVisible();
  });

  it("filters clothing by search text", () => {
    render(<ClothingPage />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search clothing" }), {
      target: { value: "CG-009" },
    });

    expect(screen.getByText("Black Costume")).toBeVisible();
    expect(screen.queryByText("Black Satin Gown")).not.toBeInTheDocument();
  });

  it("paginates the clothing table", () => {
    render(<ClothingPage />);

    expect(screen.getByText(/Showing 1–10 of 48 clothing styles/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next clothing page" }));
    expect(screen.getByText(/Showing 11–20 of 48 clothing styles/)).toBeVisible();
  });
});
