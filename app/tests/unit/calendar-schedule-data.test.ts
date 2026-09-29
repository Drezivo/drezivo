import { describe, expect, it } from "vitest";

import type {
  FittingDetail,
  OperationalCalendarEvent,
  ReservationDetail,
} from "@drezivo/contracts";

import {
  calendarBoundaryInstant,
  calendarDateKeyAt,
  filterCalendarActivities,
  mapOperationalCalendarEvents,
} from "@/components/calendar/calendar-schedule-data";

const branchId = "00000000-0000-4000-8000-000000000101";
const reservationId = "00000000-0000-4000-8000-000000000102";
const fittingId = "00000000-0000-4000-8000-000000000103";

describe("operational Calendar presentation mapping", () => {
  it("preserves source identity, raw statuses, category IDs, and exact event durations", () => {
    const pickupStart = "2026-09-28T02:00:00.000Z";
    const events: OperationalCalendarEvent[] = [
      {
        id: "fitting-event",
        source: "fitting",
        source_id: fittingId as FittingDetail["id"],
        event_type: "fitting",
        branch_id: branchId as OperationalCalendarEvent["branch_id"],
        period: {
          start: "2026-09-28T04:00:00.000Z",
          end: "2026-09-28T05:15:00.000Z",
        },
        customer_name: "Fitting customer",
        item_names: ["Satin Dress"],
        category_ids: [],
        status: "pending",
      },
      {
        id: "reservation-pickup",
        source: "reservation",
        source_id: reservationId as ReservationDetail["id"],
        event_type: "pickup",
        branch_id: branchId as OperationalCalendarEvent["branch_id"],
        period: {
          start: pickupStart,
          end: "2026-09-28T02:30:00.000Z",
        },
        customer_name: "Reservation customer",
        item_names: ["Emerald Gown"],
        category_ids: [
          "00000000-0000-4000-8000-000000000104" as OperationalCalendarEvent["category_ids"][number],
        ],
        status: "confirmed",
      },
    ];

    const mapped = mapOperationalCalendarEvents(events, "Asia/Manila");
    const pickup = mapped[0];
    const fitting = mapped[1];

    expect(pickup).toMatchObject({
      id: "reservation-pickup",
      source: "reservation",
      sourceId: reservationId,
      eventType: "pickup",
      type: "Pickup",
      status: "confirmed",
      dateKey: "2026-09-28",
      startAt: pickupStart,
      durationMinutes: 30,
      categoryIds: ["00000000-0000-4000-8000-000000000104"],
    });
    expect(fitting).toMatchObject({
      id: "fitting-event",
      source: "fitting",
      sourceId: fittingId,
      eventType: "fitting",
      type: "Fitting",
      status: "pending",
      durationMinutes: 75,
    });
  });

  it("uses branch-local boundaries across daylight-saving transitions", () => {
    const beforeDst = calendarBoundaryInstant("2026-03-08", "America/New_York");
    const afterDst = calendarBoundaryInstant("2026-03-09", "America/New_York");

    expect(Date.parse(afterDst) - Date.parse(beforeDst)).toBe(23 * 60 * 60 * 1_000);
    expect(calendarDateKeyAt(new Date(beforeDst), "America/New_York")).toBe("2026-03-08");
    expect(calendarDateKeyAt(new Date(afterDst), "America/New_York")).toBe("2026-03-09");
  });

  it("filters activity type, category IDs, and source-specific status without matching display labels", () => {
    const categoryId = "00000000-0000-4000-8000-000000000110";
    const events: OperationalCalendarEvent[] = [
      {
        id: "pickup",
        source: "reservation",
        source_id: reservationId as ReservationDetail["id"],
        event_type: "pickup",
        branch_id: branchId as OperationalCalendarEvent["branch_id"],
        period: { start: "2026-09-28T02:00:00.000Z", end: "2026-09-28T02:30:00.000Z" },
        customer_name: "Same label",
        item_names: ["Same label"],
        category_ids: [categoryId as OperationalCalendarEvent["category_ids"][number]],
        status: "confirmed",
      },
      {
        id: "return",
        source: "reservation",
        source_id: reservationId as ReservationDetail["id"],
        event_type: "return",
        branch_id: branchId as OperationalCalendarEvent["branch_id"],
        period: { start: "2026-09-28T04:00:00.000Z", end: "2026-09-28T04:30:00.000Z" },
        customer_name: "Same label",
        item_names: ["Same label"],
        category_ids: [],
        status: "confirmed",
      },
      {
        id: "fitting",
        source: "fitting",
        source_id: fittingId as FittingDetail["id"],
        event_type: "fitting",
        branch_id: branchId as OperationalCalendarEvent["branch_id"],
        period: { start: "2026-09-28T06:00:00.000Z", end: "2026-09-28T07:00:00.000Z" },
        customer_name: "Same label",
        item_names: ["Same label"],
        category_ids: [categoryId as OperationalCalendarEvent["category_ids"][number]],
        status: "pending",
      },
    ];
    const activities = mapOperationalCalendarEvents(events, "Asia/Manila");

    expect(
      filterCalendarActivities(activities, {
        activity: "Pickup",
        categoryId,
        statusKey: "reservation:confirmed",
      }).map((activity) => activity.id)
    ).toEqual(["pickup"]);
    expect(
      filterCalendarActivities(activities, {
        activity: "All Activity",
        categoryId,
        statusKey: "fitting:pending",
      }).map((activity) => activity.id)
    ).toEqual(["fitting"]);
    expect(
      filterCalendarActivities(activities, {
        activity: "Return",
        categoryId,
        statusKey: null,
      })
    ).toEqual([]);
  });
});
