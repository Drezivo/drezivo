/**
 * Human-readable size labels for staff UI surfaces.
 *
 * Free-size variants intentionally remain `null` in the API and database. The
 * UI presents that canonical value as one explicit size so it never renders an
 * empty cell or selector option.
 */
export const FREE_SIZE_LABEL = "Flexible fit";

export function displaySizeLabel(sizeLabel: string | null | undefined): string {
  return sizeLabel ?? FREE_SIZE_LABEL;
}

export function displayProductSizes(input: {
  hasFreeSize: boolean;
  sizeLabels: readonly string[];
}): string[] {
  if (input.hasFreeSize) return [FREE_SIZE_LABEL];
  return [...input.sizeLabels];
}

export function displayProductSizeCount(input: {
  hasFreeSize: boolean;
  sizeLabels: readonly string[];
}): number {
  return displayProductSizes(input).length;
}
