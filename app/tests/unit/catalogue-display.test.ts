import { describe, expect, it } from "vitest";

import {
  displayProductSizeCount,
  displayProductSizes,
  displaySizeLabel,
  FREE_SIZE_LABEL,
} from "@/lib/catalogue-display";

describe("catalogue size display", () => {
  it("renders a nullable free-size variant with an explicit label", () => {
    expect(displaySizeLabel(null)).toBe(FREE_SIZE_LABEL);
    expect(displaySizeLabel(undefined)).toBe(FREE_SIZE_LABEL);
  });

  it("treats a free-size product as exactly one size", () => {
    const input = { hasFreeSize: true, sizeLabels: [] };
    expect(displayProductSizes(input)).toEqual([FREE_SIZE_LABEL]);
    expect(displayProductSizeCount(input)).toBe(1);
  });

  it("preserves labelled sizes for sized products", () => {
    const input = { hasFreeSize: false, sizeLabels: ["S", "M"] };
    expect(displayProductSizes(input)).toEqual(["S", "M"]);
    expect(displayProductSizeCount(input)).toBe(2);
  });
});
