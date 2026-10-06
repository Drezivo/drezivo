import { emptyRow, type ImportDefaults, type ImportRow } from "./import-model";

/**
 * Spreadsheet import: one garment per row, matched to dropped photos by file name. Headers are
 * matched loosely (case, spaces and a few synonyms) because owners build these sheets by hand.
 */
export const TEMPLATE_COLUMNS = [
  "Photo file",
  "Name",
  "Category",
  "Subcategory",
  "Size",
  "Fit note",
  "Color",
  "Measurement mode",
  "Unit",
  "Bust",
  "Waist",
  "Hips",
  "Length",
  "Rental price",
  "Deposit",
] as const;

const HEADER_ALIASES: Record<string, keyof SheetRecord> = {
  photo: "photo",
  photofile: "photo",
  image: "photo",
  filename: "photo",
  name: "name",
  dressname: "name",
  category: "category",
  subcategory: "subcategory",
  subcategorylabel: "subcategory",
  size: "size",
  fitnote: "fitNote",
  note: "fitNote",
  color: "color",
  colour: "color",
  measurementmode: "measurementMode",
  measurements: "measurementMode",
  unit: "unit",
  bust: "bust",
  chest: "bust",
  waist: "waist",
  hips: "hips",
  hip: "hips",
  length: "length",
  rentalprice: "price",
  price: "price",
  rentalfee: "price",
  fee: "price",
  deposit: "deposit",
  securitydeposit: "deposit",
};

type SheetRecord = {
  photo: string;
  name: string;
  category: string;
  subcategory: string;
  size: string;
  fitNote: string;
  color: string;
  measurementMode: string;
  unit: string;
  bust: string;
  waist: string;
  hips: string;
  length: string;
  price: string;
  deposit: string;
};

export const MAX_SHEET_ROWS = 2_000;

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export async function readSpreadsheet(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    // Loaded only when an owner actually picks an Excel file.
    const { readSheet } = await import("read-excel-file/browser");
    const sheet = await readSheet(file);
    return sheet.map((cells) => cells.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
  }
  return parseCsv(await file.text());
}

export type SheetImport = { rows: ImportRow[]; unmatchedPhotos: string[]; ignoredColumns: string[] };

/**
 * Turns sheet rows into import rows. A row whose photo file name matches a dropped photo takes
 * that photo; photos already used by another row are left alone.
 */
export function rowsFromSheet(table: string[][], photos: File[], defaults: ImportDefaults): SheetImport {
  const [header, ...body] = table;
  if (!header) return { rows: [], unmatchedPhotos: [], ignoredColumns: [] };
  const columns = header.map((title) => HEADER_ALIASES[title.toLowerCase().replace(/[^a-z]/g, "")] ?? null);
  const ignoredColumns = header.filter((_, index) => columns[index] === null && header[index]?.trim());
  const photosByName = new Map(photos.map((photo) => [photo.name.toLowerCase(), photo]));
  const unmatchedPhotos: string[] = [];

  const rows = body.slice(0, MAX_SHEET_ROWS).map((cells) => {
    const record: Partial<SheetRecord> = {};
    columns.forEach((key, index) => {
      if (key) record[key] = (cells[index] ?? "").trim();
    });
    const size = record.size ?? "";
    const freeSize = size === "" || /^(fs|free\s*size|freesize|one\s*size)$/i.test(size);
    const photoName = record.photo?.toLowerCase() ?? "";
    const photo = photoName ? (photosByName.get(photoName) ?? null) : null;
    if (photoName && !photo) unmatchedPhotos.push(record.photo ?? "");
    if (photo) photosByName.delete(photoName);
    const unit = record.unit?.toLowerCase().startsWith("c") ? "cm" : record.unit?.toLowerCase().startsWith("i") ? "in" : defaults.unit;
    const hasMeasurements = [record.bust, record.waist, record.hips, record.length].some((value) => Boolean(value?.trim()));
    const requestedMeasurementMode = record.measurementMode?.trim().toLowerCase() ?? "";
    const measurementMode =
      /^(none|no|no measurements?)$/.test(requestedMeasurementMode)
        ? "none"
        : /^(custom|custom measurements?)$/.test(requestedMeasurementMode)
          ? "custom"
          : /^(default|default guide|guide)$/.test(requestedMeasurementMode)
            ? "default_guide"
            : hasMeasurements
              ? "custom"
              : "default_guide";
    return emptyRow(defaults, {
      photo,
      name: record.name ?? "",
      category: record.category ?? "",
      subcategory: record.subcategory ?? "",
      freeSize,
      sizeLabel: freeSize ? "" : size,
      fitNote: record.fitNote ?? "",
      color: record.color ?? "",
      measurementMode,
      unit,
      bust: record.bust ?? "",
      waist: record.waist ?? "",
      hips: record.hips ?? "",
      length: record.length ?? "",
      price: record.price ?? "",
      deposit: record.deposit ?? "",
    });
  });
  return { rows, unmatchedPhotos, ignoredColumns };
}

/** A ready-to-fill CSV that Excel, Google Sheets and Numbers all open. */
export function templateCsv(): string {
  const example = [
    "mirabelle.jpg",
    "Mirabelle",
    "Evening Dresses",
    "LONG",
    "Free size",
    "",
    "Blush pink",
    "Custom",
    "in",
    "30",
    "24",
    "",
    "22",
    "500",
    "500",
  ];
  return `${TEMPLATE_COLUMNS.join(",")}\r\n${example.join(",")}\r\n`;
}
