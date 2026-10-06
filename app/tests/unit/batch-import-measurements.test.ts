import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPORT_DEFAULTS,
  emptyRow,
  resolveMeasurementConflict,
  rowProblems,
  toCreateRequest,
} from "@/components/inventory/batch-import/import-model";

const defaults = DEFAULT_IMPORT_DEFAULTS;
const categoryId = "11111111-1111-4111-8111-111111111111";

function validCustomRow(patch: Parameters<typeof emptyRow>[1] = {}) {
  return emptyRow(defaults, {
    name: "Hailey",
    category: "Wedding Gowns",
    price: "800",
    measurementMode: "custom",
    bust: "Flexible fit",
    waist: "28",
    length: "61",
    measurementKinds: { bust: "fit_note", waist: "exact", length: "exact" },
    ...patch,
  });
}

describe("batch-import measurements", () => {
  it("infers fit notes and numeric measurements without a type selector", () => {
    const row = validCustomRow();
    expect(rowProblems(row, defaults)).toEqual([]);
    expect(toCreateRequest(row, defaults, categoryId, false).sizes[0]?.measurements).toEqual({
      bust: { type: "fit_note", text: "Flexible fit" },
      waist: 28,
      length: 61,
    });
  });

  it("keeps both conflicting spreadsheet values until an explicit choice", () => {
    const row = validCustomRow({
      bust: "36",
      measurementKinds: { bust: "exact", waist: "exact", length: "exact" },
      measurementConflicts: ["bust"],
      conflictingFitNotes: { bust: "Fits Small–XL" },
    });
    expect(rowProblems(row, defaults).some((problem) => problem.field === "bust")).toBe(true);

    const keepMeasurement = resolveMeasurementConflict(row, "bust", "exact");
    const exactRow = { ...row, ...keepMeasurement };
    expect(exactRow).toMatchObject({ bust: "36", measurementKinds: { bust: "exact" }, measurementConflicts: [] });
    expect(exactRow.conflictingFitNotes).not.toHaveProperty("bust");
    expect(toCreateRequest(exactRow, defaults, categoryId, false).sizes[0]?.measurements["bust"]).toBe(36);

    const keepNote = resolveMeasurementConflict(row, "bust", "fit_note");
    const resolvedRow = { ...row, ...keepNote };
    expect(resolvedRow).toMatchObject({
      bust: "Fits Small–XL",
      measurementKinds: { bust: "fit_note" },
      measurementConflicts: [],
    });
    expect(resolvedRow.conflictingFitNotes).not.toHaveProperty("bust");
    expect(
      toCreateRequest(resolvedRow, defaults, categoryId, false).sizes[0]?.measurements["bust"]
    ).toEqual({
      type: "fit_note",
      text: "Fits Small–XL",
    });
  });

  it("blocks numerically formatted values outside the supported range", () => {
    const row = validCustomRow({ waist: "10001" });
    expect(
      rowProblems(row, defaults).find((problem) => problem.field === "waist")?.message
    ).toMatch(/no more than 10,000/);
  });
});
