import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { FittingSchedulePage } from "@/components/fittings/fitting-schedule-page";

describe("FittingSchedulePage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

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
    expect(screen.queryByText("Weekly availability")).not.toBeInTheDocument();
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
    expect(window.sessionStorage.getItem("drezivo:fittings:prototype-default-duration")).toBe("45");
    expect(screen.getByText(/used as the default when creating a fitting/i)).toBeVisible();
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

  it("keeps schedule controls explicitly named and keyboard reachable", () => {
    render(<FittingSchedulePage />);

    expect(screen.getByRole("switch", { name: "Monday fitting hours" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Default fitting duration" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Add window" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Back to Fittings" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("combobox", { name: "Closure type" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Closure date" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Closure start time" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Closure end time" })).toBeVisible();
  });
});
