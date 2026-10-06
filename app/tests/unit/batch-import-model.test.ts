import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPORT_DEFAULTS,
  applyExtraction,
  editedRow,
  emptyRow,
  pesosToMinor,
  rowProblems,
  rowsFromPhotos,
  toCreateRequest,
} from "@/components/inventory/batch-import/import-model";
import { parseCsv, rowsFromSheet, templateCsv } from "@/components/inventory/batch-import/spreadsheet";

const defaults = DEFAULT_IMPORT_DEFAULTS;
const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const GUIDE_ID = "33333333-3333-4333-8333-333333333333";

function photo(name: string, path = "", type = "image/jpeg", size = 1000): File {
  const file = new File([new Uint8Array(size)], name, { type });
  if (path) Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("rowsFromPhotos", () => {
  it("makes one row per photo, takes the category from a subfolder, and skips non-photos", () => {
    const { rows, skipped } = rowsFromPhotos(
      [
        photo("a.jpeg", "Gigis rental/a.jpeg"),
        photo("b.jpeg", "Gigis rental/Wedding Gowns/b.jpeg"),
        photo("notes.pdf", "", "application/pdf"),
        photo("huge.jpg", "", "image/jpeg", 11 * 1024 * 1024),
      ],
      defaults
    );
    expect(rows.map((row) => row.category)).toEqual(["", "Wedding Gowns"]);
    expect(skipped).toEqual(["notes.pdf", "huge.jpg"]);
    expect(new Set(rows.flatMap((row) => [row.uploadKey, row.finalizeKey, row.createKey])).size).toBe(6);
    expect(rows[0]?.measurementMode).toBe("custom");
  });
});

describe("measurement mode defaults", () => {
  it("starts new rows with custom measurements and preserves explicit spreadsheet modes", () => {
    expect(emptyRow(defaults).measurementMode).toBe("custom");

    const { rows } = rowsFromSheet(
      parseCsv(
        "Name,Category,Measurement mode\nNew default,Evening,\nUse guide,Evening,Default guide\nNo measurements,Evening,None\n"
      ),
      [],
      defaults
    );
    expect(rows.map((row) => row.measurementMode)).toEqual(["custom", "default_guide", "none"]);
  });
});

describe("applyExtraction", () => {
  it("fills empty cells from an evening-dress card and keeps what the owner typed", () => {
    const row = emptyRow(defaults, { price: "450" });
    const next = applyExtraction(row, {
      name: "Mirabelle",
      rental_price_minor: "50000",
      size_label: null,
      free_size: false,
      measurement_unit: "in",
      measurements: { Bust: 30, Waist: 24, Length: 22 },
      color_label: "Blush pink",
    });
    expect(next).toMatchObject({
      name: "Mirabelle",
      price: "450",
      bust: "30",
      waist: "24",
      length: "22",
      unit: "in",
      measurementMode: "custom",
      read: true,
    });
  });

  it("keeps an explicitly printed flexible-fit range separate from description", () => {
    const next = applyExtraction(emptyRow(defaults), {
      name: "Yasmin",
      rental_price_minor: "100000",
      size_label: null,
      fit_range: "Small-XL",
      free_size: true,
      measurement_unit: null,
      measurements: {},
      color_label: "White",
    });
    expect(next).toMatchObject({ freeSize: true, sizeLabel: "", fitRange: "Small-XL", description: "", price: "1000" });
  });

  it("keeps an FS bust note, waist, and length without inferring a size range", () => {
    const next = applyExtraction(emptyRow(defaults), {
      name: "Hailey",
      rental_price_minor: "80000",
      size_label: null,
      fit_range: null,
      free_size: true,
      measurement_unit: "in",
      measurements: {
        Bust: { type: "fit_note", text: "Flexible fit" },
        Waist: 28,
        Length: 61,
      },
      color_label: "White",
    });
    expect(next).toMatchObject({
      freeSize: true,
      fitRange: "",
      description: "",
      bust: "Flexible fit",
      waist: "28",
      length: "61",
      measurementKinds: { bust: "fit_note", waist: "exact", length: "exact" },
    });
  });
});

describe("validation and the create request", () => {
  it("lists what blocks a row", () => {
    const problems = rowProblems(
      emptyRow(defaults, { freeSize: false, measurementMode: "custom", bust: "thirty" }),
      defaults
    ).map((problem) => problem.field);
    expect(problems).toEqual(["name", "category", "sizeLabel", "price"]);
  });

  it("builds the same create request the single form sends", () => {
    const row = emptyRow(defaults, {
      name: " Lisette ",
      category: "Evening Dresses",
      subcategory: " LONG ",
      price: "₱800",
      bust: "30",
      waist: "26",
      length: "60",
      measurementMode: "custom",
      color: "Black",
      fileId: FILE_ID,
    });
    expect(rowProblems(row, defaults)).toEqual([]);
    expect(toCreateRequest(row, defaults, CATEGORY_ID, false)).toEqual({
      name: "Lisette",
      description: "",
      subcategory: "LONG",
      category_id: CATEGORY_ID,
      color_label: "Black",
      image_file_ids: [FILE_ID],
      sizing_mode: "free_size",
      sizes: [{ size_label: null, fit_range: null, measurement_mode: "custom", measurement_unit: "in", measurements: { bust: 30, waist: 26, length: 60 } }],
      pricing: {
        mode: "fixed_duration",
        included_days: 3,
        rental_price_minor: "80000",
        security_deposit_minor: "50000",
        extra_day_price_minor: "10000",
        prep_minutes: 0,
        turnaround_minutes: 1440,
      },
      activate: false,
    });
  });

  it("keeps fit range and description separate and sends dimension-specific fit notes", () => {
    const row = emptyRow(defaults, {
      name: "Hailey",
      category: "Wedding Gowns",
      price: "800",
      freeSize: true,
      fitRange: "Small-XL",
      description: "Polka-dot gown",
      measurementMode: "custom",
      bust: "Flexible fit",
      waist: "28",
      length: "61",
      measurementKinds: { bust: "fit_note", waist: "exact", length: "exact" },
    });
    expect(toCreateRequest(row, defaults, CATEGORY_ID, false)).toMatchObject({
      description: "Polka-dot gown",
      sizes: [{
        size_label: null,
        fit_range: "Small-XL",
        measurement_mode: "custom",
        measurement_unit: "in",
        measurements: {
          bust: { type: "fit_note", text: "Flexible fit" },
          waist: 28,
          length: 61,
        },
      }],
    });
  });

  it("never publishes a row without a photo, and reuses the default guide like single-item add", () => {
    const row = emptyRow(defaults, { name: "A", category: "C", price: "1", measurementMode: "default_guide" });
    const request = toCreateRequest(row, defaults, CATEGORY_ID, true, GUIDE_ID);
    expect(request.activate).toBe(false);
    expect(request.sizes[0]).toMatchObject({
      measurement_mode: "default_guide",
      measurement_guide_id: GUIDE_ID,
      measurements: {},
    });
  });

  it("supports an explicit no-measurements row without a default guide", () => {
    const row = emptyRow(defaults, {
      name: "A",
      category: "C",
      price: "1",
      measurementMode: "none",
    });
    expect(rowProblems(row, defaults)).toEqual([]);
    expect(toCreateRequest(row, defaults, CATEGORY_ID, false).sizes[0]).toMatchObject({
      measurement_mode: "none",
      measurements: {},
    });
  });

  it("parses peso amounts the way owners type them", () => {
    expect(["500", "₱1,500", "P800", "1500.5", "abc", "-1"].map(pesosToMinor)).toEqual(["50000", "150000", "80000", "150050", null, null]);
  });

  it("gives an edited failed row a new create key and leaves a clean row's key alone", () => {
    const failed = emptyRow(defaults, { status: "error", message: "Duplicate" });
    const edited = editedRow(failed, { name: "New" });
    expect(edited.createKey).not.toBe(failed.createKey);
    expect(edited.status).toBe("draft");
    const clean = emptyRow(defaults);
    expect(editedRow(clean, { name: "x" }).createKey).toBe(clean.createKey);
  });
});

describe("spreadsheet import", () => {
  it("parses quoted CSV cells, doubled quotes and CRLF", () => {
    expect(parseCsv('Name,Note\r\n"Mira, the dress","said ""hi"""\r\n\r\n')).toEqual([
      ["Name", "Note"],
      ["Mira, the dress", 'said "hi"'],
    ]);
  });

  it("matches photos by file name and reads loose headers", () => {
    const mirabelle = photo("Mirabelle.JPG");
    const table = parseCsv(
      "Photo,Dress name,Category,Subcategory,Size,Measurement mode,Bust,Rental fee,Mystery\n" +
        "mirabelle.jpg,Mirabelle,Evening,MINI,M,Custom,30,500,x\n" +
        "missing.jpg,Other,Evening,,FS,No measurements,,800,y\n"
    );
    const { rows, unmatchedPhotos, ignoredColumns } = rowsFromSheet(table, [mirabelle], defaults);
    expect(rows[0]).toMatchObject({
      photo: mirabelle,
      name: "Mirabelle",
      category: "Evening",
      subcategory: "MINI",
      freeSize: false,
      sizeLabel: "M",
      measurementMode: "custom",
      bust: "30",
      price: "500",
    });
    expect(rows[1]).toMatchObject({ photo: null, freeSize: true, sizeLabel: "", measurementMode: "none" });
    expect(unmatchedPhotos).toEqual(["missing.jpg"]);
    expect(ignoredColumns).toEqual(["Mystery"]);
  });

  it("imports fits-size range, description, and exact or fit-note dimensions as separate fields", () => {
    const table = parseCsv(
      "Name,Category,Size,Fits sizes,Description,Measurement mode,Unit,Bust,Waist,Length,Length fit note,Hips\n" +
        "Yasmin,Wedding Gowns,FS,Small-XL,Soft tulle gown,Custom,in,,28,61,,36\n"
    );
    const { rows, ignoredColumns } = rowsFromSheet(table, [], defaults);
    expect(rows[0]).toMatchObject({
      freeSize: true,
      fitRange: "Small-XL",
      description: "Soft tulle gown",
      waist: "28",
      length: "61",
    });
    expect(rows[0]?.bust).toBe("");
    expect(ignoredColumns).toEqual(["Hips"]);
    expect(templateCsv()).not.toMatch(/(^|,)Hips(,|\r?\n)/i);
    expect(templateCsv()).toContain("Bust fit note");
    expect(templateCsv()).toContain("Description");
  });

  it("ships a template whose own example row imports cleanly", () => {
    const { rows } = rowsFromSheet(parseCsv(templateCsv()), [], defaults);
    expect(rows).toHaveLength(1);
    expect(rowProblems(rows[0]!, defaults)).toEqual([]);
  });
});
