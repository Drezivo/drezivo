import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CalendarSchedulePage } from "@/components/calendar/calendar-schedule-page";

describe("CalendarSchedulePage", () => {
  it("renders Schedule as the default calendar view", () => {
    render(<CalendarSchedulePage />);

    expect(screen.getByRole("heading", { name: "Rental Calendar" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Schedule/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Clothing Availability/ })).toHaveAttribute(
      "href",
      "/calendar/availability"
    );
    expect(screen.getByLabelText(/Fitting prototype: Maria Santos, Emerald Gown/)).toBeVisible();
    expect(screen.getByLabelText("Schedule hours 7:00 AM to 9:00 PM")).toBeVisible();
  });

  it("filters visible schedule activities by activity type", async () => {
    render(<CalendarSchedulePage />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "All Activity" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Return" }));

    expect(screen.getByRole("button", { name: "Return" })).toBeVisible();
    expect(screen.getByLabelText(/Return: Daniel Lopez/)).toBeVisible();
    expect(screen.queryByLabelText(/Pickup: Maria Santos/)).not.toBeInTheDocument();
  });

  it("keeps calendar fitting entries explicitly prototype-only", () => {
    render(<CalendarSchedulePage />);

    expect(screen.getByText("Fittings (prototype)")).toBeVisible();
    const fitting = screen.getByLabelText(
      "Fitting prototype: Maria Santos, Emerald Gown, 9:00 AM–10:00 AM"
    );
    expect(within(fitting).getByText("Fitting · Prototype")).toBeVisible();

    fireEvent.click(fitting);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Prototype fitting activity")).toBeVisible();
    expect(
      within(dialog).getByText("Calendar mock only · not linked to /fittings tenant data")
    ).toBeVisible();
    expect(
      within(dialog).getByText(/Reservation and payment lifecycle steps are intentionally not shown/i)
    ).toBeVisible();
    expect(within(dialog).queryByText("Payment Method")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /View Full Reservation/ })).not.toBeInTheDocument();
  });

  it("opens the full day agenda when a day header is clicked", () => {
    render(<CalendarSchedulePage />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Wed Sep 16 agenda" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("September 16, 2026")).toBeVisible();
    expect(within(dialog).getByText("Wednesday")).toBeVisible();
    expect(within(dialog).getByRole("tab", { name: "All (5)" })).toBeVisible();
  });

  it("renders the month overview with compact activities and overflow into the day agenda", () => {
    render(<CalendarSchedulePage />);

    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("September 2026")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open September 26, 2026 agenda" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open September 26, 2026 agenda" })).toHaveAttribute(
      "aria-current",
      "date"
    );
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open 5 more activities on 2026-09-25" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open 5 more activities on 2026-09-25" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("September 25, 2026")).toBeVisible();
    expect(within(dialog).getByRole("tab", { name: "All (9)" })).toBeVisible();
  });

  it("shows Today only when the current period is away from today", () => {
    render(<CalendarSchedulePage />);

    expect(screen.getByRole("button", { name: "Today" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Sat Sep 26 agenda" })).toHaveAttribute(
      "aria-current",
      "date"
    );
    expect(screen.getByText("Today")).toBeVisible();
  });

  it("lays simultaneous activities side by side instead of stacking them", () => {
    render(<CalendarSchedulePage />);

    const overlapping = [
      screen.getByLabelText(/Fitting prototype: Maria Santos, Emerald Gown/),
      screen.getByLabelText(/Fitting prototype: Carla Reyes, Blue Dress/),
      screen.getByLabelText(/Fitting prototype: Ana Lim, Wedding Gown/),
      screen.getByLabelText(/Fitting prototype: Jamie Cruz, Filipiniana Dress/),
      screen.getByLabelText(/Fitting prototype: Bea Tan, Red Gown/),
    ];

    overlapping.forEach((activity) => {
      expect(activity).toHaveAttribute("data-overlap-count", "5");
      expect(activity.getAttribute("style")).toContain("width: calc(20% - 6px)");
    });
    expect(screen.queryByText(/\+ \d+ more/)).not.toBeInTheDocument();
  });

  it("opens prototype fitting details directly from an individual calendar block", () => {
    render(<CalendarSchedulePage />);

    fireEvent.click(
      screen.getByLabelText(
        "Fitting prototype: Maria Santos, Emerald Gown, 9:00 AM–10:00 AM"
      )
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Prototype fitting activity")).toBeVisible();
    expect(within(dialog).getByText("Emerald Gown")).toBeVisible();
    expect(within(dialog).getByText("Customer Details")).toBeVisible();
    expect(within(dialog).getByText("Rental Period")).toBeVisible();
    expect(within(dialog).getByText("Status Timeline")).toBeVisible();
    expect(within(dialog).queryByText("Payment Method")).not.toBeInTheDocument();
  });

  it("opens reservation details from the day agenda list", () => {
    render(<CalendarSchedulePage />);

    fireEvent.click(screen.getByRole("button", { name: "Open Wed Sep 16 agenda" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Agenda Pickup: Carla Dela Cruz, Blue Dress, 9:30 AM–10:30 AM",
      })
    );

    const dialogs = screen.getAllByRole("dialog");
    const detailsDialog = dialogs[dialogs.length - 1]!;
    expect(within(detailsDialog).getByText(/Reservation #R-/)).toBeVisible();
    expect(within(detailsDialog).getByText("Blue Dress")).toBeVisible();
    expect(within(detailsDialog).getByText("Carla Dela Cruz")).toBeVisible();
  });
});
