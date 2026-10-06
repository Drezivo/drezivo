import {
  createClothingRequest,
  type CreateClothingRequest,
  type ExtractedClothingFields,
  type MeasurementMode,
} from "@drezivo/contracts";

/**
 * One garment in a batch import. Every editable value is kept as the text the owner typed, so a
 * half-filled row survives "Save for later" exactly as it was; values are converted only when the
 * row is turned into a create request.
 */
export type ImportRowStatus = "draft" | "uploading" | "reading" | "saving" | "created" | "error";

export type ImportRow = {
  id: string;
  /** The garment photo. Null for rows that came from a spreadsheet without a matching photo. */
  photo: File | null;
  /** Accepted catalogue file once the photo is uploaded; reused on every later attempt. */
  fileId: string | null;
  /** Idempotency keys, one per intent: regenerated only when the row's content changes after a failure. */
  uploadKey: string;
  finalizeKey: string;
  createKey: string;
  name: string;
  category: string;
  /** Optional style-level label. LONG/MINI are common presets; any trimmed custom value is valid. */
  subcategory: string;
  color: string;
  /** Free size when true; otherwise `sizeLabel` is the one size this piece comes in. */
  freeSize: boolean;
  sizeLabel: string;
  /** Free-text fit note shown in the description, e.g. "Fits Small to XL". */
  fitNote: string;
  /** Same measurement behavior as the single Add Clothing form. */
  measurementMode: MeasurementMode;
  unit: "in" | "cm";
  bust: string;
  waist: string;
  hips: string;
  length: string;
  price: string;
  deposit: string;
  status: ImportRowStatus;
  message: string | null;
  productId: string | null;
  /** True once photo reading has filled this row, so it is not sent to the model twice. */
  read: boolean;
};

/** Shared settings for every row; the price and deposit can still be changed per row. */
export type ImportDefaults = {
  pricingMode: "fixed_duration" | "daily";
  includedDays: string;
  extraDayPrice: string;
  deposit: string;
  recoveryDays: string;
  unit: "in" | "cm";
};

export const DEFAULT_IMPORT_DEFAULTS: ImportDefaults = {
  pricingMode: "fixed_duration",
  includedDays: "3",
  extraDayPrice: "100",
  deposit: "500",
  recoveryDays: "1",
  unit: "in",
};

export const MEASUREMENT_FIELDS = ["bust", "waist", "hips", "length"] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

export function newKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replaceAll("-", "_")}`;
}

export function emptyRow(defaults: ImportDefaults, patch: Partial<ImportRow> = {}): ImportRow {
  return {
    id: newKey("row"),
    photo: null,
    fileId: null,
    uploadKey: newKey("upload"),
    finalizeKey: newKey("finalize"),
    createKey: newKey("create"),
    name: "",
    category: "",
    subcategory: "",
    color: "",
    freeSize: true,
    sizeLabel: "",
    fitNote: "",
    measurementMode: "default_guide",
    unit: defaults.unit,
    bust: "",
    waist: "",
    hips: "",
    length: "",
    price: "",
    deposit: "",
    status: "draft",
    message: null,
    productId: null,
    read: false,
    ...patch,
  };
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * One row per photo. The photo's folder becomes the category ("Gigis rental/Wedding Gowns/x.jpg"
 * is a Wedding Gown); photos straight in the chosen folder take the folder's own name only when
 * nothing better exists, so the owner can still pick a category per row.
 */
export function rowsFromPhotos(files: File[], defaults: ImportDefaults): { rows: ImportRow[]; skipped: string[] } {
  const rows: ImportRow[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (!PHOTO_TYPES.has(file.type) || file.size > MAX_PHOTO_BYTES) {
      skipped.push(file.name);
      continue;
    }
    rows.push(emptyRow(defaults, { photo: file, category: categoryFromPath(file) }));
  }
  return { rows, skipped };
}

function categoryFromPath(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
  const folders = path.split("/").slice(0, -1);
  // The first folder is the one the owner picked; a subfolder inside it names the category.
  return (folders.length > 1 ? folders[folders.length - 1] : "")?.trim() ?? "";
}

/** Fills only the cells the owner has not typed in yet; the photo's text never overwrites theirs. */
export function applyExtraction(row: ImportRow, fields: ExtractedClothingFields): ImportRow {
  const fill = (current: string, next: string | null | undefined) => (current.trim() === "" && next ? next : current);
  const measure = (key: MeasurementField, current: string) => {
    const match = Object.entries(fields.measurements).find(([label]) => label.toLowerCase().startsWith(key.replace(/s$/, "")));
    return fill(current, match ? String(match[1]) : null);
  };
  const hasMeasurements = Object.keys(fields.measurements).length > 0;
  return {
    ...row,
    read: true,
    name: fill(row.name, fields.name),
    color: fill(row.color, fields.color_label),
    price: fill(row.price, fields.rental_price_minor ? minorToPesos(fields.rental_price_minor) : null),
    freeSize: fields.size_label && !fields.free_size ? false : row.freeSize,
    sizeLabel: fields.free_size ? row.sizeLabel : fill(row.sizeLabel, fields.size_label),
    fitNote: fields.free_size ? fill(row.fitNote, fields.size_label ? `Fits ${fields.size_label}` : null) : row.fitNote,
    measurementMode: hasMeasurements ? "custom" : row.measurementMode,
    unit: hasMeasurements && fields.measurement_unit ? fields.measurement_unit : row.unit,
    bust: measure("bust", row.bust),
    waist: measure("waist", row.waist),
    hips: measure("hips", row.hips),
    length: measure("length", row.length),
  };
}

export function minorToPesos(minor: string): string {
  const value = BigInt(minor);
  const whole = value / 100n;
  const cents = value % 100n;
  return cents === 0n ? whole.toString() : `${whole}.${cents.toString().padStart(2, "0")}`;
}

/** "₱1,500", "1500", "1,500.50" → "150050" centavos; null when it is not a peso amount. */
export function pesosToMinor(value: string): string | null {
  const normalized = value.replace(/[₱P,\s]/gi, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return (BigInt(match[1] ?? "0") * 100n + BigInt(fraction || "0")).toString();
}

function measurementValue(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : "invalid";
}

export type RowProblem = { field: keyof ImportRow | "photo"; message: string };

/**
 * Empty fields worth drawing the owner's attention to after a successful photo scan.
 * Required fields still render as validation errors in the UI; this list is for the softer
 * "the photo did not give us this" treatment.
 */
export function scanReviewFields(row: ImportRow): Set<keyof ImportRow> {
  if (!row.read) return new Set();
  const fields = new Set<keyof ImportRow>();
  if (!row.name.trim()) fields.add("name");
  if (!row.category.trim()) fields.add("category");
  if (!row.subcategory.trim()) fields.add("subcategory");
  if (!row.price.trim()) fields.add("price");
  if (row.freeSize) {
    if (!row.fitNote.trim()) fields.add("fitNote");
  } else if (!row.sizeLabel.trim()) {
    fields.add("sizeLabel");
  }
  if (!row.color.trim()) fields.add("color");
  if (row.measurementMode === "custom") {
    for (const field of MEASUREMENT_FIELDS) {
      if (!row[field].trim()) fields.add(field);
    }
  }
  return fields;
}

/** What blocks this row from being created, in the order the owner should fix it. */
export function rowProblems(row: ImportRow, defaults: ImportDefaults, defaultGuideId: string | null = null): RowProblem[] {
  const problems: RowProblem[] = [];
  if (!row.name.trim()) problems.push({ field: "name", message: "Add a name." });
  if (row.name.trim().length > 200) problems.push({ field: "name", message: "Name is too long." });
  if (!row.category.trim()) problems.push({ field: "category", message: "Choose a category." });
  else if (row.category.trim().length > 120) problems.push({ field: "category", message: "Category name is too long." });
  if (row.subcategory.trim().length > 120) problems.push({ field: "subcategory", message: "Subcategory is too long." });
  if (!row.freeSize && !row.sizeLabel.trim()) problems.push({ field: "sizeLabel", message: "Add a size or mark it Free size." });
  if (row.measurementMode === "default_guide" && !defaultGuideId) {
    problems.push({ field: "measurementMode", message: "Choose Custom/No measurements, or set a default measurement guide." });
  }
  if (pesosToMinor(row.price) === null) problems.push({ field: "price", message: "Add the rental price." });
  if (pesosToMinor(row.deposit.trim() || defaults.deposit) === null) {
    problems.push({ field: "deposit", message: "Deposit must be a peso amount." });
  }
  if (row.measurementMode === "custom") {
    let hasMeasurement = false;
    for (const field of MEASUREMENT_FIELDS) {
      const value = measurementValue(row[field]);
      if (value === "invalid") problems.push({ field, message: `${capitalize(field)} must be a number.` });
      if (typeof value === "number") hasMeasurement = true;
    }
    if (!hasMeasurement) {
      problems.push({ field: "measurementMode", message: "Add at least one custom measurement." });
    }
  }
  return problems;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Converts a valid row into the same request the single Add Clothing form sends. */
export function toCreateRequest(
  row: ImportRow,
  defaults: ImportDefaults,
  categoryId: string,
  activate: boolean,
  defaultGuideId: string | null = null
): CreateClothingRequest {
  const measurements: Record<string, number> = {};
  if (row.measurementMode === "custom") {
    for (const field of MEASUREMENT_FIELDS) {
      const value = measurementValue(row[field]);
      if (typeof value === "number") measurements[field] = value;
    }
  }
  const deposit = pesosToMinor(row.deposit.trim() || defaults.deposit) ?? "0";
  const common = {
    rental_price_minor: pesosToMinor(row.price) ?? "0",
    security_deposit_minor: deposit,
    extra_day_price_minor: defaults.pricingMode === "fixed_duration" ? (pesosToMinor(defaults.extraDayPrice) ?? "0") : "0",
    prep_minutes: 0 as const,
    turnaround_minutes: Math.min(Math.max(Number(defaults.recoveryDays) || 0, 0), 14) * 24 * 60,
  };
  return createClothingRequest.parse({
    name: row.name.trim(),
    description: row.fitNote.trim(),
    subcategory: row.subcategory.trim() || null,
    category_id: categoryId as CreateClothingRequest["category_id"],
    color_label: row.color.trim() || null,
    image_file_ids: row.fileId ? [row.fileId as CreateClothingRequest["image_file_ids"][number]] : [],
    sizing_mode: row.freeSize ? "free_size" : "sized",
    sizes: [
      {
        size_label: row.freeSize ? null : row.sizeLabel.trim(),
        measurement_mode: row.measurementMode,
        ...(row.measurementMode === "default_guide" ? { measurement_guide_id: defaultGuideId } : {}),
        measurement_unit: row.unit,
        measurements,
      },
    ],
    pricing:
      defaults.pricingMode === "fixed_duration"
        ? { mode: "fixed_duration", included_days: Math.min(Math.max(Number(defaults.includedDays) || 1, 1), 30), ...common }
        : { mode: "daily", ...common },
    activate: activate && row.fileId !== null,
  });
}

/** A row's content changed after a failed attempt: that is a new intent and gets new keys. */
export function editedRow(row: ImportRow, patch: Partial<ImportRow>): ImportRow {
  const next = { ...row, ...patch };
  if (row.status === "error") {
    return { ...next, status: "draft", message: null, createKey: newKey("create") };
  }
  return next;
}

export function sameCategory(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}
