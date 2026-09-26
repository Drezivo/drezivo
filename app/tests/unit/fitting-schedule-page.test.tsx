import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FittingSchedulePage } from "@/components/fittings/fitting-schedule-page";

describe("FittingSchedulePage", () => {
  it("renders the business-level schedule shell without resource concepts", () => {
    render(<FittingSchedulePage />);

    expect(screen.getByRole("heading", { name: "Schedule & Availability" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Fittings" })).toHaveAttribute(
      "href",
      "/fittings"
    );
    expect(screen.getByText("Weekly fitting hours")).toBeVisible();
    expect(screen.getByText("Appointment duration")).toBeVisible();
    expect(screen.getByText("Breaks & closures")).toBeVisible();
    expect(screen.getByText("Prototype availability view")).toBeVisible();
    expect(screen.queryByText(/Fitting Room/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fitting Staff/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Capacity Slot/i)).not.toBeInTheDocument();
  });

  it("shows Monday through Sunday hours and supports an unavailable day", () => {
    render(<FittingSchedulePage />);

    for (const day of [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]) {
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }

    const sundaySwitch = screen.getByRole("switch", { name: "Sunday fitting hours" });
    expect(sundaySwitch).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sundaySwitch);
    expect(sundaySwitch).toHaveAttribute("aria-checked", "true");
  });

  it("keeps duration bounded and local", () => {
    render(<FittingSchedulePage />);

    const duration = screen.getByLabelText("Default fitting duration");
    expect(duration).toHaveValue("60");
    fireEvent.change(duration, { target: { value: "45" } });
    expect(duration).toHaveValue("45");
    expect(screen.getByText(/45-minute default/i)).toBeVisible();
    expect(screen.getByText(/does not establish backend capacity/i)).toBeVisible();
  });

  it("adds and removes a local closure without a backend request", () => {
    render(<FittingSchedulePage />);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Lunch break"), {
      target: { value: "Team meeting" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add locally" }));

    expect(screen.getByText("Team meeting")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove Team meeting" }));
    expect(screen.queryByText("Team meeting")).not.toBeInTheDocument();
  });

  it("shows bounded weekly context and opens a fixture appointment in the shared details sheet", () => {
    render(<FittingSchedulePage />);

    expect(screen.getAllByText("Working hours")).toHaveLength(7);
    expect(screen.getByText(/does not enforce or certify backend capacity/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Ari dela Rosa/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Fitting Details")).toBeVisible();
    expect(within(dialog).getByText("Ari dela Rosa")).toBeVisible();
    expect(within(dialog).getByText("Emerald Evening Gown")).toBeVisible();
  });
});
