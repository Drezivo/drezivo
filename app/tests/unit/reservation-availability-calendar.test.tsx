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
  calendarAvailability = availability,
  additionalItems: Array<{ label: string; response: typeof availability }> = [],
  status: { loading?: boolean; error?: string | null } = {},
  initialRange = { pickupDate: "", dueDate: "" }
) {
  function Harness() {
    const [range, setRange] = useState(initialRange);
    return (
      <ReservationAvailabilityCalendar
        availabilityItems={[
          { label: "Rosalie · Flexible fit", response: calendarAvailability },
          ...additionalItems,
        ]}
        loading={status.loading ?? false}
        error={status.error ?? null}
        month={new Date(2026, 9, 1)}
        onMonthChange={vi.fn()}
        pickupDate={range.pickupDate}
        dueDate={range.dueDate}
        onRangeChange={(nextRange) => {
          setRange(nextRange);
          onRangeChange(nextRange);
        }}
      />
    );
  }

  render(<Harness />);
  return onRangeChange;
}

describe("ReservationAvailabilityCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T02:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows operational availability labels without relying on color alone", () => {
    renderCalendar();

    expect(screen.getByRole("grid", { name: "October 2026" })).toHaveClass("table-fixed");
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

  it("shows only conflicts within a selected range and keeps unrelated blocked dates out", () => {
    const withPickupDay = staffReservationAvailabilityCalendarResponse.parse({
      ...availability,
      days: [
        { ...availability.days[0]!, date: "2026-10-09" },
        ...availability.days,
      ],
    });
    const biancaMedium = staffReservationAvailabilityCalendarResponse.parse({
      ...withPickupDay,
      variant_id: "00000000-0000-4000-8000-000000000102",
      pricing: { ...availability.pricing, minimum_duration_minutes: 5 * 24 * 60 },
      days: withPickupDay.days.map((day) =>
        day.date === "2026-10-10"
          ? { ...day, state: "unavailable" as const, available_assets: 0, reserved_assets: 1 }
          : day
      ),
    });
    const biancaSmall = staffReservationAvailabilityCalendarResponse.parse({
      ...withPickupDay,
      variant_id: "00000000-0000-4000-8000-000000000103",
      days: withPickupDay.days.map((day) =>
        day.date === "2026-10-11"
          ? { ...day, state: "unavailable" as const, available_assets: 0, rented_assets: 1 }
          : day
      ),
    });

    renderCalendar(vi.fn(), withPickupDay, [
      { label: "Bianca · Medium", response: biancaMedium },
      { label: "Bianca · Small", response: biancaSmall },
    ], {}, { pickupDate: "2026-10-09", dueDate: "2026-10-11" });

    expect(
      screen.getByRole("button", { name: /October 10.*Unavailable: Bianca · Medium/i })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /October 11.*Unavailable: Bianca · Small/i })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Date from" })).toHaveTextContent("Oct 9, 2026");
    expect(screen.getByRole("button", { name: "Date to" })).toHaveTextContent("Oct 11, 2026");
    const conflicts = screen.getByRole("alert");
    expect(conflicts).toHaveTextContent("Selected dates unavailable for:");
    expect(conflicts).toHaveTextContent(/Bianca · Medium: Oct 10/);
    expect(conflicts).toHaveTextContent(/Bianca · Small: Oct 11/);
    expect(conflicts).not.toHaveTextContent("Rosalie · Flexible fit");
    expect(conflicts).not.toHaveTextContent("Oct 12");
    fireEvent.click(screen.getByRole("button", { name: /October 9.*Available/i }));
    expect(
      screen.getByText(/5-day rental.*earliest return date is .*13/i)
    ).toBeVisible();
  });

  it("shows a pickup-date conflict immediately but hides conflicts outside the selected dates", () => {
    const biancaMedium = staffReservationAvailabilityCalendarResponse.parse({
      ...availability,
      variant_id: "00000000-0000-4000-8000-000000000102",
      days: availability.days.map((day) =>
        day.date === "2026-10-10"
          ? { ...day, state: "unavailable" as const, available_assets: 0, reserved_assets: 1 }
          : day
      ),
    });

    renderCalendar(
      vi.fn(),
      availability,
      [{ label: "Bianca · Medium", response: biancaMedium }],
      {},
      { pickupDate: "2026-10-10", dueDate: "" }
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/Bianca · Medium: Oct 10/);
    expect(screen.getByRole("alert")).not.toHaveTextContent("Oct 12");
  });

  it("clears the selected-date conflict when the conflicting item is removed", () => {
    const biancaMedium = staffReservationAvailabilityCalendarResponse.parse({
      ...availability,
      variant_id: "00000000-0000-4000-8000-000000000102",
      days: availability.days.map((day) =>
        day.date === "2026-10-10"
          ? { ...day, state: "unavailable" as const, available_assets: 0, reserved_assets: 1 }
          : day
      ),
    });

    function Harness() {
      const [items, setItems] = useState([
        { label: "Rosalie · Flexible fit", response: availability },
        { label: "Bianca · Medium", response: biancaMedium },
      ]);
      return (
        <>
          <button type="button" onClick={() => setItems((current) => current.slice(0, 1))}>
            Remove Bianca
          </button>
          <ReservationAvailabilityCalendar
            availabilityItems={items}
            loading={false}
            error={null}
            month={new Date(2026, 9, 1)}
            onMonthChange={vi.fn()}
            pickupDate="2026-10-10"
            dueDate=""
            onRangeChange={vi.fn()}
          />
        </>
      );
    }

    render(<Harness />);
    expect(screen.getByRole("alert")).toHaveTextContent("Bianca · Medium: Oct 10");

    fireEvent.click(screen.getByRole("button", { name: "Remove Bianca" }));
    expect(screen.queryByText("Selected dates unavailable for:")).not.toBeInTheDocument();
  });

  it("does not show conflicts without selected dates", () => {
    const conflicting = staffReservationAvailabilityCalendarResponse.parse({
      ...availability,
      variant_id: "00000000-0000-4000-8000-000000000102",
    });

    renderCalendar(vi.fn(), availability, [
      { label: "Bianca · Medium", response: conflicting },
    ]);
    expect(screen.queryByText("Selected dates unavailable for:")).not.toBeInTheDocument();
  });

  it("does not show conflicts for one selected item", () => {
    renderCalendar(
      vi.fn(),
      availability,
      [],
      {},
      { pickupDate: "2026-10-12", dueDate: "2026-10-13" }
    );
    expect(screen.queryByText("Selected dates unavailable for:")).not.toBeInTheDocument();
  });

  it("blocks calendar and date-field selection while availability is loading or failed", () => {
    const onRangeChange = vi.fn();
    renderCalendar(onRangeChange, availability, [], { loading: true });

    const day = screen.getByRole("button", { name: /October 10.*Available/i });
    expect(day).toBeDisabled();
    expect(screen.getByRole("button", { name: "Date from" })).toBeDisabled();
    fireEvent.click(day);
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it("fails closed when the combined calendar request errors", () => {
    renderCalendar(vi.fn(), availability, [], {
      error: "Could not load availability for all selected garments.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load availability for all selected garments."
    );
    expect(screen.getByRole("button", { name: "Date from" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /October 10.*Available/i })).toBeDisabled();
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
    const openDays = staffReservationAvailabilityCalendarResponse.parse({
      ...availability,
      days: Array.from({ length: 31 }, (_, index) => ({
        ...availability.days[0]!,
        date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      })),
    });

    beforeEach(() => {
      vi.setSystemTime(new Date("2026-10-01T02:00:00.000Z"));
    });

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
