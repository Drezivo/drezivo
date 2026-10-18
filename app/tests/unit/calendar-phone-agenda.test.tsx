import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PhoneDayAgenda, PhoneWeekStrip } from "@/components/calendar/calendar-phone-agenda";
import type { CalendarActivity } from "@/components/calendar/calendar-schedule-data";

const WEEK = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];

function activity(overrides: Partial<CalendarActivity>): CalendarActivity {
  return {
    id: "a1",
    source: "reservation",
    sourceId: "r1",
    eventType: "pickup",
    timeUnspecified: false,
    status: "confirmed",
    type: "Pickup",
    dateKey: "2026-10-15",
    startAt: "2026-10-15T02:00:00.000Z",
    endAt: "2026-10-15T03:00:00.000Z",
    startMinute: 600,
    durationMinutes: 60,
    customerName: "Maria Santos",
    itemNames: ["Ivory Ball Gown"],
    categoryIds: [],
    ...overrides,
  };
}

function swipe(element: HTMLElement, dx: number) {
  fireEvent.pointerDown(element, { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 100 });
  fireEvent.pointerMove(element, { pointerId: 1, pointerType: "touch", clientX: 200 + dx / 2, clientY: 102 });
  fireEvent.pointerMove(element, { pointerId: 1, pointerType: "touch", clientX: 200 + dx, clientY: 104 });
  fireEvent.pointerUp(element, { pointerId: 1, pointerType: "touch", clientX: 200 + dx, clientY: 104 });
}

describe("PhoneWeekStrip", () => {
  it("shows seven equal day buttons, marks the selected day, and selects another", () => {
    const onSelect = vi.fn();
    render(
      <PhoneWeekStrip
        dateKeys={WEEK}
        selectedKey="2026-10-15"
        todayKey="2026-10-14"
        activityCountByDate={new Map([["2026-10-15", 2]])}
        businessHours={null}
        onSelect={onSelect}
        onSwipeWeek={vi.fn()}
      />
    );

    const days = screen.getAllByRole("button");
    expect(days).toHaveLength(7);
    expect(screen.getByRole("button", { name: /Thursday, October 15, 2 activities/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /Friday, October 16/ }));
    expect(onSelect).toHaveBeenCalledWith("2026-10-16");
  });

  it("moves a week on a deliberate horizontal swipe and ignores a short drag", () => {
    const onSwipeWeek = vi.fn();
    render(
      <PhoneWeekStrip
        dateKeys={WEEK}
        selectedKey="2026-10-15"
        todayKey="2026-10-15"
        activityCountByDate={new Map()}
        businessHours={null}
        onSelect={vi.fn()}
        onSwipeWeek={onSwipeWeek}
      />
    );
    const strip = screen.getByRole("group");

    swipe(strip, 20);
    expect(onSwipeWeek).not.toHaveBeenCalled();
    swipe(strip, -90);
    expect(onSwipeWeek).toHaveBeenCalledWith(1);
    swipe(strip, 90);
    expect(onSwipeWeek).toHaveBeenLastCalledWith(-1);
  });
});

describe("PhoneDayAgenda", () => {
  it("lists the day's activities in time order and opens the tapped one", () => {
    const onOpenActivity = vi.fn();
    const later = activity({ id: "late", type: "Return", eventType: "return", startAt: "2026-10-15T08:00:00.000Z", endAt: "2026-10-15T09:00:00.000Z", customerName: "Ana Cruz" });
    const earlier = activity({ id: "early" });
    render(
      <PhoneDayAgenda
        dateKey="2026-10-15"
        activities={[later, earlier]}
        businessHours={null}
        timeZone="Asia/Manila"
        onOpenActivity={onOpenActivity}
        onSwipeDay={vi.fn()}
      />
    );

    const rows = within(screen.getByRole("list")).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Maria Santos");
    expect(rows[1]).toHaveTextContent("Ana Cruz");
    expect(screen.getByText("2 activities")).toBeVisible();

    fireEvent.click(rows[1]!);
    expect(onOpenActivity).toHaveBeenCalledWith(later);
  });

  it("shows untimed milestones before the timed agenda without displaying fallback times", () => {
    const onOpenActivity = vi.fn();
    const untimedPickup = activity({
      id: "untimed",
      timeUnspecified: true,
      startAt: "2026-10-15T01:00:00.000Z",
      endAt: "2026-10-15T01:30:00.000Z",
    });
    const timedReturn = activity({
      id: "timed",
      type: "Return",
      eventType: "return",
      timeUnspecified: false,
      startAt: "2026-10-15T08:00:00.000Z",
      endAt: "2026-10-15T08:30:00.000Z",
    });
    render(
      <PhoneDayAgenda
        dateKey="2026-10-15"
        activities={[timedReturn, untimedPickup]}
        businessHours={null}
        timeZone="Asia/Manila"
        onOpenActivity={onOpenActivity}
        onSwipeDay={vi.fn()}
      />
    );

    const untimedSection = screen.getByRole("region", { name: "No specific time" });
    expect(within(untimedSection).getByRole("button", { name: /pickup with no specific time/i })).toBeVisible();
    expect(untimedSection).not.toHaveTextContent("9:00 AM");
    expect(screen.getByRole("list", { name: "Timed activity" })).toHaveTextContent("Return");
    fireEvent.click(within(untimedSection).getByRole("button"));
    expect(onOpenActivity).toHaveBeenCalledWith(untimedPickup);
  });

  it("says when a day is empty and swipes to the next day", () => {
    const onSwipeDay = vi.fn();
    render(
      <PhoneDayAgenda
        dateKey="2026-10-15"
        activities={[]}
        businessHours={null}
        timeZone="Asia/Manila"
        onOpenActivity={vi.fn()}
        onSwipeDay={onSwipeDay}
      />
    );

    const empty = screen.getByText("Nothing scheduled. Swipe for another day.");
    expect(empty).toBeVisible();
    swipe(empty.parentElement!, -100);
    expect(onSwipeDay).toHaveBeenCalledWith(1);
  });
});
