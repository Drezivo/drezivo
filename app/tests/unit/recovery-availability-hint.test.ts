import { describe, expect, it } from "vitest";

import type {
  ProductVariantId,
  StaffReservationAvailabilityCalendarResponse,
  StaffReservationAvailabilityCheckResponse,
} from "@drezivo/contracts";

import { recoveryAvailabilityHint } from "@/components/reservations/recovery-availability-hint";

const VARIANT = "00000000-0000-4000-8000-000000000001" as ProductVariantId;
const TIME_ZONE = "Asia/Manila";

function day(date: string, unavailable = false) {
  return {
    date,
    state: unavailable ? ("unavailable" as const) : ("available" as const),
    active_assets: 1,
    ready_assets: unavailable ? 0 : 1,
    available_assets: unavailable ? 0 : 1,
    reserved_assets: 0,
    rented_assets: 0,
    fitting_assets: 0,
    maintenance_assets: 0,
    transfer_assets: 0,
  };
}

function calendar(
  unavailableDates: string[] = [],
  windowEnd = "2026-10-31"
): StaffReservationAvailabilityCalendarResponse {
  const days: StaffReservationAvailabilityCalendarResponse["days"] = [];
  for (let date = "2026-10-23"; date <= windowEnd; date = nextDay(date)) {
    days.push(day(date, unavailableDates.includes(date)));
  }
  return {
    variant_id: VARIANT,
    timezone: TIME_ZONE,
    window: { start_date: "2026-10-23", end_date: windowEnd },
    active_assets: 1,
    ready_assets: 1,
    pricing: {
      pricing_mode: "fixed_duration",
      rental_price_minor: "50000",
      security_deposit_minor: "50000",
      currency: "PHP",
      included_duration_minutes: 4_320,
      minimum_duration_minutes: 4_320,
      extra_day_price_minor: "10000",
      recovery_minutes: 1_440,
    },
    days,
  };
}

function exact(
  overrides: Partial<StaffReservationAvailabilityCheckResponse> = {}
): StaffReservationAvailabilityCheckResponse {
  return {
    variant_id: VARIANT,
    requested_interval: {
      start: "2026-10-23T02:30:00.000Z",
      end: "2026-10-26T02:30:00.000Z",
    },
    blocked_interval: {
      start: "2026-10-23T02:30:00.000Z",
      end: "2026-10-27T02:30:00.000Z",
    },
    available: false,
    available_assets: 0,
    guaranteed: false,
    pricing: {
      pricing_mode: "fixed_duration",
      rental_price_minor: "50000",
      security_deposit_minor: "50000",
      currency: "PHP",
      included_duration_minutes: 4_320,
      minimum_duration_minutes: 4_320,
      extra_day_price_minor: "10000",
      recovery_minutes: 1_440,
    },
    rental_preview: {
      rental_total_minor: "50000",
      extra_day_count: 0,
      currency: "PHP",
    },
    ...overrides,
  };
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

describe("recoveryAvailabilityHint", () => {
  it("explains an unavailable recovery date after otherwise available rental dates", () => {
    const hint = recoveryAvailabilityHint(
      "Rosalie · Flexible fit",
      exact(),
      calendar(["2026-10-27"]),
      TIME_ZONE
    );

    expect(hint).toBe(
      "Rosalie · Flexible fit is unavailable: its 1-day recovery after return extends into Oct 27, when no pieces are free."
    );
  });

  it("keeps generic messaging when a rental date is unavailable", () => {
    expect(
      recoveryAvailabilityHint(
        "Rosalie · Flexible fit",
        exact(),
        calendar(["2026-10-25"]),
        TIME_ZONE
      )
    ).toBeNull();
  });

  it("does not infer recovery conflicts when recovery is zero", () => {
    const value = exact({
      blocked_interval: {
        start: "2026-10-23T02:30:00.000Z",
        end: "2026-10-26T02:30:00.000Z",
      },
      pricing: { ...exact().pricing, recovery_minutes: 0 },
    });
    expect(
      recoveryAvailabilityHint("Rosalie · Flexible fit", value, calendar(["2026-10-27"]), TIME_ZONE)
    ).toBeNull();
  });

  it("keeps generic messaging when covered recovery dates have free pieces", () => {
    expect(
      recoveryAvailabilityHint("Rosalie · Flexible fit", exact(), calendar(), TIME_ZONE)
    ).toBeNull();
  });

  it("keeps generic messaging when calendar coverage ends before the recovery date", () => {
    expect(
      recoveryAvailabilityHint(
        "Rosalie · Flexible fit",
        exact(),
        calendar(["2026-10-27"], "2026-10-26"),
        TIME_ZONE
      )
    ).toBeNull();
  });

  it("keeps generic messaging when the calendar window includes a date but omits its day data", () => {
    const incomplete = calendar(["2026-10-27"]);
    incomplete.days = incomplete.days.filter((item) => item.date !== "2026-10-27");
    expect(
      recoveryAvailabilityHint("Rosalie · Flexible fit", exact(), incomplete, TIME_ZONE)
    ).toBeNull();
  });

  it("uses branch-local dates and excludes a next day when recovery ends at its local midnight", () => {
    const lateReturn = exact({
      requested_interval: {
        start: "2026-10-25T14:00:00.000Z",
        end: "2026-10-26T15:30:00.000Z",
      },
      blocked_interval: {
        start: "2026-10-25T14:00:00.000Z",
        end: "2026-10-26T17:30:00.000Z",
      },
      pricing: { ...exact().pricing, recovery_minutes: 120 },
    });
    const covered = calendar(["2026-10-27"]);
    expect(
      recoveryAvailabilityHint("Rosalie · Flexible fit", lateReturn, covered, TIME_ZONE)
    ).toContain("Oct 27");

    const midnightEnd = exact({
      requested_interval: {
        start: "2026-10-25T14:00:00.000Z",
        end: "2026-10-26T15:00:00.000Z",
      },
      blocked_interval: {
        start: "2026-10-25T14:00:00.000Z",
        end: "2026-10-26T16:00:00.000Z",
      },
      pricing: { ...exact().pricing, recovery_minutes: 60 },
    });
    expect(
      recoveryAvailabilityHint("Rosalie · Flexible fit", midnightEnd, covered, TIME_ZONE)
    ).toBeNull();
  });
});
