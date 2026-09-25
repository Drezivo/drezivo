import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { staffReservationAvailabilityCalendarResponse } from "@drezivo/contracts";

import { ReservationAvailabilityCalendar } from "@/components/reservations/reservation-availability-calendar";

const availability = staffReservationAvailabilityCalendarResponse.parse({
  variant_id: "00000000-0000-4000-8000-000000000101",
  timezone: "Asia/Manila",
  window: { start_date: "2026-10-01", end_date: "2026-10-31" },
  active_assets: 2,
  ready_assets: 2,
  pricing: {
    pricing_mode: "fixed_duration",
    rental_price_minor: "50000",
    security_deposit_minor: "20000",
    currency: "PHP",
    included_duration_minutes: 4320,
    minimum_duration_minutes: 4320,
    extra_day_price_minor: "15000",
    recovery_minutes: 1440,
  },
  days: [
    {
      date: "2026-10-10",
      state: "available",
      active_assets: 2,
      ready_assets: 2,
      available_assets: 2,
      reserved_assets: 0,
      rented_assets: 0,
      fitting_assets: 0,
      maintenance_assets: 0,
      transfer_assets: 0,
    },
    {
      date: "2026-10-11",
      state: "limited",
      active_assets: 2,
      ready_assets: 2,
      available_assets: 1,
      reserved_assets: 1,
      rented_assets: 0,
      fitting_assets: 0,
      maintenance_assets: 0,
      transfer_assets: 0,
    },
    {
      date: "2026-10-12",
      state: "unavailable",
      active_assets: 2,
      ready_assets: 2,
      available_assets: 0,
      reserved_assets: 2,
      rented_assets: 0,
      fitting_assets: 0,
      maintenance_assets: 0,
      transfer_assets: 0,
    },
    {
      date: "2026-10-13",
      state: "unavailable",
      active_assets: 2,
      ready_assets: 2,
      available_assets: 0,
      reserved_assets: 0,
      rented_assets: 2,
      fitting_assets: 0,
      maintenance_assets: 0,
      transfer_assets: 0,
    },
  ],
});

function renderCalendar(
  onRangeChange = vi.fn(),
  calendarAvailability = availability
) {
  function Harness() {
    const [range, setRange] = useState({ pickupDate: "", dueDate: "" });
    return (
      <ReservationAvailabilityCalendar
        availability={calendarAvailability}
        loading={false}
        month={new Date(2026, 9, 1)}
        onMonthChange={vi.fn()}
        pickupDate={range.pickupDate}
        dueDate={range.dueDate}
        onRangeChange={(nextRange) => {
          setRange(nextRange);
          onRangeChange(nextRange);
        }}
        timeZone="Asia/Manila"
      />
    );
  }

  render(<Harness />);
  return onRangeChange;
}

describe("ReservationAvailabilityCalendar", () => {
  it("shows operational availability labels without relying on color alone", () => {
    renderCalendar();

    expect(screen.getByRole("button", { name: /October 10.*Available/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /October 11.*1 left/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /October 12.*Reserved/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /October 13.*Rented/i })).toBeVisible();
    const legend = screen.getByLabelText("Availability legend");
    expect(within(legend).getByText("Available")).toBeVisible();
    expect(within(legend).getByText("Limited")).toBeVisible();
    expect(within(legend).getByText("Unavailable / busy")).toBeVisible();
  });

  it("does not complete a fixed-duration range that is shorter than the configured three-day minimum", () => {
    const onRangeChange = renderCalendar();

    fireEvent.click(screen.getByRole("button", { name: /October 10.*Available/i }));
    fireEvent.click(screen.getByRole("button", { name: /October 12.*Reserved/i }));

    expect(onRangeChange).not.toHaveBeenCalledWith({
      pickupDate: "2026-10-10",
      dueDate: "2026-10-12",
    });
  });

  it("accepts a return date at the fixed-duration minimum boundary", () => {
    const onRangeChange = renderCalendar();

    fireEvent.click(screen.getByRole("button", { name: /October 10.*Available/i }));
    fireEvent.click(screen.getByRole("button", { name: /October 13.*Rented/i }));

    expect(onRangeChange).toHaveBeenLastCalledWith({
      pickupDate: "2026-10-10",
      dueDate: "2026-10-13",
    });
  });

  it("allows a daily rental to choose the same pickup and return calendar date", () => {
    const onRangeChange = renderCalendar(
      vi.fn(),
      staffReservationAvailabilityCalendarResponse.parse({
        ...availability,
        pricing: {
          ...availability.pricing,
          pricing_mode: "daily",
          minimum_duration_minutes: 0,
        },
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /October 10.*Available/i }));
    fireEvent.click(screen.getByRole("button", { name: /October 10.*Available/i }));

    expect(onRangeChange).toHaveBeenLastCalledWith({
      pickupDate: "2026-10-10",
      dueDate: "2026-10-10",
    });
  });
});
