import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));

vi.mock("next/navigation", () => ({ notFound: navigation.notFound }));

import FittingScheduleRoute from "@/app/(dashboard)/fittings/schedule/page";

describe("retired /fittings/schedule route", () => {
  it("does not render a production page and resolves through Next not-found handling", () => {
    expect(() => FittingScheduleRoute()).toThrow("NEXT_NOT_FOUND");
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });
});
