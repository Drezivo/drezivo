import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPORT_DEFAULTS,
  applyExtraction,
  editedRow,
  emptyRow,
  pesosToMinor,
  rowProblems,
  rowsFromPhotos,
  scanReviewFields,
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
      hips: "",
      unit: "in",
      measurementMode: "custom",
      read: true,
    });
  });

  it("turns a wedding-gown free-size range into a fit note", () => {
    const next = applyExtraction(emptyRow(defaults), {
      name: "Astrid",
      rental_price_minor: "100000",
      size_label: "Small-XL",
      free_size: true,
      measurement_unit: null,
      measurements: {},
      color_label: "White",
    });
    expect(next).toMatchObject({ freeSize: true, sizeLabel: "", fitNote: "Fits Small-XL", price: "1000" });
  });

  it("marks only the scan gaps that still need manual review", () => {
    const next = applyExtraction(emptyRow(defaults, { category: "Gowns" }), {
      name: "Ariel",
      rental_price_minor: "80000",
      size_label: null,
      free_size: true,
      measurement_unit: "in",
      measurements: { Bust: 32, Waist: 26, Length: 64 },
      color_label: "Maroon",
    });
    expect([...scanReviewFields(next)]).toEqual(["subcategory", "fitNote", "hips"]);
  });
});

describe("validation and the create request", () => {
  it("lists what blocks a row", () => {
    const problems = rowProblems(
      emptyRow(defaults, { freeSize: false, measurementMode: "custom", bust: "thirty" }),
      defaults
    ).map((problem) => problem.field);
    expect(problems).toEqual(["name", "category", "sizeLabel", "price", "bust", "measurementMode"]);
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
      sizes: [{ size_label: null, measurement_mode: "custom", measurement_unit: "in", measurements: { bust: 30, waist: 26, length: 60 } }],
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

  it("never publishes a row without a photo, and reuses the default guide like single-item add", () => {
    const row = emptyRow(defaults, { name: "A", category: "C", price: "1" });
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

  it("ships a template whose own example row imports cleanly", () => {
    const { rows } = rowsFromSheet(parseCsv(templateCsv()), [], defaults);
    expect(rows).toHaveLength(1);
    expect(rowProblems(rows[0]!, defaults)).toEqual([]);
  });
});
