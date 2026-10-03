import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("disables unavailable dates while keeping available capacity selectable", () => {
    const onRangeChange = renderCalendar();
    const reservedDay = screen.getByRole("button", { name: /October 12.*Reserved/i });
    const rentedDay = screen.getByRole("button", { name: /October 13.*Rented/i });

    expect(reservedDay).toBeDisabled();
    expect(rentedDay).toBeDisabled();

    fireEvent.click(reservedDay);
    fireEvent.click(rentedDay);
    expect(onRangeChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /October 10.*Available/i }));
    expect(onRangeChange).toHaveBeenLastCalledWith({
      pickupDate: "2026-10-10",
      dueDate: "",
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

  it("counts the pickup date as Day 1 when suggesting the earliest return date", () => {
    renderCalendar();

    fireEvent.click(screen.getByRole("button", { name: /October 10.*Available/i }));

    // A 3-day package picked up Oct 10 is returned Oct 12, not Oct 13.
    expect(
      screen.getByText(/This is a 3-day rental\. The pickup date counts as Day 1, so the earliest return date is .*12/)
    ).toBeVisible();
  });

  it("lets a 1-day fixed package return on its pickup date", () => {
    const onRangeChange = renderCalendar(
      vi.fn(),
      staffReservationAvailabilityCalendarResponse.parse({
        ...availability,
        pricing: { ...availability.pricing, included_duration_minutes: 1440, minimum_duration_minutes: 1440 },
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /October 10.*Available/i }));
    fireEvent.click(screen.getByRole("button", { name: /October 10.*Available/i }));

    expect(onRangeChange).toHaveBeenLastCalledWith({ pickupDate: "2026-10-10", dueDate: "2026-10-10" });
  });

  describe("Date from and Date to fields", () => {
    const openDays = staffReservationAvailabilityCalendarResponse.parse({ ...availability, days: [] });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-01T02:00:00.000Z"));
    });
    afterEach(() => vi.useRealTimers());

    const pickInPopover = (day: RegExp) => {
      const matches = screen.getAllByRole("button", { name: day });
      fireEvent.click(matches[matches.length - 1]!);
    };

    it("fills the earliest return date when the pickup date is chosen in the field", () => {
      const onRangeChange = renderCalendar(vi.fn(), openDays);

      fireEvent.click(screen.getByRole("button", { name: "Date from" }));
      pickInPopover(/October 20/);

      // 3-day package: Oct 20 is Day 1, so the return date is Oct 22.
      expect(onRangeChange).toHaveBeenLastCalledWith({ pickupDate: "2026-10-20", dueDate: "2026-10-22" });
      expect(screen.getByRole("button", { name: "Date to" })).toHaveTextContent("Oct 22, 2026");
    });

    it("lets the return date be changed in its own field", () => {
      const onRangeChange = renderCalendar(vi.fn(), openDays);

      fireEvent.click(screen.getByRole("button", { name: "Date from" }));
      pickInPopover(/October 20/);
      fireEvent.click(screen.getByRole("button", { name: "Date to" }));
      pickInPopover(/October 24/);

      expect(onRangeChange).toHaveBeenLastCalledWith({ pickupDate: "2026-10-20", dueDate: "2026-10-24" });
    });

    it("shows the calendar's selection in both fields", () => {
      renderCalendar(vi.fn(), openDays);

      // No popover is open, so the only October day buttons belong to the main calendar.
      fireEvent.click(screen.getAllByRole("button", { name: /October 10/ })[0]!);
      fireEvent.click(screen.getAllByRole("button", { name: /October 14/ })[0]!);

      expect(screen.getByRole("button", { name: "Date from" })).toHaveTextContent("Oct 10, 2026");
      expect(screen.getByRole("button", { name: "Date to" })).toHaveTextContent("Oct 14, 2026");
    });

    it("leaves the return date empty when the earliest one would cross a busy day", () => {
      const onRangeChange = renderCalendar();

      fireEvent.click(screen.getByRole("button", { name: "Date from" }));
      pickInPopover(/October 10/);

      // Oct 12 is fully reserved in this fixture, so no 3-day range from Oct 10 is possible.
      expect(onRangeChange).toHaveBeenLastCalledWith({ pickupDate: "2026-10-10", dueDate: "" });
    });
  });
});
