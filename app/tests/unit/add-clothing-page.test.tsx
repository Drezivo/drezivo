import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AddClothingPage } from "@/components/inventory/add-clothing-page";
import { MeasurementGuideProvider } from "@/components/settings/measurement-guide-context";

function renderPage() {
  return render(
    <MeasurementGuideProvider>
      <AddClothingPage />
    </MeasurementGuideProvider>
  );
}

describe("AddClothingPage", () => {
  it("uses selected sizes to generate one piece per size", () => {
    renderPage();

    expect(screen.getByText(/4 selected · 4 Total Pieces/)).toBeVisible();
    expect(screen.getByText("S → 1 piece")).toBeVisible();
    expect(screen.getByText("XL → 1 piece")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "XL" }));

    expect(screen.getByText(/3 selected · 3 Total Pieces/)).toBeVisible();
    expect(screen.queryByText("XL → 1 piece")).not.toBeInTheDocument();
  });

  it("uses the default guide until a size opts into custom measurements", async () => {
    renderPage();

    expect(screen.queryByLabelText("S bust")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Default guide" })).toHaveLength(4);

    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Default guide" })[0]!, {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Custom measurements" }));

    expect(screen.getByLabelText("S bust")).toBeVisible();
    expect(screen.queryByLabelText("M bust")).not.toBeInTheDocument();
  });

  it("opens the shared default measurement guide without duplicating it per size", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "View Measurement" }));

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("Default measurement image preview")).toBeVisible();
  });

  it("switches pricing between fixed package and daily pricing", () => {
    renderPage();

    expect(screen.getByLabelText("Included Duration")).toBeVisible();
    expect(screen.getByText("₱300 for 3 days · ₱100/additional day")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Per Day/ }));

    expect(screen.queryByLabelText("Included Duration")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Daily Rate")).toBeVisible();
    expect(screen.getByText("₱300 / day")).toBeVisible();
  });
});
