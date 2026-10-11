import { describe, expect, it } from "vitest";

import type { ProductId, ProductVariantId } from "@drezivo/contracts";

import {
  additionalGarmentsReadiness,
  type AdditionalGarment,
} from "@/components/reservations/additional-garments";

const MAIN = "00000000-0000-4000-8000-000000000001" as ProductVariantId;
const OTHER = "00000000-0000-4000-8000-000000000002" as ProductVariantId;
const DATES = "2026-10-17T02:00:00.000Z|2026-10-20T02:00:00.000Z";

function garment(overrides: Partial<AdditionalGarment>): AdditionalGarment {
  return {
    key: "g1",
    productId: "00000000-0000-4000-8000-000000000010" as ProductId,
    name: "Amara",
    imageUrl: null,
    detail: null,
    variantId: OTHER,
    availableAssets: 1,
    availabilityCheck: null,
    checkedFor: DATES,
    error: null,
    ...overrides,
  };
}

describe("additionalGarmentsReadiness", () => {
  it("is ready with no extra garments", () => {
    expect(additionalGarmentsReadiness([], MAIN, DATES)).toEqual({
      ready: true,
      variantIds: [],
      problem: null,
    });
  });

  it("returns the extra sizes in order once each is checked for the booking dates", () => {
    expect(additionalGarmentsReadiness([garment({})], MAIN, DATES)).toEqual({
      ready: true,
      variantIds: [OTHER],
      problem: null,
    });
  });

  it("waits for a size and for a check of the current dates", () => {
    expect(additionalGarmentsReadiness([garment({ variantId: "" })], MAIN, DATES).problem).toBe(
      "Choose a size for Amara."
    );
    expect(
      additionalGarmentsReadiness([garment({ checkedFor: "older|dates" })], MAIN, DATES).problem
    ).toBe("Checking Amara for these dates…");
  });

  it("rejects duplicate variants even when multiple physical pieces are free", () => {
    const twice = garment({ variantId: MAIN, name: "Celestine", availableAssets: 1 });
    expect(additionalGarmentsReadiness([twice], MAIN, DATES)).toMatchObject({
      ready: false,
      problem: "Celestine has a variant already selected. Choose a different size.",
    });
    expect(additionalGarmentsReadiness([{ ...twice, availableAssets: 2 }], MAIN, DATES).ready).toBe(
      false
    );
  });

  it("allows up to ten distinct variants including the primary line", () => {
    const nine = Array.from({ length: 9 }, (_, index) =>
      garment({
        key: `g${index}`,
        variantId:
          `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}` as ProductVariantId,
      })
    );
    expect(additionalGarmentsReadiness(nine, MAIN, DATES).ready).toBe(true);
    expect(
      additionalGarmentsReadiness(
        [
          ...nine,
          garment({
            key: "g10",
            variantId: "00000000-0000-4000-8000-000000000020" as ProductVariantId,
          }),
        ],
        MAIN,
        DATES
      )
    ).toMatchObject({
      ready: false,
      problem: "A reservation can include up to 10 garments.",
    });
  });

  it("reports a garment with no free piece", () => {
    expect(
      additionalGarmentsReadiness([garment({ availableAssets: 0 })], MAIN, DATES).problem
    ).toBe("Amara is not available for these dates.");
  });

  it("names the clothing style and selected size in an availability conflict", () => {
    const detail = {
      variants: [{ id: OTHER, size_label: "Medium", color_label: "Navy" }],
    } as unknown as AdditionalGarment["detail"];
    expect(
      additionalGarmentsReadiness(
        [garment({ name: "Bianca", detail, availableAssets: 0 })],
        MAIN,
        DATES
      ).problem
    ).toBe("Bianca · Medium · Navy is not available for these dates.");
  });
});
