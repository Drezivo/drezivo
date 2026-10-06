import type { VariantMeasurementValue } from "@drezivo/contracts";

export type MeasurementKind = "exact" | "fit_note";

const NUMERIC_MEASUREMENT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export function inferMeasurementKind(value: string): MeasurementKind {
  return NUMERIC_MEASUREMENT.test(value.trim()) ? "exact" : "fit_note";
}

/** Blank drafts return null; savedKind keeps untouched numeric-looking notes from being reclassified. */
export function parseMeasurementInput(
  value: string,
  label: string,
  savedKind?: MeasurementKind
): VariantMeasurementValue | null;
export function parseMeasurementInput(
  value: string,
  label: string,
  savedKind: MeasurementKind,
  required: true
): VariantMeasurementValue;
export function parseMeasurementInput(
  value: string,
  label: string,
  savedKind?: MeasurementKind,
  required = false
): VariantMeasurementValue | null {
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }

  const numeric = NUMERIC_MEASUREMENT.test(trimmed);
  if (numeric && savedKind !== "fit_note") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000) {
      throw new Error(`${label} must be greater than zero and no more than 10,000.`);
    }
    return parsed;
  }

  if (trimmed.length > 120) {
    throw new Error(`${label} fit note must be 120 characters or less.`);
  }
  return { type: "fit_note", text: trimmed };
}
