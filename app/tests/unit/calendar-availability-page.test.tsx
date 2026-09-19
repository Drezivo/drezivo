import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CalendarAvailabilityPage } from "@/components/calendar/calendar-availability-page";

describe("CalendarAvailabilityPage", () => {
  it("renders clothing availability as the active calendar view with a path back to schedule", () => {
    render(<CalendarAvailabilityPage />);

    expect(screen.getByRole("heading", { name: "Rental Calendar" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Schedule/i })).toHaveAttribute("href", "/calendar");
    expect(screen.getByRole("link", { name: /Clothing Availability/i })).toHaveAttribute(
      "href",
      "/calendar/availability"
    );
    expect(screen.getByRole("link", { name: /Clothing Availability/i })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("keeps availability details hidden until an agenda block is opened", () => {
    render(<CalendarAvailabilityPage />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Black Satin Gown Reserved details" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("heading", { name: "Black Satin Gown" })).toBeVisible();
    expect(within(dialog).getAllByText("Reserved").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/Maria Santos/).length).toBeGreaterThan(0);
  });

  it("opens the clicked clothing agenda in the sheet", () => {
    render(<CalendarAvailabilityPage />);

    fireEvent.click(screen.getByRole("button", { name: "Open Pink Gown Fitting details" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Pink Gown" })).toBeVisible();
    expect(within(dialog).getAllByText("Sep 10 · 1:00 PM").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Fitting · Sophia Garcia")).toBeVisible();
  });

  it("paginates agenda-bearing clothing instead of rendering the whole catalogue", () => {
    render(<CalendarAvailabilityPage />);

    expect(screen.getByText("Showing 1–25 of 72 clothing items with activity")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Next clothing page" }));

    expect(screen.getByText("Showing 26–50 of 72 clothing items with activity")).toBeVisible();
  });

  it("searches the full catalogue and surfaces clothing with no agenda in the range", () => {
    render(<CalendarAvailabilityPage />);

    fireEvent.change(screen.getByLabelText("Search clothing availability"), {
      target: { value: "CG-010" },
    });

    expect(screen.getByText("Red Evening Dress 2")).toBeVisible();
    expect(screen.getByText("#CG-010")).toBeVisible();
    expect(
      screen.getByText("No scheduled activity in this date range · Available Sep 8 – Sep 21")
    ).toBeVisible();
    expect(screen.getByText("Showing 1–1 of 1 clothing items")).toBeVisible();
  });
});
