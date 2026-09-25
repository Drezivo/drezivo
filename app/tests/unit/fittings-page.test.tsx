import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FittingsPage } from "@/components/fittings/fittings-page";

describe("FittingsPage", () => {
  it("renders the Phase 1 operational hierarchy with fixture-derived summaries", () => {
    render(<FittingsPage />);

    expect(screen.getByRole("heading", { name: "Fittings" })).toBeVisible();
    expect(screen.getByText("Manage fitting appointments and today's schedule.")).toBeVisible();

    expect(screen.getByRole("link", { name: /Schedule & Availability/ })).toHaveAttribute(
      "href",
      "/fittings/schedule"
    );
    expect(screen.getByRole("button", { name: /New Fitting/ })).toBeDisabled();

    expect(screen.getByText("Today")).toBeVisible();
    expect(screen.getByText("Upcoming")).toBeVisible();
    expect(screen.getByText("Pending review")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("1")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
    expect(screen.getByText("Showing 6 of 6 appointments")).toBeVisible();
  });

  it("filters appointments by customer or garment search and clears the filter", () => {
    render(<FittingsPage />);

    fireEvent.change(screen.getByPlaceholderText("Customer or garment..."), {
      target: { value: "Ivory Wedding Gown" },
    });

    expect(screen.getByText("Showing 1 of 6 appointments")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Showing 6 of 6 appointments")).toBeVisible();
  });

  it("supports status and date filters with a useful empty state", async () => {
    render(<FittingsPage />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "All statuses" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Completed" }));
    expect(screen.getByText("Showing 1 of 6 appointments")).toBeVisible();

    fireEvent.pointerDown(screen.getByRole("button", { name: "All dates" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Today" }));
    expect(screen.getByText("No fittings match these filters.")).toBeVisible();

    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]!);
    expect(screen.getByText("Showing 6 of 6 appointments")).toBeVisible();
  });
});
