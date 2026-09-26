import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardOverview } from "@/components/dashboard/dashboard-overview";

describe("DashboardOverview", () => {
  it("renders the reference greeting, date, and overview metrics", () => {
    render(<DashboardOverview />);

    expect(screen.getByRole("heading", { name: "Good morning, Maria!" })).toBeVisible();
    expect(
      screen.getByText("Here's what's happening with your rental business today.")
    ).toBeVisible();
    expect(screen.getByText("Tue, Sep 10, 2025")).toBeVisible();

    for (const label of [
      "Rentals Today",
      "Pickups Today",
      "Returns Today",
      "Fittings Today",
      "Pending Payments",
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }

    expect(screen.getByText("Active rentals")).toBeVisible();
    expect(screen.getByText("Prototype appointments")).toBeVisible();
    expect(screen.getByText("Need confirmation")).toBeVisible();
  });

  it("renders every schedule event with its status", () => {
    render(<DashboardOverview />);

    const schedule = screen.getByRole("list", { name: "Today's schedule" });
    expect(schedule).toBeVisible();
    expect(schedule).toHaveClass("min-w-[560px]");
    expect(schedule.parentElement).toHaveClass("overflow-x-auto");
    expect(screen.getByText("Maria Santos")).toBeVisible();
    expect(screen.getByText("Wedding Gown #24")).toBeVisible();
    expect(screen.getAllByText("Fitting · Prototype").length).toBeGreaterThan(0);
    expect(screen.getByText("Anna Reyes")).toBeVisible();
    expect(screen.getByText("Carla Dela Cruz")).toBeVisible();
    expect(screen.getByText("Jamie Cruz")).toBeVisible();
    expect(screen.getByText("Patricia Lim")).toBeVisible();
    expect(screen.getByText("Sophia Garcia")).toBeVisible();
    expect(screen.getAllByText("Confirmed")).toHaveLength(7);
    expect(screen.getAllByText("Upcoming")).toHaveLength(1);
    expect(screen.getAllByText("Pending")).toHaveLength(3);
  });

  it("renders the Upcoming Rentals table with semantic headers and rows", () => {
    render(<DashboardOverview />);

    expect(screen.getByRole("heading", { name: "Upcoming Rentals" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Customer" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Clothing" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Rental Period" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeVisible();
    expect(screen.getByText("Alyssa Santos")).toBeVisible();
    expect(screen.getByText("Bea Cruz")).toBeVisible();
    expect(screen.getByText("Karen Lim")).toBeVisible();
    expect(screen.getByText("Mika Reyes")).toBeVisible();
    expect(screen.getByText("Trisha Garcia")).toBeVisible();
  });
});
