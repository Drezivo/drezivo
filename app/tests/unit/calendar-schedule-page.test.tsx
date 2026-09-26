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
    expect(screen.getByText("Maria Santos")).toBeVisible();
    expect(screen.getByText("Black Satin Gown")).toBeVisible();
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
      "Fitting prototype: Leanne Cruz, Wedding Gown, 11:00 AM"
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
    expect(within(dialog).getByText("September 16, 2025")).toBeVisible();
    expect(within(dialog).getByText("Wednesday")).toBeVisible();
    expect(within(dialog).getByRole("tab", { name: "All (21)" })).toBeVisible();
  });

  it("opens the same day agenda from the more button", () => {
    render(<CalendarSchedulePage />);

    fireEvent.click(screen.getByRole("button", { name: "Open all mon activities" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("September 14, 2025")).toBeVisible();
    expect(within(dialog).getByRole("tab", { name: "All (8)" })).toBeVisible();
  });

  it("opens reservation details directly from an individual agenda block", () => {
    render(<CalendarSchedulePage />);

    fireEvent.click(screen.getByLabelText("Pickup: Maria Santos, Black Satin Gown, 9:00 AM"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Reservation #R-/)).toBeVisible();
    expect(within(dialog).getByText("Black Satin Gown")).toBeVisible();
    expect(within(dialog).getByText("Customer Details")).toBeVisible();
    expect(within(dialog).getByText("Rental Period")).toBeVisible();
    expect(within(dialog).getByText("Status Timeline")).toBeVisible();
  });

  it("opens reservation details from the day agenda list", () => {
    render(<CalendarSchedulePage />);

    fireEvent.click(screen.getByRole("button", { name: "Open Wed Sep 16 agenda" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Agenda Pickup: Carla Dela Cruz, Blue Dress, 9:30 AM",
      })
    );

    const dialogs = screen.getAllByRole("dialog");
    const detailsDialog = dialogs[dialogs.length - 1]!;
    expect(within(detailsDialog).getByText(/Reservation #R-/)).toBeVisible();
    expect(within(detailsDialog).getByText("Blue Dress")).toBeVisible();
    expect(within(detailsDialog).getByText("Carla Dela Cruz")).toBeVisible();
  });
});
