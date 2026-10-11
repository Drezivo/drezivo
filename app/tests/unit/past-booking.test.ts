import { describe, expect, it } from "vitest";

import { isPastBooking } from "@/lib/past-booking";

describe("isPastBooking", () => {
  it("labels a booking entered after its pickup time", () => {
    expect(isPastBooking({ pickup_at: "2026-10-01T02:00:00.000Z", created_at: "2026-10-11T09:00:00.000Z" })).toBe(true);
  });

  it("does not label an ordinary upcoming or same-moment booking", () => {
    expect(isPastBooking({ pickup_at: "2026-10-15T02:00:00.000Z", created_at: "2026-10-11T09:00:00.000Z" })).toBe(false);
    expect(isPastBooking({ pickup_at: "2026-10-11T09:00:00.000Z", created_at: "2026-10-11T09:00:00.000Z" })).toBe(false);
  });
});
