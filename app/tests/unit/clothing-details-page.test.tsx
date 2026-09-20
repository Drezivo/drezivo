import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CLOTHING_ITEMS } from "@/components/inventory/clothing-data";
import { ClothingDetailsPage } from "@/components/inventory/clothing-details-page";
import { MeasurementGuideProvider } from "@/components/settings/measurement-guide-context";

function renderDetails() {
  render(
    <MeasurementGuideProvider>
      <ClothingDetailsPage item={CLOTHING_ITEMS[0]!} />
    </MeasurementGuideProvider>
  );
}

describe("ClothingDetailsPage", () => {
  it("focuses on catalogue details, rental history, and maintenance instead of availability status", () => {
    renderDetails();

    expect(screen.getByRole("heading", { name: "Black Satin Gown" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Variants & Pricing" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Rental History" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Maintenance & Cleaning" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Pieces" })).toBeVisible();

    expect(screen.queryByRole("heading", { name: "Availability" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Current Status" })).not.toBeInTheDocument();
  });

  it("shows one initial piece for each configured size", () => {
    renderDetails();

    expect(screen.getAllByText("CG-001-S-001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CG-001-M-001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CG-001-L-001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("opens the shared measurement guide", () => {
    renderDetails();

    fireEvent.click(screen.getByRole("button", { name: "View Measurement" }));

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("Default measurement image preview")).toBeVisible();
  });
});
