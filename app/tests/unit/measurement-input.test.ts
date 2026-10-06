import { describe, expect, it } from "vitest";

import { inferMeasurementKind, parseMeasurementInput } from "@/lib/measurement-input";

describe("measurement input inference", () => {
  it("keeps valid positive numeric entries as exact measurements", () => {
    expect(parseMeasurementInput(" 36 ", "Bust")).toBe(36);
    expect(parseMeasurementInput("28.5", "Waist")).toBe(28.5);
    expect(inferMeasurementKind("61")).toBe("exact");
  });

  it("stores text entries as trimmed fit notes and ignores blank input", () => {
    expect(parseMeasurementInput(" Fits Small–XL ", "Bust")).toEqual({
      type: "fit_note",
      text: "Fits Small–XL",
    });
    expect(inferMeasurementKind("Flexible fit")).toBe("fit_note");
    expect(parseMeasurementInput("   ", "Bust")).toBeNull();
  });

  it("preserves an untouched numeric-looking saved fit note", () => {
    expect(parseMeasurementInput("36", "Bust", "fit_note")).toEqual({
      type: "fit_note",
      text: "36",
    });
  });

  it("rejects numeric values outside the supported range and fit notes over 120 characters", () => {
    expect(() => parseMeasurementInput("0", "Bust")).toThrow(/greater than zero/);
    expect(() => parseMeasurementInput("10001", "Length")).toThrow(/no more than 10,000/);
    expect(() => parseMeasurementInput("-1", "Waist")).toThrow(/greater than zero/);
    expect(() => parseMeasurementInput("F".repeat(121), "Bust")).toThrow(/120 characters/);
  });
});
