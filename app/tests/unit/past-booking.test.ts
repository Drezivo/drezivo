import { describe, expect, it } from "vitest";

import { isPastBooking } from "@/lib/past-booking";

describe("isPastBooking", () => {
  it("labels a booking entered after its due time", () => {
    expect(
      isPastBooking({ due_at: "2026-10-01T02:00:00.000Z", created_at: "2026-10-11T09:00:00.000Z" })
    ).toBe(true);
  });

  it("does not label a booking whose pickup passed but due time is future", () => {
    expect(
      isPastBooking({ due_at: "2026-10-15T02:00:00.000Z", created_at: "2026-10-11T09:00:00.000Z" })
    ).toBe(false);
  });

  it("does not label a booking at the exact due-time cutoff", () => {
    expect(
      isPastBooking({ due_at: "2026-10-11T09:00:00.000Z", created_at: "2026-10-11T09:00:00.000Z" })
    ).toBe(false);
  });
});
