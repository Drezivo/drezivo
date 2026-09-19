import { fireEvent, render, screen } from "@testing-library/react";
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
});
