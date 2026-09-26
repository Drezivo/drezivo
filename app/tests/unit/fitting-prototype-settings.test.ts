import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_FITTING_DURATION,
  FITTING_DURATION_OPTIONS,
  clearFittingPrototypeDefaultDuration,
  readFittingPrototypeDefaultDuration,
  writeFittingPrototypeDefaultDuration,
} from "@/components/fittings/fitting-prototype-settings";

describe("fitting prototype settings", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("uses the bounded prototype duration options and 60-minute fallback", () => {
    expect(FITTING_DURATION_OPTIONS).toEqual([30, 45, 60, 90]);
    expect(DEFAULT_FITTING_DURATION).toBe(60);
    expect(readFittingPrototypeDefaultDuration()).toBe(60);
  });

  it("shares the schedule default duration through session-scoped prototype state", () => {
    writeFittingPrototypeDefaultDuration(45);
    expect(readFittingPrototypeDefaultDuration()).toBe(45);

    clearFittingPrototypeDefaultDuration();
    expect(readFittingPrototypeDefaultDuration()).toBe(60);
  });

  it("ignores unsupported stored values", () => {
    window.sessionStorage.setItem("drezivo:fittings:prototype-default-duration", "75");
    expect(readFittingPrototypeDefaultDuration()).toBe(60);
  });
});
