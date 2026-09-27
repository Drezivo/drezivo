import { describe, expect, it } from "vitest";

import { clothingAvailabilityTimelineAgenda } from "@drezivo/contracts";

import {
  addCalendarDays,
  agendaPlacement,
  buildAvailabilityDays,
  formatBoundarySummary,
  todayInTimeZone,
  unavailableReasonLabel,
} from "@/components/calendar/calendar-availability-data";

const agenda = clothingAvailabilityTimelineAgenda.parse({
  id: "reservation:presentation-test:scheduled",
  type: "reserved",
  period: {
    start: "2026-09-27T16:00:00.000Z",
    end: "2026-09-30T16:00:00.000Z",
  },
  display_lane: 0,
  source_type: "reservation",
  source_id: "00000000-0000-4000-8000-000000000301",
  customer_name: "Calendar Customer",
  pickup: { date: "2026-09-28", at: "2026-09-27T16:00:00.000Z" },
  return: { date: "2026-10-01", at: "2026-09-30T16:00:00.000Z" },
  unavailable_reason: null,
});

const recoveryAgenda = clothingAvailabilityTimelineAgenda.parse({
  id: "reservation:presentation-test:recovery",
  type: "unavailable",
  period: {
    start: "2026-09-30T13:18:00.000Z",
    end: "2026-10-01T13:18:00.000Z",
  },
  display_lane: 0,
  source_type: "reservation",
  source_id: "00000000-0000-4000-8000-000000000302",
  customer_name: "Calendar Customer",
  pickup: null,
  return: null,
  unavailable_reason: "recovery",
});

describe("calendar availability presentation", () => {
  it("builds exactly fourteen consecutive calendar columns", () => {
    const days = buildAvailabilityDays("2026-09-27");

    expect(days).toHaveLength(14);
    expect(days[0]).toMatchObject({ date: "2026-09-27", label: "Sun" });
    expect(days.at(-1)?.date).toBe("2026-10-10");
    expect(addCalendarDays("2026-09-27", 14)).toBe("2026-10-11");
  });

  it("positions agenda dates in branch time and keeps the API end instant exclusive", () => {
    expect(agendaPlacement(agenda, "2026-09-27", "2026-10-10", "Asia/Manila")).toEqual({
      startColumn: 2,
      span: 3,
    });
  });

  it("formats boundary labels as metadata instead of standalone agenda states", () => {
    expect(formatBoundarySummary(agenda)).toBe("Pickup Sep 28 · Return Oct 1");
  });

  it("shows post-return recovery starting on the next branch-local calendar day", () => {
    expect(
      agendaPlacement(recoveryAgenda, "2026-09-27", "2026-10-10", "Asia/Manila")
    ).toEqual({ startColumn: 5, span: 1 });
  });

  it("uses the requested IANA timezone when resolving the current calendar date", () => {
    const instant = new Date("2026-09-27T16:30:00.000Z");
    expect(todayInTimeZone("Asia/Manila", instant)).toBe("2026-09-28");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-09-27");
  });

  it("keeps unavailable details specific while the timeline state remains unavailable", () => {
    expect(unavailableReasonLabel("cleaning")).toBe("Cleaning");
    expect(unavailableReasonLabel("maintenance")).toBe("Maintenance");
    expect(unavailableReasonLabel(null)).toBeNull();
  });
});
